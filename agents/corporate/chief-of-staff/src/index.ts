import {
  agentLogger,
  getAnthropicClient,
  DEFAULT_MODEL,
  getOpsClient,
  fetchNewEmails,
  getLabelId,
  sendReply,
  markAsRead,
} from '@solo/shared';
import type { AgentRunResult, InboundEmail } from '@solo/shared';

/**
 * ═══════════════════════════════════════════
 * SLOAN — Chief of Staff
 * ═══════════════════════════════════════════
 *
 * "I'm the founder's right hand. I read what comes in,
 *  figure out what matters, and make sure nothing falls
 *  through the cracks — starting with the advisory board."
 *
 * Team: Corporate (Tier 1)
 * Trigger: Every 15 minutes (cron)
 * Inbox: sloan@solosolutionsai.com
 *   → Advisory board + ops alerts routed here via Gmail filter
 *
 * Three-tier response model:
 *
 *   Tier 1 — Immediate auto-send (no approval needed):
 *     - Acknowledgement reply TO the advisor: "Thanks for this — Sean is
 *       reviewing and will follow up shortly."
 *
 *   Tier 2 — Flag for Sean's review (within the hour, not 24h):
 *     - For advisory_feedback: send Sean the full draft immediately
 *       so he can review + send without waiting for the morning digest
 *
 *   Tier 3 — Wake-up alert (critical ops):
 *     - High-urgency ops_alert (Sentry outage, Stripe failure, etc.)
 *       gets an immediate 🔴 alert to Sean regardless of time
 *
 *   Daily digest (7 AM ET):
 *     - Full day summary: all advisory items, all ops, all general
 *     - Advisory drafts included again for easy copy-paste reference
 * ═══════════════════════════════════════════
 */

const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL || 'sean@solosolutionsai.com';
// Sloan has a dedicated OAuth token for sean@solosolutionsai.com (separate from Quinn's).
// Override before any Gmail calls — safe because each agent runs in its own process.
if (process.env.SLOAN_GMAIL_REFRESH_TOKEN) {
  process.env.GMAIL_REFRESH_TOKEN = process.env.SLOAN_GMAIL_REFRESH_TOKEN;
}
if (process.env.SLOAN_GMAIL_DELEGATED_USER) {
  process.env.GMAIL_DELEGATED_USER = process.env.SLOAN_GMAIL_DELEGATED_USER;
}
const SLOAN_LABEL_NAME = 'sloan@solosolutionsai.com';
const DIGEST_HOUR_UTC = 12; // 7 AM ET (UTC-5); handles both EST and EDT window

// ── Types ──

type EmailCategory = 'advisory_feedback' | 'ops_alert' | 'general';
type Urgency = 'high' | 'normal' | 'low';

interface ClassifiedEmail {
  email: InboundEmail;
  category: EmailCategory;
  sender_name: string;
  summary: string;
  key_points: string[];
  urgency: Urgency;
  action_needed: boolean;
  ops_source?: string; // e.g. 'Stripe', 'Sentry', 'BetterStack'
}

interface AdvisoryDraft {
  classified: ClassifiedEmail;
  draft_response: string;
}

// ── Entry Point ──

