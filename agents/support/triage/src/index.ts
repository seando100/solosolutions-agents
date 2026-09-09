import {
  agentLogger,
  getAnthropicClient,
  DEFAULT_MODEL,
  getOpsClient,
  getPlatformClient,
  fetchNewEmails,
  markAsRead,
  getLabelId,
} from '@solo/shared';
import type {
  AgentRunResult,
  TicketPriority,
  TicketCategory,
  InboundEmail,
} from '@solo/shared';
import { run as runClark } from '../../tier1-responder/src/index.js';
import { run as runCasey } from '../../bug-detective/src/index.js';
import { processFounderReply } from '../../escalation/src/index.js';

/**
 * ═══════════════════════════════════════════
 * RILEY — Support Triage Specialist
 * ═══════════════════════════════════════════
 *
 * "I read every inbound email, figure out what it's about,
 *  how urgent it is, and get it to the right person."
 *
 * Team: Support
 * Trigger: Every 2 minutes (cron)
 *
 * Flow:
 *   1. Check Gmail for new messages (since last historyId)
 *   2. For each new email:
 *      a. Classify priority + category using Claude
 *      b. Create support_ticket in ops DB
 *      c. Hand off to assigned agent (Clark for Tier 1, Casey for technical)
 *      d. Mark email as read
 *   3. Update gmail_sync_state with new historyId
 * ═══════════════════════════════════════════
 */
const SUPPORT_LABEL_NAME = 'support@solosolutionsai.com';

