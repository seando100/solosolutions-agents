import {
  agentLogger,
  getAnthropicClient,
  DEFAULT_MODEL,
  getOpsClient,
  sendReply,
  fetchThreadMessageIds,
  fetchMessageById,
} from '@solo/shared';
import type {
  AgentRunResult,
  SupportTicket,
  TicketMessage,
} from '@solo/shared';

/**
 * ═══════════════════════════════════════════
 * AVERY — Escalation Coordinator
 * ═══════════════════════════════════════════
 *
 * "When it's beyond self-serve, I package everything up clean
 *  so you can respond in minutes, not hours."
 *
 * Team: Support
 * Trigger: Cron (every 10 min) + invoked by Riley when founder replies
 *
 * Two jobs:
 *   Job 1 (notifyFounder): Find escalated tickets → email the founder a
 *         clean summary with context → mark ticket as 'in_progress'
 *   Job 2 (processFounderReply): Founder replies → forward to customer →
 *         add Q&A to knowledge base → mark ticket 'resolved'
 *
 * The customer ALWAYS gets a reply. Avery ensures the loop closes.
 * ═══════════════════════════════════════════
 */

const FOUNDER_EMAIL = process.env.NOTIFICATION_EMAIL || 'sean@solosolutionsai.com';
const ESCALATION_SUBJECT_PREFIX = '[ESCALATION]';

