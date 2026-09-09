import {
  agentLogger,
  getAnthropicClient,
  DEFAULT_MODEL,
  getOpsClient,
  getPlatformClient,
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
 * CASEY — Technical Investigator
 * ═══════════════════════════════════════════
 *
 * "When something's broken, I dig into the logs before
 *  anyone panics. Usually I can tell you what happened in minutes."
 *
 * Team: Support
 * Trigger: Invoked by Riley when a ticket is classified as 'technical'
 *
 * Flow:
 *   1. Find tickets assigned to 'casey' with status 'new'
 *   2. For each ticket:
 *      a. Load original email from ticket_messages
 *      b. Extract clues (email domain → look up customer in platform DB)
 *      c. Query platform DB for account status, recent activity, errors
 *      d. Search KB for known technical issues
 *      e. Use Claude to analyze findings and draft a response
 *      f. High confidence → send diagnostic reply, mark 'awaiting_response'
 *      g. Low confidence → send acknowledgement, escalate to Avery with tech context
 *   3. The customer ALWAYS gets a reply — never silence
 * ═══════════════════════════════════════════
 */
export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('casey', runId);
  const ops = getOpsClient();

  log.info('Checking for technical tickets assigned to me...');

  // 1. Find all tickets assigned to Casey (new or triaged)
  // Check ops DB first (email-sourced tickets)
  const { data: opsTickets, error: ticketError } = await ops
    .from('support_tickets')
    .select('*')
    .eq('assigned_agent', 'casey')
    .in('status', ['new', 'triaged'])
    .order('created_at', { ascending: true });

  // Also check platform DB for portal-sourced tickets assigned to casey
  let platformTickets: any[] = [];
  try {
    const platform = getPlatformClient();
    const { data: pTickets } = await platform
      .from('support_tickets')
      .select('*')
      .eq('assigned_agent', 'casey')
      .in('status', ['new', 'triaged'])
      .order('created_at', { ascending: true });
    platformTickets = pTickets || [];
  } catch (err) {
    log.debug({ err }, 'Could not check platform DB for tickets — continuing with ops only');
  }

  // Merge and deduplicate by ID
  const seenIds = new Set<string>();
  const allTickets: any[] = [];
  for (const t of [...(opsTickets || []), ...platformTickets]) {
    if (!seenIds.has(t.id)) {
      seenIds.add(t.id);
      allTickets.push(t);
    }
  }
  const tickets = allTickets;

  if (ticketError) {
    log.error({ err: ticketError }, 'Failed to fetch tickets');
    return { summary: `Error fetching tickets: ${ticketError.message}` };
  }

  if (!tickets || tickets.length === 0) {
    log.info('No new technical tickets for me right now');
    return { summary: 'No new technical tickets to investigate' };
  }

  log.info({ count: tickets.length }, `Found ${tickets.length} technical ticket(s) to investigate`);

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

      // 3. Investigate: look up the customer in the platform DB
      const investigation = await investigate(ticket, originalMessage, log);

      // 4. Search KB for known technical issues
      const kbArticles = await searchTechnicalKB(ops, ticket, originalMessage);
      log.info(
        { ticketId: ticket.id, kbHits: kbArticles.length },
        `Found ${kbArticles.length} KB article(s) for "${ticket.subject}"`,
      );

      // 5. Draft response with diagnosis
      const draft = await draftDiagnosis(ticket, originalMessage, investigation, kbArticles);
      log.info(
        { ticketId: ticket.id, confidence: draft.confidence },
        `Drafted diagnosis (confidence: ${draft.confidence})`,
      );

      if (draft.confidence === 'high') {
        // 6a. High confidence → send diagnostic reply
        const gmailMessageId = await sendReply({
          to: ticket.source_email,
          subject: `Re: ${ticket.subject || 'Your SoloBusinessAI Support Request'}`,
          body: draft.body,
          threadId: ticket.thread_id,
          inReplyToMessageId: originalMessage.gmail_message_id || '',
          fromName: 'SoloBusinessAI Support',
        });

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

        await ops
          .from('support_tickets')
          .update({
            status: 'awaiting_response',
            resolution_summary: `Casey diagnosed: ${draft.diagnosis}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', ticket.id);

        replied++;
        log.info({ ticketId: ticket.id }, 'Sent diagnostic reply');
      } else {
        // 6b. Low confidence → acknowledge + escalate with technical context
        const ackBody = `Hi there,

Thank you for reaching out to SoloBusinessAI Support! We've received your report and our technical team is looking into it.

Your issue has been flagged for priority investigation. You can expect a follow-up within a few hours during business hours (Monday–Friday, 9 AM – 6 PM ET).

In the meantime, if you notice any additional details — error messages, screenshots, or steps that reproduce the issue — please reply to this email and they'll be added to your case.

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

        // Escalate to Avery with technical investigation context
        await ops
          .from('support_tickets')
          .update({
            status: 'escalated',
            assigned_agent: 'avery',
            escalated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            resolution_summary: `Casey escalated: ${draft.escalationReason}\n\nTechnical findings:\n${draft.diagnosis}`,
          })
          .eq('id', ticket.id);

        escalated++;
        log.info(
          { ticketId: ticket.id, reason: draft.escalationReason },
          'Sent acknowledgement and escalated to Avery with technical context',
        );
      }
    } catch (err) {
      log.error({ err, ticketId: ticket.id }, 'Failed to investigate ticket');
    }
  }

  const summary = `Investigated ${tickets.length} ticket(s): ${replied} diagnosed, ${escalated} escalated`;
  log.info(summary);
  return { summary };
}

