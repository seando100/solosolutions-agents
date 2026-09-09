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
  InboundEmail,
} from '@solo/shared';

/**
 * ═══════════════════════════════════════════
 * QUINN — Feedback Analyst
 * ═══════════════════════════════════════════
 *
 * "After every resolved ticket, I follow up. I turn patterns
 *  in feedback into a ranked feature backlog."
 *
 * Team: Support
 * Trigger: Hourly (cron)
 *
 * Flow:
 *   Job 1 — Send follow-ups:
 *     1. Find tickets resolved 4+ hours ago without a follow-up
 *     2. Send a "How did we do?" email with 1–5 rating request
 *     3. Record in the feedback table
 *
 *   Job 2 — Collect replies:
 *     1. Find feedback records where follow-up sent but no reply yet
 *     2. Check the ticket thread for new inbound messages
 *     3. Use Claude to extract rating, sentiment, feature requests
 *     4. Store results in feedback + feature_requests tables
 *
 *   Job 3 — Daily digest (runs once per day at 7 AM):
 *     1. Compile all feedback from the last 24 hours
 *     2. Email summary to founder
 * ═══════════════════════════════════════════
 */

const FOLLOW_UP_DELAY_HOURS = 4;
const DIGEST_HOUR = 7; // 7 AM ET

export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('quinn', runId);
  const ops = getOpsClient();

  log.info('Starting feedback collection cycle...');

  // Job 1: Send follow-ups on recently resolved tickets
  const followUpCount = await sendFollowUps(ops, log);

  // Job 2: Collect and process feedback replies
  const feedbackCount = await collectFeedbackReplies(ops, log);

  // Job 3: Daily digest (only at the digest hour)
  let digestSent = false;
  const currentHour = new Date().getUTCHours();
  // Convert 7 AM ET to UTC (ET = UTC-5, or UTC-4 during DST)
  // We'll use a range to handle both EST and EDT
  if (currentHour === 11 || currentHour === 12) {
    digestSent = await sendDailyDigest(ops, log);
  }

  const parts = [
    `${followUpCount} follow-up(s) sent`,
    `${feedbackCount} feedback reply(s) processed`,
  ];
  if (digestSent) parts.push('daily digest sent');

  const summary = parts.join(', ');
  log.info(summary);
  return { summary };
}

// ── Job 1: Send Follow-ups ──
//
// AT-MOST-ONCE, enforced by the database, not this code: support_feedback has
// UNIQUE(ticket_id) and the marker row is INSERTED (claimed) BEFORE any email
// is sent. If anything fails after the claim, the worst case is a follow-up
// that never went out (released for retry when possible), never a duplicate.
// The old code sent first and recorded after, into `feedback` — a table whose
// schema belongs to the in-app product-feedback feature and rejects every
// insert — which is how one ticket received hourly "rate us" emails on 31 Jul.

const RATE_SUPPORT_URL =
  process.env.RATE_SUPPORT_URL ||
  'https://ffzmaexmpwvurhnpqxap.supabase.co/functions/v1/rate-support';

function escHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function buildFollowUpEmail(subject: string, ratingToken: string) {
  const link = (n: number) => `${RATE_SUPPORT_URL}?token=${ratingToken}&score=${n}`;

  const text = `Hi there,

We recently helped you with your support request${subject ? ` ("${subject}")` : ''} and would love to know how we did.

Rate your experience with one click:

  1 - Poor:      ${link(1)}
  2 - Fair:      ${link(2)}
  3 - Average:   ${link(3)}
  4 - Good:      ${link(4)}
  5 - Excellent: ${link(5)}

Prefer words? Just reply to this email. Suggestions and feature ideas land straight with the team.

Thank you!
SoloBusinessAI Support`;

  const starCells = [1, 2, 3, 4, 5]
    .map(
      (n) => `<td align="center" style="padding:0 7px">
        <a href="${link(n)}" aria-label="Rate ${n} out of 5"
           style="text-decoration:none;font-size:36px;line-height:1;color:#eaa64a;display:inline-block">&#9733;</a>
        <div style="font-size:11px;color:#8a94a3;font-family:Arial,sans-serif;margin-top:2px">${n}</div>
      </td>`,
    )
    .join('');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f8fb">
  <div style="max-width:520px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
    <div style="background:#ffffff;border:1px solid #e3e8ef;border-radius:14px;padding:30px 28px">
      <div style="font-size:19px;font-weight:700;color:#1a2433">How did we do?</div>
      <p style="font-size:14px;line-height:1.6;color:#5a6675;margin:10px 0 4px">
        We recently helped you with${subject ? ` &ldquo;${escHtml(subject)}&rdquo;` : ' your support request'} and would
        love to know how it went. Tap a star &mdash; it takes one second.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:16px auto 6px">
        <tr>${starCells}</tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:2px">
        <tr>
          <td style="font-size:11px;color:#8a94a3;font-family:Arial,sans-serif">Poor</td>
          <td align="right" style="font-size:11px;color:#8a94a3;font-family:Arial,sans-serif">Excellent</td>
        </tr>
      </table>
      <p style="font-size:13px;line-height:1.6;color:#5a6675;margin:18px 0 0">
        Prefer words? Just reply to this email &mdash; suggestions and feature ideas land straight with the team.
      </p>
    </div>
    <div style="text-align:center;font-size:12px;color:#8a94a3;padding:14px 0 0">SoloBusinessAI Support</div>
  </div>
  </body></html>`;

  return { text, html };
}

async function sendFollowUps(
  ops: ReturnType<typeof getOpsClient>,
  log: ReturnType<typeof agentLogger>,
): Promise<number> {
  // Find resolved tickets older than FOLLOW_UP_DELAY_HOURS
  const cutoff = new Date(Date.now() - FOLLOW_UP_DELAY_HOURS * 60 * 60 * 1000).toISOString();

  const { data: resolvedTickets, error } = await ops
    .from('support_tickets')
    .select('*')
    .eq('status', 'resolved')
    .lt('resolved_at', cutoff)
    .order('resolved_at', { ascending: true })
    .limit(20);

  if (error) {
    log.error({ err: error }, 'Failed to fetch resolved tickets');
    return 0;
  }

  if (!resolvedTickets || resolvedTickets.length === 0) {
    log.info('No resolved tickets ready for follow-up');
    return 0;
  }

  let sent = 0;
  for (const ticket of resolvedTickets as SupportTicket[]) {
    // In-portal tickets without a real inbox get no email follow-up.
    if (!ticket.source_email || !ticket.source_email.includes('@')) continue;

    // 1. CLAIM the follow-up before sending anything. A unique violation means
    //    it was already sent (or claimed); silently skip. Any other error is
    //    a real problem and must be visible, never swallowed.
    const { data: marker, error: claimErr } = await ops
      .from('support_feedback')
      .insert({ ticket_id: ticket.id, customer_email: ticket.source_email })
      .select('id, rating_token')
      .single();

    if (claimErr || !marker) {
      if (claimErr && claimErr.code !== '23505') {
        log.error({ err: claimErr, ticketId: ticket.id }, 'Failed to claim follow-up; NOT sending');
      }
      continue;
    }

    try {
      // Threading: reply into the existing conversation
      const { data: lastOutbound } = await ops
        .from('ticket_messages')
        .select('gmail_message_id')
        .eq('ticket_id', ticket.id)
        .eq('direction', 'outbound')
        .order('sent_at', { ascending: false })
        .limit(1);

      const inReplyTo = (lastOutbound as TicketMessage[] | null)?.[0]?.gmail_message_id || '';
      const { text, html } = buildFollowUpEmail(ticket.subject || '', marker.rating_token as string);

      const gmailMessageId = await sendReply({
        to: ticket.source_email,
        subject: `Re: ${ticket.subject || 'Your SoloBusinessAI Support Request'}`,
        body: text,
        html,
        threadId: ticket.thread_id,
        inReplyToMessageId: inReplyTo,
        fromName: 'SoloBusinessAI Support',
      });

      // 2. Record the send on the claimed row. If this fails the marker still
      //    exists, so the customer can never be emailed twice.
      const { error: recErr } = await ops
        .from('support_feedback')
        .update({
          follow_up_sent_at: new Date().toISOString(),
          follow_up_message_id: gmailMessageId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', marker.id);
      if (recErr) log.error({ err: recErr, ticketId: ticket.id }, 'Follow-up sent but recording failed');

      const { error: msgErr } = await ops.from('ticket_messages').insert({
        ticket_id: ticket.id,
        direction: 'outbound',
        gmail_message_id: gmailMessageId,
        from_email: process.env.GMAIL_DELEGATED_USER || '',
        to_email: ticket.source_email,
        subject: `Re: ${ticket.subject || ''}`,
        body: text,
        sent_at: new Date().toISOString(),
      });
      if (msgErr) log.error({ err: msgErr, ticketId: ticket.id }, 'Failed to record follow-up in ticket_messages');

      sent++;
      log.info({ ticketId: ticket.id }, 'Sent follow-up email');
    } catch (err) {
      // Send failed: release the claim so the next hourly run can retry.
      // Guarded on follow_up_sent_at IS NULL so a recorded send is never released.
      log.error({ err, ticketId: ticket.id }, 'Failed to send follow-up; releasing claim for retry');
      await ops
        .from('support_feedback')
        .delete()
        .eq('id', marker.id)
        .is('follow_up_sent_at', null);
    }
  }

  return sent;
}

// ── Job 2: Collect Feedback Replies ──

interface FeedbackExtraction {
  rating: number | null;
  comment: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  featureRequests: Array<{ title: string; description: string; category: string }>;
}

async function collectFeedbackReplies(
  ops: ReturnType<typeof getOpsClient>,
  log: ReturnType<typeof agentLogger>,
): Promise<number> {
  // Find feedback records where we sent a follow-up but haven't received a reply
  const { data: pendingFeedback, error } = await ops
    .from('support_feedback')
    .select('*')
    .not('follow_up_sent_at', 'is', null)
    .is('feedback_received_at', null)
    .order('follow_up_sent_at', { ascending: true })
    .limit(30);

  if (error) {
    log.error({ err: error }, 'Failed to fetch pending feedback');
    return 0;
  }

  if (!pendingFeedback || pendingFeedback.length === 0) {
    log.info('No pending feedback to check');
    return 0;
  }

  log.info({ count: pendingFeedback.length }, `Checking ${pendingFeedback.length} pending feedback thread(s)`);

  let processed = 0;
  for (const fb of pendingFeedback as FeedbackRow[]) {
    try {
      // Check ticket_messages for inbound messages after the follow-up
      const { data: replies } = await ops
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', fb.ticket_id)
        .eq('direction', 'inbound')
        .gt('sent_at', fb.follow_up_sent_at)
        .order('sent_at', { ascending: true })
        .limit(1);

      let replyBody: string | null = null;

      if (replies && replies.length > 0) {
        // Found a reply in ticket_messages (Riley already ingested it)
        replyBody = (replies as TicketMessage[])[0].body;
      } else {
        // Check Gmail thread directly in case Riley hasn't picked it up yet
        const { data: ticketData } = await ops
          .from('support_tickets')
          .select('thread_id')
          .eq('id', fb.ticket_id)
          .single();

        if (ticketData?.thread_id) {
          const threadMsgIds = await fetchThreadMessageIds(ticketData.thread_id);
          // Look for messages after our follow-up
          const followUpIdx = threadMsgIds.indexOf(fb.follow_up_message_id || '');
          if (followUpIdx >= 0 && followUpIdx < threadMsgIds.length - 1) {
            // There are messages after our follow-up
            const newerMsgId = threadMsgIds[followUpIdx + 1];
            const msg = await fetchMessageById(newerMsgId);
            if (msg && !msg.from.includes(process.env.GMAIL_DELEGATED_USER || '')) {
              replyBody = msg.body;
            }
          }
        }
      }

      if (!replyBody) continue; // No reply yet

      // Extract feedback using Claude
      const extraction = await extractFeedback(replyBody);

      // Update feedback record. A star-click may already have recorded a
      // rating; a written reply supplements it (comment/sentiment) and only
      // fills the rating if the reply actually contained one.
      const { error: fbUpErr } = await ops
        .from('support_feedback')
        .update({
          rating: extraction.rating ?? fb.rating,
          comment: extraction.comment || null,
          sentiment: extraction.sentiment,
          feedback_received_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', fb.id);
      if (fbUpErr) {
        log.error({ err: fbUpErr, feedbackId: fb.id }, 'Failed to store extracted feedback');
        continue;
      }

      // Store feature requests
      for (const fr of extraction.featureRequests) {
        // Check for existing similar feature request
        const { data: existing } = await ops
          .from('feature_requests')
          .select('id, mention_count')
          .ilike('title', `%${fr.title.slice(0, 30)}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          // Increment mention count on existing request
          await ops
            .from('feature_requests')
            .update({
              mention_count: (existing[0] as { id: string; mention_count: number }).mention_count + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', (existing[0] as { id: string }).id);
        } else {
          await ops.from('feature_requests').insert({
            title: fr.title,
            description: fr.description,
            category: fr.category,
            source_ticket_id: fb.ticket_id,
            source_feedback_id: fb.id,
            customer_email: fb.customer_email,
          });
        }
      }

      processed++;
      log.info(
        { ticketId: fb.ticket_id, rating: extraction.rating, sentiment: extraction.sentiment },
        `Processed feedback: rating=${extraction.rating}, sentiment=${extraction.sentiment}`,
      );
    } catch (err) {
      log.error({ err, feedbackId: fb.id }, 'Failed to process feedback reply');
    }
  }

  return processed;
}