/** Main cron entry point — notify founder about new escalations */
export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('avery', runId);
  const ops = getOpsClient();

  log.info('Checking for escalated tickets that need founder attention...');

  // ── Job 0: Acknowledge in-portal tickets (no Gmail thread) ──
  // These come from Clark's chat widget. The founder was already notified
  // via Resend email. We just move them to 'in_progress' so they don't
  // sit as 'new' forever, and log that they've been acknowledged.
  const { data: portalTickets } = await ops
    .from('support_tickets')
    .select('id, subject, source_email')
    .eq('status', 'new')
    .is('thread_id', null)
    .order('created_at', { ascending: true });

  let acknowledged = 0;

  for (const pt of (portalTickets || []) as { id: string; subject: string; source_email: string }[]) {
    try {
      await ops
        .from('support_tickets')
        .update({
          status: 'in_progress',
          assigned_agent: 'avery',
          updated_at: new Date().toISOString(),
        })
        .eq('id', pt.id);

      acknowledged++;
      log.info({ ticketId: pt.id, subject: pt.subject }, 'Acknowledged in-portal ticket (founder notified via email)');
    } catch (err) {
      log.error({ err, ticketId: pt.id }, 'Failed to acknowledge in-portal ticket');
    }
  }

  // Find escalated tickets still assigned to Avery that haven't been sent to founder yet
  // We use status 'escalated' to mean "needs founder notification"
  // Once notified, we move to 'in_progress'
  const { data: tickets, error } = await ops
    .from('support_tickets')
    .select('*')
    .eq('assigned_agent', 'avery')
    .eq('status', 'escalated')
    .order('created_at', { ascending: true });

  if (error) {
    log.error({ err: error }, 'Failed to fetch escalated tickets');
    return { summary: `Error: ${error.message}` };
  }

  let notified = 0;

  if (!tickets || tickets.length === 0) {
    log.info('No new escalations to notify');
  } else {
    log.info({ count: tickets.length }, `Found ${tickets.length} escalated ticket(s)`);
  }

  for (const ticket of (tickets || []) as SupportTicket[]) {
    try {
      // Load the full conversation
      const { data: messages } = await ops
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: true });

      const allMessages = (messages as TicketMessage[] | null) || [];
      const inbound = allMessages.find(m => m.direction === 'inbound');

      if (!inbound) {
        log.warn({ ticketId: ticket.id }, 'No inbound message found — skipping');
        continue;
      }

      // Build the escalation summary for the founder
      const escalationReason = ticket.resolution_summary?.replace('Clark escalated: ', '') || 'Unknown reason';

      const summaryBody = `${ESCALATION_SUBJECT_PREFIX} Ticket needs your input

CUSTOMER: ${ticket.source_email}
SUBJECT: ${ticket.subject}
PRIORITY: ${ticket.priority}
CATEGORY: ${ticket.category}
ESCALATION REASON: ${escalationReason}

--- CUSTOMER'S MESSAGE ---
${inbound.body}
--- END ---

To resolve this, simply reply to this email with your response. Avery will:
1. Forward your reply to the customer
2. Add the Q&A to the knowledge base so Clark handles it next time
3. Close the ticket

Ticket ID: ${ticket.id}`;

      // Send the escalation email to the founder via the support thread
      // This keeps it in the same Gmail thread so the founder can reply in context
      const gmailMessageId = await sendReply({
        to: FOUNDER_EMAIL,
        subject: `${ESCALATION_SUBJECT_PREFIX} ${ticket.subject || 'Support Ticket'}`,
        body: summaryBody,
        threadId: ticket.thread_id,
        inReplyToMessageId: inbound.gmail_message_id || '',
        fromName: 'Avery (Escalation Bot)',
      });

      // Log the notification
      await ops.from('ticket_messages').insert({
        ticket_id: ticket.id,
        direction: 'outbound',
        gmail_message_id: gmailMessageId,
        from_email: process.env.GMAIL_DELEGATED_USER || '',
        to_email: FOUNDER_EMAIL,
        subject: `${ESCALATION_SUBJECT_PREFIX} ${ticket.subject || ''}`,
        body: summaryBody,
        sent_at: new Date().toISOString(),
      });

      // Move to in_progress so we don't re-notify
      await ops
        .from('support_tickets')
        .update({
          status: 'in_progress',
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticket.id);

      notified++;
      log.info({ ticketId: ticket.id }, 'Sent escalation to founder');
    } catch (err) {
      log.error({ err, ticketId: ticket.id }, 'Failed to notify founder');
    }
  }

  // ── Job 2: Check in_progress tickets for founder replies ──
  // The founder replies from the same Gmail account, so the history API
  // may not flag it as "new." We check threads directly.
  const { data: inProgressTickets } = await ops
    .from('support_tickets')
    .select('*')
    .eq('assigned_agent', 'avery')
    .eq('status', 'in_progress')
    .order('created_at', { ascending: true });

  let resolved = 0;

  log.info({ count: inProgressTickets?.length || 0 }, 'Checking in_progress tickets for founder replies');

  for (const ticket of (inProgressTickets || []) as SupportTicket[]) {
    try {
      // Get all message IDs in the Gmail thread
      const threadMsgIds = await fetchThreadMessageIds(ticket.thread_id);
      log.info({ ticketId: ticket.id, threadMsgs: threadMsgIds.length }, 'Scanning thread');

      // Get all message IDs we've already tracked
      const { data: trackedMsgs } = await ops
        .from('ticket_messages')
        .select('gmail_message_id')
        .eq('ticket_id', ticket.id);

      const trackedIds = new Set((trackedMsgs || []).map(m => m.gmail_message_id));

      // Find untracked messages
      const untrackedIds = threadMsgIds.filter(id => !trackedIds.has(id));
      log.info({ ticketId: ticket.id, untracked: untrackedIds.length, tracked: trackedIds.size }, 'Thread scan results');

      if (untrackedIds.length === 0) continue;

      // Check each untracked message for a founder reply
      for (const msgId of untrackedIds) {
        const email = await fetchMessageById(msgId);
        if (!email) {
          log.warn({ ticketId: ticket.id, msgId }, 'Could not fetch message');
          continue;
        }

        const isFromFounder = email.from.includes(FOUNDER_EMAIL);
        // The escalation notification body STARTS with "[ESCALATION]".
        // A founder reply starts with their actual answer (quoted escalation is below).
        const trimmedBody = email.body.trim();
        const isEscalation = trimmedBody.startsWith(ESCALATION_SUBJECT_PREFIX);
        log.info({ ticketId: ticket.id, msgId, isFromFounder, isEscalation, bodyStart: trimmedBody.slice(0, 60) }, 'Checking message');

        if (isFromFounder && !isEscalation) {
          log.info({ ticketId: ticket.id }, 'Found founder reply in thread — processing');
          try {
            const result = await processFounderReply(runId, ticket.thread_id, email.body);
            log.info({ ticketId: ticket.id }, `Resolved: ${result.summary}`);
            resolved++;
          } catch (err) {
            log.error({ err, ticketId: ticket.id }, 'Failed to process founder reply');
          }
          break; // Only process the first founder reply per ticket
        }
      }
    } catch (err) {
      log.error({ err, ticketId: ticket.id }, 'Error checking thread for founder reply');
    }
  }

  const parts = [];
  if (acknowledged > 0) parts.push(`Acknowledged ${acknowledged} in-portal ticket(s)`);
  if (notified > 0) parts.push(`Notified founder about ${notified} escalated ticket(s)`);
  if (resolved > 0) parts.push(`Resolved ${resolved} ticket(s) from founder replies`);
  const summary = parts.length > 0 ? parts.join('; ') : 'No new escalations';
  log.info(summary);
  return { summary };
}

/**
 * Process a founder reply to an escalated ticket.
 * Called by Riley when she detects the founder replying in an escalation thread.
 *
 * Flow:
 *   1. Find the ticket by thread ID
 *   2. Forward the founder's reply to the original customer
 *   3. Add the Q&A pair to the knowledge base
 *   4. Mark the ticket as resolved
 */