export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('riley', runId);
  const ops = getOpsClient();

  // ── Phase 1: Check in-portal tickets from Clark (platform DB) ──
  log.info('Checking for in-portal support tickets...');
  let portalTicketsProcessed = 0;
  try {
    const platform = getPlatformClient();

    // Find new tickets created by Clark in the portal that haven't been triaged
    const { data: portalTickets } = await platform
      .from('support_tickets')
      .select('*')
      .eq('status', 'new')
      .is('thread_id', null)  // No Gmail thread = created in portal
      .order('created_at', { ascending: true })
      .limit(10);

    if (portalTickets && portalTickets.length > 0) {
      log.info({ count: portalTickets.length }, `Found ${portalTickets.length} in-portal ticket(s) to triage`);

      for (const ticket of portalTickets) {
        try {
          // Classify the ticket
          const classification = await classifyPortalTicket(ticket);
          log.info(
            { priority: classification.priority, category: classification.category, ticketId: ticket.id },
            `Classified portal ticket: "${ticket.subject}"`,
          );

          // Update the ticket with classification and assignment
          const assignedAgent = classification.category === 'technical' ? 'casey' : 'clark';
          await platform
            .from('support_tickets')
            .update({
              priority: classification.priority,
              category: classification.category,
              assigned_agent: assignedAgent,
              status: 'triaged',
            })
            .eq('id', ticket.id);

          // Mirror the ticket to ops DB for agent tracking
          try {
            await ops.from('support_tickets').insert({
              id: ticket.id,
              vertical: ticket.vertical || 'global',
              source_email: ticket.source_email || 'in-portal-chat',
              subject: ticket.subject,
              body_preview: ticket.body_preview?.slice(0, 500),
              priority: classification.priority,
              category: classification.category,
              status: 'triaged',
              assigned_agent: assignedAgent,
              customer_id: ticket.customer_id,
            });
          } catch (mirrorErr) {
            // May already exist — that's OK
            log.debug({ err: mirrorErr, ticketId: ticket.id }, 'Ops mirror insert skipped (may already exist)');
          }

          portalTicketsProcessed++;

          // Hand off to Casey for technical issues
          if (assignedAgent === 'casey') {
            log.info({ ticketId: ticket.id }, 'Handing portal ticket to Casey...');
            try {
              const caseyResult = await runCasey(runId);
              log.info({ ticketId: ticket.id }, `Casey: ${caseyResult.summary}`);
            } catch (err) {
              log.error({ err, ticketId: ticket.id }, 'Casey failed — ticket stays in queue');
            }
          }

          log.info({ ticketId: ticket.id, agent: assignedAgent }, `Portal ticket triaged and assigned`);
        } catch (err) {
          log.error({ err, ticketId: ticket.id }, 'Failed to process portal ticket');
        }
      }
    } else {
      log.info('No new portal tickets');
    }
  } catch (err) {
    log.error({ err }, 'Failed to check portal tickets — continuing to Gmail');
  }

  // ── Phase 2: Check Gmail for new support emails ──
  log.info('Checking Gmail for new support emails...');

  // 1. Resolve the support label so we only read support emails
  const supportLabelId = await getLabelId(SUPPORT_LABEL_NAME) ?? undefined;
  if (!supportLabelId) {
    log.warn(`Could not find Gmail label '${SUPPORT_LABEL_NAME}' — falling back to full inbox scan`);
  }

  // 2. Get last sync state
  const { data: syncState } = await ops
    .from('gmail_sync_state')
    .select('last_history_id')
    .eq('email_address', process.env.GMAIL_DELEGATED_USER || '')
    .single();

  const lastHistoryId = syncState?.last_history_id || undefined;

  // 3. Fetch new emails (filtered to support label)
  const { emails, newHistoryId } = await fetchNewEmails(lastHistoryId, supportLabelId);

  if (emails.length === 0) {
    log.info('No new emails to process');

    // Still update history ID so we don't re-scan
    await upsertSyncState(ops, newHistoryId);

    return { summary: 'Checked inbox — no new emails' };
  }

  log.info({ count: emails.length }, `Found ${emails.length} new email(s) to triage`);

  // 3. Classify and create tickets for each email
  let created = 0;
  for (const email of emails) {
    try {
      // Check if we already tracked this message (our own outbound reply)
      const { data: alreadyTracked } = await ops
        .from('ticket_messages')
        .select('id')
        .eq('gmail_message_id', email.messageId)
        .single();

      if (alreadyTracked) {
        log.debug({ messageId: email.messageId }, 'Skipping already-tracked message (our outbound)');
        continue;
      }

      const founderEmail = process.env.NOTIFICATION_EMAIL || 'sean@solosolutionsai.com';
      const isFromSelf = email.from.includes(process.env.GMAIL_DELEGATED_USER || '');
      const isFounderReply = email.from.includes(founderEmail);

      // Check if this thread already has a ticket
      const { data: existingTicket } = await ops
        .from('support_tickets')
        .select('id')
        .eq('thread_id', email.threadId)
        .single();

      if (existingTicket) {
        // Thread already tracked — add as a new message on the existing ticket
        await ops.from('ticket_messages').insert({
          ticket_id: existingTicket.id,
          direction: isFromSelf ? 'internal' : 'inbound',
          gmail_message_id: email.messageId,
          from_email: email.from,
          to_email: email.to,
          subject: email.subject,
          body: email.body,
          sent_at: email.receivedAt,
        });

        if (isFounderReply) {
          // IMPORTANT: Skip Avery's own escalation notifications.
          // These come FROM the same address as the founder, so we must
          // check the content to distinguish them from actual founder replies.
          const isEscalationNotification = email.body.includes('[ESCALATION]') ||
            email.subject.includes('[ESCALATION]');

          if (isEscalationNotification) {
            log.debug({ ticketId: existingTicket.id }, 'Skipping Avery escalation notification (not a founder reply)');
          } else {
            // Check if this ticket is assigned to Avery (escalated)
            const { data: ticketDetails } = await ops
              .from('support_tickets')
              .select('assigned_agent, status')
              .eq('id', existingTicket.id)
              .single();

            if (ticketDetails?.assigned_agent === 'avery' &&
                (ticketDetails.status === 'in_progress' || ticketDetails.status === 'escalated')) {
              log.info({ ticketId: existingTicket.id }, 'Founder replied to escalation — routing to Avery');
              try {
                const averyResult = await processFounderReply(runId, email.threadId, email.body);
                log.info({ ticketId: existingTicket.id }, `Avery: ${averyResult.summary}`);
              } catch (err) {
                log.error({ err, ticketId: existingTicket.id }, 'Avery failed to process founder reply');
              }
            } else {
              log.info({ ticketId: existingTicket.id }, 'Added founder message to existing ticket');
            }
          }
        } else {
          log.info({ ticketId: existingTicket.id }, 'Added message to existing ticket');
        }
      } else {
        // Don't create tickets from our own outbound emails
        if (isFromSelf) {
          log.debug({ messageId: email.messageId }, 'Skipping own email — no existing ticket');
          continue;
        }

        // New thread — classify and create ticket
        const classification = await classifyEmail(email);
        log.info(
          { priority: classification.priority, category: classification.category },
          `Classified: "${email.subject}"`,
        );

        const { data: ticket } = await ops
          .from('support_tickets')
          .insert({
            source_email: email.from,
            source_message_id: email.messageId,
            thread_id: email.threadId,
            subject: email.subject,
            body_preview: email.body.slice(0, 500),
            priority: classification.priority,
            category: classification.category,
            status: 'new',
            assigned_agent: classification.category === 'technical' ? 'casey' : 'clark',
          })
          .select('id')
          .single();

        if (ticket) {
          // Store the full message
          await ops.from('ticket_messages').insert({
            ticket_id: ticket.id,
            direction: 'inbound',
            gmail_message_id: email.messageId,
            from_email: email.from,
            to_email: email.to,
            subject: email.subject,
            body: email.body,
            sent_at: email.receivedAt,
          });
          created++;

          // Hand off to the assigned agent immediately
          const assignedAgent = classification.category === 'technical' ? 'casey' : 'clark';
          if (assignedAgent === 'clark') {
            log.info({ ticketId: ticket.id }, 'Handing off to Clark...');
            try {
              const clarkResult = await runClark(runId);
              log.info({ ticketId: ticket.id }, `Clark: ${clarkResult.summary}`);
            } catch (err) {
              log.error({ err, ticketId: ticket.id }, 'Clark failed — ticket stays in queue');
            }
          }
          if (assignedAgent === 'casey') {
            log.info({ ticketId: ticket.id }, 'Handing off to Casey...');
            try {
              const caseyResult = await runCasey(runId);
              log.info({ ticketId: ticket.id }, `Casey: ${caseyResult.summary}`);
            } catch (err) {
              log.error({ err, ticketId: ticket.id }, 'Casey failed — ticket stays in queue');
            }
          }
        }
      }

      // Mark as read so we don't re-process
      await markAsRead(email.messageId);
    } catch (err) {
      log.error({ err, messageId: email.messageId }, 'Failed to process email');
    }
  }

  // 4. Update sync state
  await upsertSyncState(ops, newHistoryId);

  const summary = `Triaged ${portalTicketsProcessed} portal ticket(s) + ${emails.length} email(s), created ${created} new email ticket(s)`;
  log.info(summary);
  return { summary };
}

