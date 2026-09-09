import {
  agentLogger,
  getAnthropicClient,
  DEFAULT_MODEL,
  getOpsClient,
  sendReply,
} from '@solo/shared';
import type {
  AgentRunResult,
  SupportTicket,
  TicketMessage,
  KnowledgeBaseEntry,
} from '@solo/shared';

/**
 * ═══════════════════════════════════════════
 * JORDAN — Tier 1 Support Rep
 * ═══════════════════════════════════════════
 *
 * "I handle the everyday questions — setup help, how-tos,
 *  billing basics. If I'm confident, I reply on the spot."
 *
 * Team: Support
 * Trigger: Invoked by Riley (Triage) after ticket creation, or by orchestrator on cron
 * Tools: Knowledge base search, Claude (draft response), Gmail API (send reply)
 *
 * Flow:
 *   1. Find tickets assigned to 'jordan' with status 'new'
 *   2. For each ticket:
 *      a. Load original email from ticket_messages
 *      b. Search knowledge base for relevant articles
 *      c. Draft response with Claude (includes confidence evaluation)
 *      d. High confidence → send full answer, mark ticket 'awaiting_response'
 *      e. Low confidence → send acknowledgement with next steps,
 *         escalate internally to Avery, mark ticket 'escalated'
 *   3. The customer ALWAYS gets a reply — never silence
 *   4. Log everything
 * ═══════════════════════════════════════════
 */