async function extractFeedback(replyBody: string): Promise<FeedbackExtraction> {
  const anthropic = getAnthropicClient();

  const result = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 600,
    system: `You are Quinn, a Feedback Analyst for SoloBusinessAI — an AI-powered client intake and business automation platform for solo professionals and small teams across all industries.

Extract feedback from a customer's reply to our follow-up email. We asked them to rate 1–5 and share any feedback.

Respond with ONLY valid JSON:
{
  "rating": <number 1-5 or null if not provided>,
  "comment": "<any qualitative feedback the customer shared, empty string if none>",
  "sentiment": "positive" | "neutral" | "negative",
  "featureRequests": [
    {
      "title": "<short title>",
      "description": "<what they want>",
      "category": "<billing|technical|onboarding|ux|integrations|general>"
    }
  ]
}

Guidelines:
- If they just say a number, that's the rating with no comment
- If they mention wanting a feature or suggest an improvement, capture it as a feature request
- Sentiment should reflect overall tone, not just the rating number
- featureRequests can be an empty array if no suggestions are made`,
    messages: [
      {
        role: 'user',
        content: `CUSTOMER REPLY:\n${replyBody}`,
      },
    ],
  });

  const text = result.content[0].type === 'text' ? result.content[0].text : '';

  try {
    const cleanJson = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson) as FeedbackExtraction;
  } catch {
    // Try to extract just a rating number from the raw reply
    const ratingMatch = replyBody.match(/\b([1-5])\b/);
    return {
      rating: ratingMatch ? parseInt(ratingMatch[1], 10) : null,
      comment: replyBody.trim(),
      sentiment: 'neutral',
      featureRequests: [],
    };
  }
}