// ── Investigation ──

interface InvestigationResult {
  customerFound: boolean;
  accountStatus?: string;
  plan?: string;
  lastLogin?: string;
  recentIntakes?: number;
  signupDate?: string;
  findings: string;
}

/**
 * Investigate the customer's account in the platform DB.
 * Extracts the email from the ticket, looks up their account,
 * and gathers relevant technical context.
 */
async function investigate(
  ticket: SupportTicket,
  message: TicketMessage,
  log: ReturnType<typeof agentLogger>,
): Promise<InvestigationResult> {
  try {
    const platformDb = getPlatformClient();

    // Extract the customer's email (strip display name)
    const emailMatch = ticket.source_email.match(/<([^>]+)>/) ||
      [null, ticket.source_email.trim()];
    const rawEmail = (emailMatch[1] || ticket.source_email).toLowerCase();
    // Normalize googlemail.com → gmail.com (Gmail treats them as identical)
    const customerEmail = rawEmail.replace(/@googlemail\.com$/, '@gmail.com');

    // Look up the customer via Supabase Auth
    const { data: authData } = await platformDb.auth.admin.listUsers();
    const user = authData?.users?.find(u =>
      u.email?.toLowerCase().replace(/@googlemail\.com$/, '@gmail.com') === customerEmail
    );

    if (!user) {
      log.info({ ticketId: ticket.id, email: customerEmail }, 'Customer not found in platform auth');
      return {
        customerFound: false,
        findings: `No account found for ${customerEmail} in the platform database. They may not have signed up yet, or may be using a different email.`,
      };
    }

    const metadata = user.user_metadata || {};

    const findings = [
      `Account found: ${customerEmail}`,
      `User ID: ${user.id}`,
      `Email verified: ${user.email_confirmed_at ? 'yes' : 'no'}`,
      `Signed up: ${user.created_at ? new Date(user.created_at).toLocaleDateString() : 'unknown'}`,
      `Last sign-in: ${user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'never'}`,
      metadata.full_name ? `Name: ${metadata.full_name}` : null,
      metadata.firm_name ? `Firm: ${metadata.firm_name}` : null,
      metadata.plan ? `Plan: ${metadata.plan}` : null,
    ].filter(Boolean).join('\n');

    log.info({ ticketId: ticket.id }, `Found customer account: ${customerEmail}`);

    return {
      customerFound: true,
      accountStatus: 'active',
      plan: metadata.plan || 'unknown',
      lastLogin: user.last_sign_in_at || undefined,
      signupDate: user.created_at || undefined,
      findings,
    };
  } catch (err) {
    // If platform DB isn't accessible, proceed without investigation
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn({ ticketId: ticket.id, err: errMsg }, 'Could not query platform DB — proceeding without account data');
    return {
      customerFound: false,
      findings: `Could not access platform database: ${errMsg}. Proceeding with email content only.`,
    };
  }
}

// ── Knowledge Base Search ──