export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('jordan', runId);
  const ops = getOpsClient();

  log.info('Checking for tickets assigned to me...');

  // 1. Find all tickets assigned to Clark that are still 'new'
  const { data: tickets, error: ticketError } = await ops
    .from('support_tickets')
    .select('*')
    .eq('assigned_agent', 'jordan')
    .eq('status', 'new')
    .order('created_at', { ascending: true });

  if (ticketError) {
    log.error({ err: ticketError }, 'Failed to fetch tickets');
    return { summary: `Error fetching tickets: ${ticketError.message}` };
  }

  if (!tickets || tickets.length === 0) {
    log.info('No new tickets for me right now');
    return { summary: 'No new tickets to handle' };
  }

  log.info({ count: tickets.length }, `Found ${tickets.length} ticket(s) to handle`);

  let replied = 0;
  let escalated = 0;

  for (const ticket of tickets as SupportTicket[]) {
    try {
      // 2. Load the original inbound email
      const { data: messages } = await ops
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticket.id)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1);

      const originalMessage = (messages as TicketMessage[] | null)?.[0];
      if (!originalMessage) {
        log.warn({ ticketId: ticket.id }, 'No inbound message found — skipping');
        continue;
      }

      // 3. Search knowledge base for relevant articles
      const kbArticles = await searchKnowledgeBase(ops, ticket, originalMessage);
      log.info(
        { ticketId: ticket.id, kbHits: kbArticles.length },
        `Found ${kbArticles.length} KB article(s) for "${ticket.subject}"`,
      );

      // 4. Draft response — if KB articles found, answer directly; otherwise escalate
      const draft = await draftResponse(ticket, originalMessage, kbArticles);
      const hasKBSupport = kbArticles.length > 0;
      const effectiveConfidence = hasKBSupport ? 'high' : draft.confidence;
      log.info(
        { ticketId: ticket.id, confidence: effectiveConfidence, kbArticles: kbArticles.length, originalConfidence: draft.confidence },
        `Drafted response (confidence: ${effectiveConfidence}, KB articles: ${kbArticles.length})`,
      );

      if (effectiveConfidence === 'high') {
        // 5a. High confidence → send reply
        const gmailMessageId = await sendReply({
          to: ticket.source_email,
          subject: `Re: ${ticket.subject || 'Your SoloBusinessAI Support Request'}`,
          body: draft.body,
          threadId: ticket.thread_id,
          inReplyToMessageId: originalMessage.gmail_message_id || '',
          fromName: 'SoloBusinessAI Support',
        });

        // Log outbound message
        await ops.from('ticket_messages').insert({
          ticket_id: ticket.id,
          direction: 'outbound',
          gmail_message_id: gmailMessageId,
          from_email: process.env.GMAIL_DELEGATED_USER || '',
          to_email: ticket.source_email,
          subject: `Re: ${ticket.subject || ''}`,
          body: draft.body,
          sent_at: new Date().toISOString(),
        });

        // Update ticket status
        await ops
          .from('support_tickets')
          .update({
            status: 'awaiting_response',
            updated_at: new Date().toISOString(),
          })
          .eq('id', ticket.id);

        replied++;
        log.info({ ticketId: ticket.id }, 'Sent reply and marked awaiting_response');
      } else {
        // 5b. Low confidence → send acknowledgement, then escalate internally
        const ackBody = `Hi there,

Thank you for reaching out to SoloBusinessAI Support! We've received your message and want to make sure we get you the right answer.

Your question has been forwarded to a senior member of our team who can help. You can expect a follow-up within a few hours during business hours (Monday–Friday, 9 AM – 6 PM ET).

In the meantime, if you have any additional details to share, just reply to this email and it will be added to your case.

Thank you for your patience!

The SoloBusinessAI Support Team`;

        const gmailMessageId = await sendReply({
          to: ticket.source_email,
          subject: `Re: ${ticket.subject || 'Your SoloBusinessAI Support Request'}`,
          body: ackBody,
          threadId: ticket.thread_id,
          inReplyToMessageId: originalMessage.gmail_message_id || '',
          fromName: 'SoloBusinessAI Support',
        });

        // Log outbound acknowledgement
        await ops.from('ticket_messages').insert({
          ticket_id: ticket.id,
          direction: 'outbound',
          gmail_message_id: gmailMessageId,
          from_email: process.env.GMAIL_DELEGATED_USER || '',
          to_email: ticket.source_email,
          subject: `Re: ${ticket.subject || ''}`,
          body: ackBody,
          sent_at: new Date().toISOString(),
        });

        // Now escalate internally to Avery
        await ops
          .from('support_tickets')
          .update({
            status: 'escalated',
            assigned_agent: 'avery',
            escalated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            resolution_summary: `Clark escalated: ${draft.escalationReason}`,
          })
          .eq('id', ticket.id);

        escalated++;
        log.info(
          { ticketId: ticket.id, reason: draft.escalationReason },
          'Sent acknowledgement and escalated to Avery',
        );
      }
    } catch (err) {
      log.error({ err, ticketId: ticket.id }, 'Failed to handle ticket');
    }
  }

  const summary = `Handled ${tickets.length} ticket(s): ${replied} replied, ${escalated} escalated`;
  log.info(summary);
  return { summary };
}

/**
 * Search the knowledge base for articles relevant to a ticket.
 * Uses keyword matching on tags and content (pgvector semantic search comes later).
 */
async function searchKnowledgeBase(
  ops: ReturnType<typeof getOpsClient>,
  ticket: SupportTicket,
  message: TicketMessage,
): Promise<KnowledgeBaseEntry[]> {
  // Build search keywords from subject + category
  const searchText = `${ticket.subject || ''} ${ticket.category}`.toLowerCase();
  const keywords = searchText
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10);

  // Search all KB entries (FAQ + help docs) — no vertical filter, search everything
  const { data: categoryMatches } = await ops
    .from('knowledge_base')
    .select('*')
    .limit(50);

  if (!categoryMatches || categoryMatches.length === 0) {
    return [];
  }

  // Score articles by keyword overlap with subject + body
  const bodyText = message.body.toLowerCase();
  const scored = (categoryMatches as KnowledgeBaseEntry[]).map(article => {
    let score = 0;
    const articleText = `${article.title} ${article.content} ${article.tags.join(' ')}`.toLowerCase();

    for (const keyword of keywords) {
      if (articleText.includes(keyword)) score += 2;
    }

    // Also check body keywords
    const bodyWords = bodyText.split(/\s+/).filter(w => w.length > 3).slice(0, 20);
    for (const word of bodyWords) {
      if (articleText.includes(word)) score += 1;
    }

    return { article, score };
  });

  // Return top-scoring articles (at least score > 0)
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.article);
}