export async function run(runId: string): Promise<AgentRunResult> {
  const log = agentLogger('sloane', runId);
  const ops = getOpsClient();

  log.info('Starting Sloan chief-of-staff cycle...');

  // Resolve the Gmail label ID for 'Sloan' — applied by Gmail filter to emails sent to sloan@solosolutionsai.com
  const sloanLabelId = await getLabelId(SLOAN_LABEL_NAME) ?? undefined;
  if (!sloanLabelId) {
    log.warn(`Could not find Gmail label '${SLOAN_LABEL_NAME}' — falling back to full inbox scan`);
  }

  // Fetch new emails since last sync, filtered to Sloan's label
  const gmailUser = process.env.GMAIL_DELEGATED_USER || 'sean@sololawyerai.com';
  const { data: syncState } = await ops
    .from('gmail_sync_state')
    .select('last_history_id')
    .eq('email_address', gmailUser)
    .maybeSingle();

  const { emails, newHistoryId } = await fetchNewEmails(syncState?.last_history_id ?? undefined, sloanLabelId);

  // Persist updated history ID
  await ops.from('gmail_sync_state').upsert(
    {
      email_address: gmailUser,
      vertical: null,
      last_history_id: newHistoryId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'email_address' },
  );

  // Filter out emails FROM the founder (avoid digest reply loops)
  const inbound = emails.filter(e => !e.from.includes(FOUNDER_EMAIL) && !e.from.includes('sololawyerai.com'));

  if (inbound.length === 0) {
    log.info('No new inbound emails to process');
  } else {
    log.info({ count: inbound.length }, `Processing ${inbound.length} new email(s)`);
  }

  // Job 1 + 2 + immediate dispatch
  const classified: ClassifiedEmail[] = [];
  const advisoryDrafts: AdvisoryDraft[] = [];
  let acksAutoSent = 0;
  let draftsReviewSent = 0;
  let urgentAlertsSent = 0;

  for (const email of inbound) {
    try {
      const result = await classifyEmail(email);
      classified.push(result);
      await markAsRead(email.messageId);

      log.info(
        { from: email.from, category: result.category, urgency: result.urgency },
        `Classified: ${result.category} (${result.urgency})`,
      );

      if (result.category === 'advisory_feedback') {
        // Tier 1: Auto-acknowledge to the advisor immediately (no approval needed)
        await sendAutoAcknowledgement(result, log);
        acksAutoSent++;

        // Tier 2: Draft substantive reply and send to Sean for review now
        const draft = await draftAdvisoryResponse(result);
        advisoryDrafts.push({ classified: result, draft_response: draft });
        await sendDraftForReview(result, draft, log);
        draftsReviewSent++;
      } else if (result.category === 'ops_alert' && result.urgency === 'high') {
        // Tier 3: Critical ops — wake Sean immediately
        await sendUrgentAlert([result], [], log);
        urgentAlertsSent++;
      }
    } catch (err) {
      log.error({ err, messageId: email.messageId }, 'Failed to process email');
    }
  }

  // Daily digest at 7 AM ET — full day summary for Sean's morning review
  const currentHourUtc = new Date().getUTCHours();
  const isDigestTime = currentHourUtc === DIGEST_HOUR_UTC || currentHourUtc === DIGEST_HOUR_UTC + 1;

  if (isDigestTime) {
    const sent = await sendDailyDigest(classified, advisoryDrafts, ops, log);
    if (sent) log.info('Daily digest sent to founder');
  }

  const summary = [
    `${inbound.length} email(s) processed`,
    acksAutoSent > 0 ? `${acksAutoSent} ack(s) sent` : null,
    draftsReviewSent > 0 ? `${draftsReviewSent} draft(s) flagged for review` : null,
    urgentAlertsSent > 0 ? `${urgentAlertsSent} urgent alert(s) sent` : null,
    isDigestTime ? 'digest sent' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return { summary: summary || 'No new emails' };
}

// ── Job 1: Classify Email ──

interface ClassificationResult {
  category: EmailCategory;
  sender_name: string;
  summary: string;
  key_points: string[];
  urgency: Urgency;
  action_needed: boolean;
  ops_source?: string;
}

async function classifyEmail(email: InboundEmail): Promise<ClassifiedEmail> {
  const anthropic = getAnthropicClient();

  const result = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 500,
    system: `You are Sloan, Chief of Staff at SoloSolutionsAI. The founder (Sean Doherty) receives emails at sloan@solosolutionsai.com that you monitor on his behalf.

Classify and summarise the email. Respond with ONLY valid JSON:
{
  "category": "advisory_feedback" | "ops_alert" | "general",
  "sender_name": "<first name or role, e.g. 'Susan', 'Leigh', 'Claire', 'Stripe', 'Sentry'>",
  "summary": "<1-2 sentence summary of what this email is about>",
  "key_points": ["<point 1>", "<point 2>", ...],
  "urgency": "high" | "normal" | "low",
  "action_needed": true | false,
  "ops_source": "<'Stripe' | 'Sentry' | 'BetterStack' | 'Vercel' | 'Supabase' | null — only for ops_alert category>"
}

Classification rules:
- advisory_feedback: emails from advisory board members (Susan, Leigh, Claire, or other human advisors)
- ops_alert: automated notifications from Stripe, Sentry, BetterStack, Vercel, Supabase, or similar services
- general: everything else

Urgency rules:
- high: payment failures, service outages, advisor asks for urgent response, security alerts
- normal: routine feedback, standard notifications, questions that can wait for digest
- low: informational only, no action required`,
    messages: [
      {
        role: 'user',
        content: `FROM: ${email.from}\nSUBJECT: ${email.subject}\n\n${email.body}`,
      },
    ],
  });

  const text = result.content[0].type === 'text' ? result.content[0].text : '{}';

  try {
    const clean = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean) as ClassificationResult;
    return { email, ...parsed };
  } catch {
    // Fallback — treat as general, normal urgency
    return {
      email,
      category: 'general',
      sender_name: email.from.split('<')[0].trim() || email.from,
      summary: email.subject || '(no subject)',
      key_points: [],
      urgency: 'normal',
      action_needed: false,
    };
  }
}