/** Use Claude to classify an in-portal support ticket */
async function classifyPortalTicket(ticket: {
  subject: string;
  body_preview?: string;
  source_email?: string;
}): Promise<{
  priority: TicketPriority;
  category: TicketCategory;
}> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 200,
    system: `You are Riley, a support triage specialist for SoloBusinessAI (an AI-powered client intake and business automation platform for solo professionals).

Classify the following support ticket from an in-portal chat. Respond with ONLY valid JSON:
{
  "priority": "urgent" | "normal" | "low",
  "category": "billing" | "technical" | "onboarding" | "feature_request" | "general"
}

Priority guide:
- urgent: service down, can't access account, payment failed, data loss
- normal: how-to questions, feature questions, general support
- low: feature requests, feedback, general inquiries

Category guide:
- billing: subscription, payment, pricing, invoices, cancellation
- technical: ONLY actual bugs, errors, things broken or not working
- onboarding: setup help, getting started, configuration, how-to, connecting integrations
- feature_request: suggestions, wishlist items
- general: everything else`,
    messages: [
      {
        role: 'user',
        content: `Subject: ${ticket.subject}\nFrom: ${ticket.source_email || 'portal chat'}\n\n${ticket.body_preview || ''}`,
      },
    ],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(text) as { priority: TicketPriority; category: TicketCategory };
  } catch {
    return { priority: 'normal', category: 'general' };
  }
}

/** Use Claude to classify an email's priority and category */
async function classifyEmail(email: InboundEmail): Promise<{
  priority: TicketPriority;
  category: TicketCategory;
}> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 200,
    system: `You are Riley, a support triage specialist for SoloBusinessAI (an AI-powered client intake and business automation platform for solo professionals).

Classify the following support email. Respond with ONLY valid JSON, no other text:
{
  "priority": "urgent" | "normal" | "low",
  "category": "billing" | "technical" | "onboarding" | "feature_request" | "general"
}

Priority guide:
- urgent: service down, can't access account, payment failed, legal compliance issue
- normal: how-to questions, feature questions, general support
- low: feature requests, feedback, general inquiries

Category guide:
- billing: subscription, payment, pricing, invoices, cancellation
- technical: ONLY actual bugs, error messages, things that were working but stopped, system outages
- onboarding: setup help, getting started, configuration, how-to questions, connecting integrations (HubSpot, Calendly, webhooks), customizing settings, understanding features
- feature_request: suggestions, wishlist items, "it would be nice if..."
- general: everything else

IMPORTANT: "How do I connect HubSpot/Calendly?" or "Help with setup" is ONBOARDING, not technical. Only classify as technical if something is actually broken or producing errors.`,
    messages: [
      {
        role: 'user',
        content: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`,
      },
    ],
  });

  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(text) as { priority: TicketPriority; category: TicketCategory };
  } catch {
    // Default classification if parsing fails
    return { priority: 'normal', category: 'general' };
  }
}

/** Upsert the Gmail sync state so we know where to pick up next time */
async function upsertSyncState(
  ops: ReturnType<typeof getOpsClient>,
  historyId: string,
): Promise<void> {
  const email = process.env.GMAIL_DELEGATED_USER || '';
  await ops.from('gmail_sync_state').upsert(
    {
      email_address: email,
      last_history_id: historyId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'email_address' },
  );
}