interface DraftResponse {
  confidence: 'high' | 'low';
  body: string;
  escalationReason?: string;
}

/**
 * Draft a support response using Claude with a confidence evaluation feedback loop.
 *
 * Step 1: Draft the response using KB context
 * Step 2: Evaluate the draft — is it accurate and complete?
 * Step 3: If evaluation says "confident" → return high confidence
 *         If evaluation says "not confident" → return low confidence with reason
 */
async function draftResponse(
  ticket: SupportTicket,
  message: TicketMessage,
  kbArticles: KnowledgeBaseEntry[],
): Promise<DraftResponse> {
  const anthropic = getAnthropicClient();

  // Format KB context
  const kbContext = kbArticles.length > 0
    ? kbArticles
        .map((a, i) => `[Article ${i + 1}] ${a.title}\n${a.content}`)
        .join('\n\n---\n\n')
    : 'No relevant knowledge base articles found.';

  // Step 1: Draft the response
  const draftResult = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1000,
    system: `You are Clark, a friendly and professional Tier 1 support rep for SoloBusinessAI — an AI-powered client intake and business automation platform for solo professionals and small teams across all industries.

Your job is to draft a helpful email reply to a customer's support question.

Guidelines:
- Be warm, professional, and concise
- Use the knowledge base articles provided to answer accurately
- If the KB doesn't cover the question, say so honestly
- Sign off as "The SoloBusinessAI Support Team"
- Never make up features or capabilities that aren't in the KB
- Keep responses under 200 words unless the topic requires more detail
- Use plain text (no markdown) — this is an email reply`,
    messages: [
      {
        role: 'user',
        content: `CUSTOMER EMAIL:
From: ${message.from_email}
Subject: ${ticket.subject}
Category: ${ticket.category}
Priority: ${ticket.priority}

${message.body}

---

KNOWLEDGE BASE ARTICLES:
${kbContext}

---

Please draft an email reply to this customer.`,
      },
    ],
  });

  const draftText = draftResult.content[0].type === 'text'
    ? draftResult.content[0].text
    : '';

  // Step 2: Evaluate confidence (feedback loop)
  const evalResult = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 300,
    system: `You are a quality evaluator for SoloBusinessAI customer support responses. SoloBusinessAI is an AI-powered client intake and business automation platform for solo professionals and small teams across all industries.

Evaluate whether the draft reply below is accurate and complete enough to send to a customer.

Respond with ONLY valid JSON:
{
  "confident": true | false,
  "reason": "Brief explanation of why or why not"
}

Mark as CONFIDENT if:
- The knowledge base articles cover the topic well enough to answer the question
- The response uses information from the KB articles (not guessing)
- The answer is helpful and actionable

Mark as NOT confident ONLY if:
- The response makes up information not supported by any KB article
- The issue requires access to the customer's specific account data (checking their subscription, logs, billing)
- The customer is clearly upset or angry and needs a human touch
- No KB articles are relevant at all`,
    messages: [
      {
        role: 'user',
        content: `ORIGINAL QUESTION:
${message.body}

KNOWLEDGE BASE USED:
${kbContext}

DRAFT REPLY:
${draftText}

Is this draft accurate and safe to send?`,
      },
    ],
  });

  const evalText = evalResult.content[0].type === 'text'
    ? evalResult.content[0].text
    : '';

  try {
    // Strip markdown code fences if Claude wraps the JSON
    const cleanJson = evalText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const evaluation = JSON.parse(cleanJson) as { confident: boolean; reason: string };

    if (evaluation.confident) {
      return { confidence: 'high', body: draftText };
    } else {
      return {
        confidence: 'low',
        body: draftText,
        escalationReason: evaluation.reason,
      };
    }
  } catch {
    // If we can't parse the evaluation, escalate to be safe
    return {
      confidence: 'low',
      body: draftText,
      escalationReason: 'Could not evaluate response confidence — escalating to be safe',
    };
  }
}