// ── Job 3: Daily Digest ──

async function sendDailyDigest(
  ops: ReturnType<typeof getOpsClient>,
  log: ReturnType<typeof agentLogger>,
): Promise<boolean> {
  const founderEmail = process.env.NOTIFICATION_EMAIL || 'sean@solosolutionsai.com';

  // Check if we already sent a digest today
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: existingDigest } = await ops
    .from('agent_runs')
    .select('id')
    .eq('agent_name', 'quinn')
    .gte('started_at', todayStart.toISOString())
    .like('output_summary', '%daily digest sent%')
    .limit(1);

  if (existingDigest && existingDigest.length > 0) {
    log.info('Daily digest already sent today — skipping');
    return false;
  }

  // Gather feedback from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: recentFeedback } = await ops
    .from('support_feedback')
    .select('*')
    .gte('feedback_received_at', since)
    .order('feedback_received_at', { ascending: false });

  const { data: pendingFollowUps } = await ops
    .from('support_feedback')
    .select('id')
    .is('feedback_received_at', null)
    .not('follow_up_sent_at', 'is', null);

  const { data: recentRequests } = await ops
    .from('feature_requests')
    .select('*')
    .gte('created_at', since)
    .order('mention_count', { ascending: false });

  // Calculate stats
  const feedback = (recentFeedback || []) as FeedbackRow[];
  const ratings = feedback.filter(f => f.rating != null).map(f => f.rating as number);
  const avgRating = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : 'N/A';

  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  for (const f of feedback) {
    if (f.sentiment) sentimentCounts[f.sentiment as keyof typeof sentimentCounts]++;
  }

  const pendingCount = (pendingFollowUps || []).length;
  const featureReqs = (recentRequests || []) as FeatureRequestRow[];

  // Build the digest email
  let digestBody = `Good morning! Here's your daily feedback summary from Quinn.\n\n`;
  digestBody += `═══════════════════════════════════════\n`;
  digestBody += `FEEDBACK SUMMARY — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n`;
  digestBody += `═══════════════════════════════════════\n\n`;

  digestBody += `RATINGS (last 24h)\n`;
  digestBody += `  Responses received: ${feedback.length}\n`;
  digestBody += `  Average rating: ${avgRating}/5\n`;
  if (ratings.length > 0) {
    const dist = [1, 2, 3, 4, 5].map(n => `${n}★: ${ratings.filter(r => r === n).length}`);
    digestBody += `  Distribution: ${dist.join(' | ')}\n`;
  }
  digestBody += `  Awaiting reply: ${pendingCount}\n\n`;

  digestBody += `SENTIMENT\n`;
  digestBody += `  Positive: ${sentimentCounts.positive} | Neutral: ${sentimentCounts.neutral} | Negative: ${sentimentCounts.negative}\n\n`;

  if (feedback.length > 0) {
    digestBody += `RECENT COMMENTS\n`;
    for (const f of feedback.slice(0, 5)) {
      if (f.comment) {
        digestBody += `  [${f.rating || '?'}/5] ${f.comment.slice(0, 150)}${f.comment.length > 150 ? '...' : ''}\n`;
        digestBody += `    — ${f.customer_email}\n\n`;
      }
    }
  }

  if (featureReqs.length > 0) {
    digestBody += `NEW FEATURE REQUESTS\n`;
    for (const fr of featureReqs.slice(0, 5)) {
      digestBody += `  • ${fr.title} (${fr.category}) — ${fr.mention_count} mention(s)\n`;
      digestBody += `    ${fr.description.slice(0, 120)}${fr.description.length > 120 ? '...' : ''}\n\n`;
    }
  }

  if (feedback.length === 0 && featureReqs.length === 0) {
    digestBody += `No feedback received in the last 24 hours.\n\n`;
  }

  digestBody += `— Quinn (Feedback Analyst)`;

  // Send via Gmail
  try {
    await sendReply({
      to: founderEmail,
      subject: `[Quinn] Daily Feedback Summary — ${new Date().toLocaleDateString()}`,
      body: digestBody,
      threadId: '', // New thread each day
      inReplyToMessageId: '',
      fromName: 'SoloBusinessAI Support',
    });

    log.info('Sent daily feedback digest to founder');
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to send daily digest');
    return false;
  }
}

// ── Types ──

interface FeedbackRow {
  id: string;
  ticket_id: string;
  customer_email: string;
  rating_token: string;
  rating: number | null;
  comment: string | null;
  sentiment: string | null;
  follow_up_sent_at: string;
  follow_up_message_id: string | null;
  feedback_received_at: string | null;
  created_at: string;
  updated_at: string;
}

interface FeatureRequestRow {
  id: string;
  title: string;
  description: string;
  category: string;
  source_ticket_id: string | null;
  source_feedback_id: string | null;
  customer_email: string | null;
  mention_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}