async function searchTechnicalKB(
  ops: ReturnType<typeof getOpsClient>,
  ticket: SupportTicket,
  message: TicketMessage,
): Promise<KnowledgeBaseEntry[]> {
  const searchText = `${ticket.subject || ''} ${ticket.category} technical`.toLowerCase();
  const keywords = searchText
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10);

  // Search both FAQ and resolved_ticket categories
  const { data: articles } = await ops
    .from('knowledge_base')
    .select('*')
    .limit(30);

  if (!articles || articles.length === 0) return [];

  const bodyText = message.body.toLowerCase();
  const scored = (articles as KnowledgeBaseEntry[]).map(article => {
    let score = 0;
    const articleText = `${article.title} ${article.content} ${article.tags.join(' ')}`.toLowerCase();

    for (const keyword of keywords) {
      if (articleText.includes(keyword)) score += 2;
    }

    const bodyWords = bodyText.split(/\s+/).filter(w => w.length > 3).slice(0, 20);
    for (const word of bodyWords) {
      if (articleText.includes(word)) score += 1;
    }

    return { article, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.article);
}

// ── Diagnosis Draft ──

interface DiagnosisDraft {
  confidence: 'high' | 'low';
  body: string;
  diagnosis: string;
  escalationReason?: string;
}

async function draftDiagnosis(
  ticket: SupportTicket,
  message: TicketMessage,
  investigation: InvestigationResult,
  kbArticles: KnowledgeBaseEntry[],
): Promise<DiagnosisDraft> {
  const anthropic = getAnthropicClient();

  const kbContext = kbArticles.length > 0
    ? kbArticles
        .map((a, i) => `[Article ${i + 1}] ${a.title}\n${a.content}`)
        .join('\n\n---\n\n')
    : 'No relevant knowledge base articles found.';

  // Step 1: Analyze and draft
  const draftResult = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 1200,
    system: `You are Casey, a Technical Investigator for SoloBusinessAI — an AI-powered client intake and business automation platform for solo professionals and small teams across all industries.

Your job is to diagnose technical issues customers report. You have access to their account data and the knowledge base.

Guidelines:
- Be warm, professional, and technically precise
- If you can identify the issue, explain it clearly and provide steps to resolve
- If you find relevant account data, reference it (e.g. "I checked your account and can see...")
- Never expose sensitive data (passwords, tokens, internal IDs) — only reference observable facts
- If the issue requires backend changes or is a known bug, be honest about it
- Sign off as "The SoloBusinessAI Support Team"
- Use plain text (no markdown) — this is an email reply
- Keep responses under 300 words

Also output a brief internal diagnosis summary (not shown to the customer) that explains what you found.

Respond with ONLY valid JSON:
{
  "customerReply": "The email body to send to the customer",
  "diagnosis": "Internal summary of what Casey found (for the team)"
}`,
    messages: [
      {
        role: 'user',
        content: `CUSTOMER EMAIL:
From: ${message.from_email}
Subject: ${ticket.subject}
Priority: ${ticket.priority}

${message.body}

---

ACCOUNT INVESTIGATION:
${investigation.findings}

---

KNOWLEDGE BASE ARTICLES:
${kbContext}

---

Please diagnose this issue and draft a reply.`,
      },
    ],
  });

  const draftText = draftResult.content[0].type === 'text'
    ? draftResult.content[0].text
    : '';

  let customerReply: string;
  let diagnosis: string;

  try {
    const cleanJson = draftText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson) as { customerReply: string; diagnosis: string };
    customerReply = parsed.customerReply;
    diagnosis = parsed.diagnosis;
  } catch {
    // If JSON parsing fails, use the raw text as the reply
    customerReply = draftText;
    diagnosis = 'Could not parse structured diagnosis';
  }

  // Step 2: Evaluate confidence
  const evalResult = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 300,
    system: `You are a quality evaluator for SoloBusinessAI technical support responses. SoloBusinessAI is an AI-powered client intake and business automation platform for solo professionals and small teams across all industries.

Evaluate whether Casey's draft reply accurately diagnoses the customer's technical issue and is safe to send.

Respond with ONLY valid JSON:
{
  "confident": true | false,
  "reason": "Brief explanation"
}

Mark as NOT confident if:
- The diagnosis is speculative without supporting evidence
- The issue requires backend access or code changes to fix
- The customer's problem isn't addressed by the investigation or KB
- The issue could be a bug that needs engineering attention
- The response makes promises about fixes that haven't been confirmed`,
    messages: [
      {
        role: 'user',
        content: `ORIGINAL ISSUE:
${message.body}

ACCOUNT DATA:
${investigation.findings}

CASEY'S DIAGNOSIS:
${diagnosis}

DRAFT REPLY TO CUSTOMER:
${customerReply}

Is this diagnosis accurate and safe to send?`,
      },
    ],
  });

  const evalText = evalResult.content[0].type === 'text'
    ? evalResult.content[0].text
    : '';

  try {
    const cleanJson = evalText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const evaluation = JSON.parse(cleanJson) as { confident: boolean; reason: string };

    if (evaluation.confident) {
      return { confidence: 'high', body: customerReply, diagnosis };
    } else {
      return {
        confidence: 'low',
        body: customerReply,
        diagnosis,
        escalationReason: evaluation.reason,
      };
    }
  } catch {
    return {
      confidence: 'low',
      body: customerReply,
      diagnosis,
      escalationReason: 'Could not evaluate diagnosis confidence — escalating to be safe',
    };
  }
}