export async function processFounderReply(
  runId: string,
  threadId: string,
  founderReplyBody: string,
): Promise<AgentRunResult> {
  const log = agentLogger('avery', runId);
  const ops = getOpsClient();

  log.info({ threadId }, 'Processing founder reply to escalation...');

  // Safety check: reject if this is our own escalation notification echoing back.
  // Only check the START of the body — founder replies contain quoted escalation
  // text below their answer, so includes() would false-positive.
  if (founderReplyBody.trim().startsWith(ESCALATION_SUBJECT_PREFIX)) {
    log.warn({ threadId }, 'Rejected: this is an escalation notification, not a founder reply');
    return { summary: 'Skipped — escalation notification, not a founder reply' };
  }

  // 1. Find the ticket
  const { data: ticket } = await ops
    .from('support_tickets')
    .select('*')
    .eq('thread_id', threadId)
    .eq('assigned_agent', 'avery')
    .in('status', ['in_progress', 'escalated'])
    .single();

  if (!ticket) {
    log.warn({ threadId }, 'No matching escalated ticket found for this thread');
    return { summary: 'No matching ticket found' };
  }

  const typedTicket = ticket as SupportTicket;

  // Load the original customer message
  const { data: messages } = await ops
    .from('ticket_messages')
    .select('*')
    .eq('ticket_id', typedTicket.id)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: true })
    .limit(1);

  const originalMessage = (messages as TicketMessage[] | null)?.[0];
  if (!originalMessage) {
    log.error({ ticketId: typedTicket.id }, 'No original customer message found');
    return { summary: 'Error: no original message' };
  }

  // 2. Clean up the founder's reply (strip the escalation context)
  const cleanReply = cleanFounderReply(founderReplyBody);

  // 3. Polish the reply into a professional customer-facing email
  const customerName = extractCustomerName(typedTicket.source_email);
  const polishedReply = await polishFounderReply(
    cleanReply,
    originalMessage.body || '',
    typedTicket.subject || '',
    customerName,
  );

  // 4. Send the polished reply to the customer
  const gmailMessageId = await sendReply({
    to: typedTicket.source_email,
    subject: `Re: ${typedTicket.subject || 'Your SoloBusinessAI Support Request'}`,
    body: polishedReply,
    threadId: typedTicket.thread_id,
    inReplyToMessageId: originalMessage.gmail_message_id || '',
    fromName: 'SoloBusinessAI Support',
  });

  // Log the outbound response
  await ops.from('ticket_messages').insert({
    ticket_id: typedTicket.id,
    direction: 'outbound',
    gmail_message_id: gmailMessageId,
    from_email: process.env.GMAIL_DELEGATED_USER || '',
    to_email: typedTicket.source_email,
    subject: `Re: ${typedTicket.subject || ''}`,
    body: polishedReply,
    sent_at: new Date().toISOString(),
  });

  log.info({ ticketId: typedTicket.id }, 'Sent polished reply to customer');

  // 5. Add to knowledge base so Clark handles this next time
  await addToKnowledgeBase(ops, typedTicket, originalMessage, polishedReply, log);

  // 6. Mark ticket as resolved
  await ops
    .from('support_tickets')
    .update({
      status: 'resolved',
      resolution_summary: `Resolved by founder via Avery escalation`,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', typedTicket.id);

  log.info({ ticketId: typedTicket.id }, 'Ticket resolved and KB updated');

  return { summary: `Resolved ticket "${typedTicket.subject}" — reply sent to customer, KB updated` };
}

/**
 * Strip the escalation metadata from the founder's reply.
 * The founder just types their answer above the quoted text.
 */
function cleanFounderReply(rawReply: string): string {
  // Remove everything after common quote markers
  const quoteMarkers = [
    `${ESCALATION_SUBJECT_PREFIX}`,
    '--- CUSTOMER\'S MESSAGE ---',
    'On ',  // Gmail's "On [date], [person] wrote:"
    '> ',   // Standard email quoting
  ];

  let cleaned = rawReply;

  for (const marker of quoteMarkers) {
    const idx = cleaned.indexOf(marker);
    if (idx > 0) {
      cleaned = cleaned.substring(0, idx);
      break;
    }
  }

  cleaned = cleaned.trim();

  // If the cleaned reply is too short, use the whole thing
  // (founder might have written inline)
  if (cleaned.length < 20) {
    cleaned = rawReply.trim();
  }

  return cleaned;
}

/** Extract a first name from an email "Display Name <email>" string */
function extractCustomerName(sourceEmail: string): string {
  // Try to get display name: "Sean Doherty <sean@...>" → "Sean"
  const match = sourceEmail.match(/^([^<]+)</);
  if (match) {
    const fullName = match[1].trim();
    return fullName.split(' ')[0] || 'there';
  }
  return 'there';
}

/**
 * Polish the founder's raw reply into a professional customer-facing email.
 * The founder provides the substance; Avery handles the tone and formatting.
 */
async function polishFounderReply(
  founderReply: string,
  customerQuestion: string,
  subject: string,
  customerName: string,
): Promise<string> {
  const anthropic = getAnthropicClient();

  try {
    const result = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 800,
      system: `You are Avery, a support coordinator for SoloBusinessAI (an AI-powered client intake and business automation platform for solo professionals and small teams across all industries). Your ONLY job is to reformat the founder's answer into a professional email. You are a FORMATTER, not an answerer.

CRITICAL RULES:
- The founder's answer is THE TRUTH. Do not change, contradict, or add to the facts.
- If the founder says "we don't do X" — the customer email MUST say "we don't do X"
- If the founder says something is "on our roadmap" — say exactly that
- NEVER invent features, instructions, workarounds, or solutions that the founder did not mention
- NEVER answer the customer's question yourself — ONLY reformat what the founder said
- You may improve grammar, tone, and organization — but the MEANING must be identical
- Greet the customer by first name
- Use a warm, professional tone
- Organize with bullet points or numbered steps ONLY if the founder's answer has multiple distinct points
- End with an invitation to follow up if they have more questions
- Sign off as "The SoloBusinessAI Support Team"
- Do NOT use markdown formatting (no ** or ## — this is a plain text email)
- Output ONLY the email body, nothing else

If you are unsure about any fact, err on the side of quoting the founder's words more closely rather than paraphrasing.`,
      messages: [
        {
          role: 'user',
          content: `CUSTOMER'S QUESTION:
Subject: ${subject}
${customerQuestion}

FOUNDER'S ANSWER (raw — polish this):
${founderReply}

CUSTOMER FIRST NAME: ${customerName}`,
        },
      ],
    });

    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    return text.trim();
  } catch {
    // If polishing fails, fall back to a basic formatted version
    return `Hi ${customerName},

Thank you for your question!

${founderReply}

If you have any other questions, don't hesitate to reach out.

The SoloBusinessAI Support Team`;
  }
}