// ── Job 2: Draft Advisory Response ──

async function draftAdvisoryResponse(classified: ClassifiedEmail): Promise<string> {
  const anthropic = getAnthropicClient();

  const result = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 600,
    system: `You are Sloan, Chief of Staff at SoloSolutionsAI. You draft email responses on behalf of the founder, Sean Doherty.

Sean is the founder of SoloSolutionsAI — a multi-vertical AI SaaS platform for solo practitioners (attorneys, vets, realtors, therapists, accountants, and more). He's a 30-year digital/AI veteran building this solo with an AI agent workforce.

Your draft should:
- Sound like Sean — warm, direct, professional, appreciative of the advisor's time and expertise
- Acknowledge the specific points they raised
- Keep product scope focused on intake and client acquisition (not full org management)
- Be concise — 3-5 short paragraphs maximum
- End with a clear next step or question if action is needed
- Do NOT mention Sloan or that this was drafted by AI — Sean will review and send as himself

Write only the email body (no subject line, no "Dear X", no signature).`,
    messages: [
      {
        role: 'user',
        content: `Draft a reply to this email from ${classified.sender_name}.\n\nKEY POINTS TO ADDRESS:\n${classified.key_points.map(p => `- ${p}`).join('\n')}\n\nORIGINAL EMAIL:\n${classified.email.body}`,
      },
    ],
  });

  return result.content[0].type === 'text' ? result.content[0].text : '';
}

// ── Tier 1: Auto-Acknowledgement to Advisor ──

/**
 * Sends an immediate, brief acknowledgement TO the advisor (in-thread reply).
 * No approval needed — this is a generic "received, Sean is on it" note.
 * Sounds like it's from Sean's office, not explicitly from an AI.
 */
async function sendAutoAcknowledgement(
  classified: ClassifiedEmail,
  log: ReturnType<typeof agentLogger>,
): Promise<void> {
  const senderEmail = classified.email.from.match(/<(.+)>/)?.[1] ?? classified.email.from;

  const body = `Hi ${classified.sender_name},

Thanks so much for this - really appreciate you taking the time to share your thoughts. Sean has received your message and will follow up with you shortly.

Best,
Sloan
Chief of Staff, SoloSolutionsAI`;

  try {
    await sendReply({
      to: senderEmail,
      subject: classified.email.subject?.startsWith('Re:')
        ? classified.email.subject
        : `Re: ${classified.email.subject || ''}`,
      body,
      threadId: classified.email.threadId,
      inReplyToMessageId: classified.email.messageId,
      fromName: 'Sloan - SoloSolutionsAI',
    });
    log.info({ to: senderEmail }, `Auto-acknowledgement sent to ${classified.sender_name}`);
  } catch (err) {
    log.error({ err }, `Failed to send auto-acknowledgement to ${classified.sender_name}`);
  }
}