/**
 * Create a knowledge base entry from the resolved escalation.
 * Uses Claude to generate a clean, structured, actionable answer.
 */
async function addToKnowledgeBase(
  ops: ReturnType<typeof getOpsClient>,
  ticket: SupportTicket,
  originalMessage: TicketMessage,
  founderReply: string,
  log: ReturnType<typeof agentLogger>,
): Promise<void> {
  const anthropic = getAnthropicClient();

  try {
    // Use Claude to generate a clean KB entry from the Q&A
    const result = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 500,
      system: `You are creating a knowledge base entry for SoloBusinessAI customer support. SoloBusinessAI is an AI-powered client intake and business automation platform for solo professionals and small teams across all industries.
Given a customer question and the support team's answer, create a well-structured FAQ entry that a support agent (Clark) can use to answer future customers.

Respond with ONLY valid JSON:
{
  "title": "A clear, general question (e.g. 'How does Spanish language support work?')",
  "content": "A well-organized answer with the key facts. Use numbered steps or bullet points where appropriate. Write it as general guidance, not specific to this customer. Include all relevant details from the answer but organize them logically. This should read like a professional FAQ entry — if Clark reads this to a customer, it should sound polished.",
  "tags": ["tag1", "tag2", "tag3"]
}

Guidelines:
- Title should be a natural question a customer would ask
- Content should be structured (use line breaks, numbered lists, bullet points)
- Include all factual details from the answer — don't lose information
- Generalize: remove customer-specific details, keep product-specific facts
- Tags should help with keyword matching (3-5 tags)`,
      messages: [
        {
          role: 'user',
          content: `CUSTOMER QUESTION:
Subject: ${ticket.subject}
${originalMessage.body}

SUPPORT TEAM ANSWER:
${founderReply}`,
        },
      ],
    });

    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    const cleanJson = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const entry = JSON.parse(cleanJson) as { title: string; content: string; tags: string[] };

    await ops.from('knowledge_base').insert({
      vertical: ticket.vertical || 'global',
      category: 'resolved_ticket',
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
      source: 'resolved_ticket',
      source_ticket_id: ticket.id,
    });

    log.info({ ticketId: ticket.id, kbTitle: entry.title }, 'Added resolved ticket to KB');
  } catch (err) {
    // Don't fail the resolution if KB entry fails
    log.warn({ err, ticketId: ticket.id }, 'Failed to add to KB — ticket still resolved');
  }
}