// ── Tier 2: Draft for Sean's Review (immediate, not waiting for digest) ──

/**
 * Sends Sean the draft reply immediately so he can review + send within the hour.
 * Does not wait for the 7 AM digest. Subject flags it as ready for his action.
 */
async function sendDraftForReview(
  classified: ClassifiedEmail,
  draft: string,
  log: ReturnType<typeof agentLogger>,
): Promise<void> {
  const urgencyFlag = classified.urgency === 'high' ? '[URGENT] ' : '';

  const body = `Sean - ${classified.sender_name} sent a message and I've already acknowledged receipt. Here's my draft reply for your review:

FROM: ${classified.email.from}
SUBJECT: ${classified.email.subject || '(no subject)'}

SUMMARY:
${classified.summary}
${classified.key_points.length > 0 ? `\nKEY POINTS:\n${classified.key_points.map(p => `  - ${p}`).join('\n')}` : ''}

DRAFT RESPONSE (review + send as yourself):
----------------------------------------
${draft}
----------------------------------------

Note: I've already sent a brief acknowledgement to ${classified.sender_name} letting them know you're reviewing.

- Sloan
  Chief of Staff, SoloSolutionsAI`;

  try {
    await sendReply({
      to: FOUNDER_EMAIL,
      subject: `[Sloan] ${urgencyFlag}Draft ready for review - ${classified.sender_name}`,
      body,
      threadId: '',
      inReplyToMessageId: '',
      fromName: 'Sloan - SoloSolutionsAI',
    });
    log.info(`Draft for ${classified.sender_name} sent to founder for review`);
  } catch (err) {
    log.error({ err }, `Failed to send draft-for-review to founder`);
  }
}

// ── Job 3: Daily Digest ──

async function sendDailyDigest(
  classified: ClassifiedEmail[],
  advisoryDrafts: AdvisoryDraft[],
  ops: ReturnType<typeof getOpsClient>,
  log: ReturnType<typeof agentLogger>,
): Promise<boolean> {
  // Avoid sending duplicate digests on the same day
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: alreadySent } = await ops
    .from('agent_runs')
    .select('id')
    .in('agent_name', ['sloan', 'sloane'])
    .gte('started_at', todayStart.toISOString())
    .like('output_summary', '%digest sent%')
    .limit(1);

  if (alreadySent && alreadySent.length > 0) {
    log.info('Daily digest already sent today — skipping');
    return false;
  }

  const advisory = classified.filter(c => c.category === 'advisory_feedback');
  const opsAlerts = classified.filter(c => c.category === 'ops_alert');
  const general = classified.filter(c => c.category === 'general');
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  let body = `Good morning, Sean. Here's your daily briefing from Sloan.\n\n`;
  body += `==========================================\n`;
  body += `SLOAN'S DAILY BRIEFING - ${dateStr}\n`;
  body += `==========================================\n\n`;

  // Advisory Board Section
  if (advisory.length > 0) {
    body += `ADVISORY BOARD (${advisory.length} email${advisory.length > 1 ? 's' : ''})\n`;
    body += `------------------------------------------\n\n`;

    for (const item of advisory) {
      const draft = advisoryDrafts.find(d => d.classified.email.messageId === item.email.messageId);

      body += `FROM: ${item.sender_name}\n`;
      body += `SUBJECT: ${item.email.subject || '(no subject)'}\n`;
      body += `URGENCY: ${item.urgency.toUpperCase()}\n\n`;

      body += `SUMMARY:\n${item.summary}\n\n`;

      if (item.key_points.length > 0) {
        body += `KEY POINTS:\n`;
        for (const point of item.key_points) {
          body += `  - ${point}\n`;
        }
        body += `\n`;
      }

      if (draft) {
        body += `DRAFT RESPONSE (review + send as yourself):\n`;
        body += `----------------------------------------\n`;
        body += `${draft.draft_response}\n`;
        body += `----------------------------------------\n`;
      }

      body += `\n`;
    }
  } else {
    body += `ADVISORY BOARD\n`;
    body += `------------------------------------------\n`;
    body += `No new messages from the advisory board today.\n\n`;
  }

  // Ops Alerts Section
  const highOps = opsAlerts.filter(o => o.urgency === 'high');
  const otherOps = opsAlerts.filter(o => o.urgency !== 'high');

  if (opsAlerts.length > 0) {
    body += `OPS ALERTS (${opsAlerts.length})\n`;
    body += `------------------------------------------\n\n`;

    if (highOps.length > 0) {
      body += `[HIGH PRIORITY]\n`;
      for (const alert of highOps) {
        body += `  [${alert.ops_source || 'Alert'}] ${alert.summary}\n`;
        if (alert.action_needed) body += `  >> ACTION NEEDED\n`;
      }
      body += `\n`;
    }

    if (otherOps.length > 0) {
      body += `[INFORMATIONAL]\n`;
      for (const alert of otherOps) {
        body += `  [${alert.ops_source || 'Alert'}] ${alert.summary}\n`;
      }
      body += `\n`;
    }
  } else {
    body += `OPS ALERTS\n`;
    body += `------------------------------------------\n`;
    body += `No ops alerts today. All systems normal.\n\n`;
  }

  // General Section
  if (general.length > 0) {
    body += `OTHER INBOUND (${general.length})\n`;
    body += `------------------------------------------\n`;
    for (const item of general) {
      body += `  [${item.urgency}] ${item.sender_name}: ${item.summary}\n`;
    }
    body += `\n`;
  }

  body += `==========================================\n`;
  body += `Remember: draft responses above are ready to copy and send as yourself.\n`;
  body += `Reply to this email with any instructions for me.\n\n`;
  body += `- Sloan\n`;
  body += `  Chief of Staff, SoloSolutionsAI`;

  try {
    await sendReply({
      to: FOUNDER_EMAIL,
      subject: `[Sloan] Daily Briefing - ${dateStr}`,
      body,
      threadId: '',
      inReplyToMessageId: '',
      fromName: 'Sloan - SoloSolutionsAI',
    });
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to send daily digest');
    return false;
  }
}

// ── Urgent Escalation ──

async function sendUrgentAlert(
  urgent: ClassifiedEmail[],
  drafts: AdvisoryDraft[],
  log: ReturnType<typeof agentLogger>,
): Promise<void> {
  let body = `Sean - urgent items need your attention.\n\n`;

  for (const item of urgent) {
    body += `[URGENT] ${item.category === 'ops_alert' ? `[${item.ops_source || 'Alert'}]` : `[${item.sender_name}]`}\n`;
    body += `${item.summary}\n`;

    if (item.action_needed) body += `>> ACTION NEEDED\n`;

    const draft = drafts.find(d => d.classified.email.messageId === item.email.messageId);
    if (draft) {
      body += `\nDRAFT RESPONSE:\n`;
      body += `----------------------------------------\n`;
      body += `${draft.draft_response}\n`;
      body += `----------------------------------------\n`;
    }

    body += `\n`;
  }

  body += `- Sloan`;

  try {
    await sendReply({
      to: FOUNDER_EMAIL,
      subject: `[Sloan] URGENT - ${urgent.length} item${urgent.length > 1 ? 's' : ''} need attention`,
      body,
      threadId: '',
      inReplyToMessageId: '',
      fromName: 'Sloan - SoloSolutionsAI',
    });
    log.info({ count: urgent.length }, 'Sent urgent alert to founder');
  } catch (err) {
    log.error({ err }, 'Failed to send urgent alert');
  }
}
