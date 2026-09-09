/**
 * Gmail client for Riley (Triage) and Jordan (Tier 1 Responder).
 *
 * Uses OAuth 2.0 refresh token to access Gmail API.
 * Riley reads inbound emails, Jordan sends replies.
 */

import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';

let gmailClient: gmail_v1.Gmail | null = null;

function getGmailClient(): gmail_v1.Gmail {
  if (gmailClient) return gmailClient;

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  gmailClient = google.gmail({ version: 'v1', auth: oauth2 });
  return gmailClient;
}

/** A parsed inbound email */
export interface InboundEmail {
  messageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
}

/**
 * Look up a Gmail label ID by its display name.
 * Returns null if the label doesn't exist.
 */
export async function getLabelId(labelName: string): Promise<string | null> {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';

  const res = await gmail.users.labels.list({ userId: user });
  const label = (res.data.labels || []).find(l => l.name === labelName);
  return label?.id ?? null;
}

/**
 * Fetch new emails since the last history ID.
 * If no historyId provided, fetches the latest unread emails from inbox.
 * Optionally filter by a Gmail label ID (e.g. for Sloan's alias label).
 */
export async function fetchNewEmails(lastHistoryId?: string, labelId?: string): Promise<{
  emails: InboundEmail[];
  newHistoryId: string;
}> {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';

  if (lastHistoryId) {
    // Incremental sync using history API
    try {
      const historyRes = await gmail.users.history.list({
        userId: user,
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded'],
        labelId: labelId ?? 'INBOX',
      });

      const histories = historyRes.data.history || [];
      const messageIds = new Set<string>();

      for (const h of histories) {
        for (const added of h.messagesAdded || []) {
          if (added.message?.id) {
            messageIds.add(added.message.id);
          }
        }
      }

      const emails: InboundEmail[] = [];
      for (const id of messageIds) {
        const email = await fetchEmailById(gmail, user, id);
        if (email) emails.push(email);
      }

      return {
        emails,
        newHistoryId: historyRes.data.historyId || lastHistoryId,
      };
    } catch (err: unknown) {
      // If historyId is too old, fall back to listing recent messages
      const error = err as { code?: number };
      if (error.code === 404) {
        return fetchRecentUnread(labelId);
      }
      throw err;
    }
  }

  // First run — no history ID yet
  return fetchRecentUnread(labelId);
}

/** Fallback: fetch recent unread emails, optionally filtered by label */
async function fetchRecentUnread(labelId?: string): Promise<{
  emails: InboundEmail[];
  newHistoryId: string;
}> {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';

  const labelIds = labelId ? [labelId, 'UNREAD'] : ['INBOX', 'UNREAD'];

  console.log(`[Gmail DEBUG] fetchRecentUnread — user: ${user}, labelIds: ${JSON.stringify(labelIds)}`);

  const listRes = await gmail.users.messages.list({
    userId: user,
    labelIds,
    maxResults: 20,
  });

  console.log(`[Gmail DEBUG] messages.list returned ${listRes.data.messages?.length ?? 0} messages, resultSizeEstimate: ${listRes.data.resultSizeEstimate}`);

  const messages = listRes.data.messages || [];
  const emails: InboundEmail[] = [];

  for (const msg of messages) {
    if (msg.id) {
      const email = await fetchEmailById(gmail, user, msg.id);
      if (email) emails.push(email);
    }
  }

  // Get current history ID for future incremental syncs
  const profile = await gmail.users.getProfile({ userId: user });
  const newHistoryId = profile.data.historyId || '0';

  return { emails, newHistoryId };
}

/** Fetch and parse a single email by ID */
async function fetchEmailById(
  gmail: gmail_v1.Gmail,
  userId: string,
  messageId: string,
): Promise<InboundEmail | null> {
  const res = await gmail.users.messages.get({
    userId,
    id: messageId,
    format: 'full',
  });

  const msg = res.data;
  if (!msg.id || !msg.threadId) return null;

  const headers = msg.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

  // Extract plain text body
  let body = '';
  if (msg.payload?.parts) {
    const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
    } else {
      // Try HTML part as fallback
      const htmlPart = msg.payload.parts.find(p => p.mimeType === 'text/html');
      if (htmlPart?.body?.data) {
        body = Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
  } else if (msg.payload?.body?.data) {
    body = Buffer.from(msg.payload.body.data, 'base64url').toString('utf-8');
  }

  return {
    messageId: msg.id,
    threadId: msg.threadId,
    from: getHeader('From'),
    to: getHeader('To'),
    subject: getHeader('Subject'),
    body: body.slice(0, 5000), // Cap at 5K chars for classification
    receivedAt: getHeader('Date'),
  };
}

/**
 * Send a reply email (used by Jordan).
 * Maintains the thread by setting threadId and In-Reply-To headers.
 */
export async function sendReply(opts: {
  to: string;
  subject: string;
  body: string;
  /** Optional HTML alternative. When present the mail goes out as
   *  multipart/alternative (plain `body` as the fallback part), so clients
   *  that block HTML still get a readable email. */
  html?: string;
  threadId: string;
  inReplyToMessageId: string;
  fromName?: string;
}): Promise<string> {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';
  const fromName = opts.fromName || 'SoloLawyerAI Support';

  const headers = [
    `From: ${fromName} <${user}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `In-Reply-To: ${opts.inReplyToMessageId}`,
    `References: ${opts.inReplyToMessageId}`,
  ];

  let rawEmail: string;
  if (opts.html) {
    const boundary = `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    rawEmail = [
      ...headers,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      opts.body,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      opts.html,
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    rawEmail = [
      ...headers,
      'Content-Type: text/plain; charset=utf-8',
      '',
      opts.body,
    ].join('\r\n');
  }

  const encodedMessage = Buffer.from(rawEmail).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: user,
    requestBody: {
      raw: encodedMessage,
      threadId: opts.threadId,
    },
  });

  return res.data.id || '';
}

/**
 * Send a brand-new email (starts a new thread).
 * Used to give in-portal tickets (which have no Gmail thread) a real email
 * thread with the customer, so the rest of the support machinery can reuse it.
 * Returns both the message ID and the new thread ID.
 */
export async function sendNewEmail(opts: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';
  const fromName = opts.fromName || 'SoloBusinessAI Support';

  const rawEmail = [
    `From: ${fromName} <${user}>`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    opts.body,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawEmail).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: user,
    requestBody: { raw: encodedMessage },
  });

  return { messageId: res.data.id || '', threadId: res.data.threadId || '' };
}

/**
 * Fetch all message IDs in a Gmail thread.
 * Used by Avery to check escalation threads for founder replies.
 */
export async function fetchThreadMessageIds(threadId: string | null | undefined): Promise<string[]> {
  // In-portal tickets have no Gmail thread (thread_id is null). Older tickets may
  // reference a thread that has since been deleted (404). Neither is fatal — the
  // caller should just treat the thread as having no messages to scan.
  if (!threadId) return [];

  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';

  try {
    const res = await gmail.users.threads.get({
      userId: user,
      id: threadId,
      format: 'minimal',
    });
    return (res.data.messages || []).map(m => m.id).filter(Boolean) as string[];
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 404 || code === 400) return []; // deleted/zombie or invalid thread — not fatal
    throw err;
  }
}

/**
 * Fetch and parse a single email by its message ID.
 * Public wrapper around the internal fetchEmailById.
 */
export async function fetchMessageById(messageId: string): Promise<InboundEmail | null> {
  if (!messageId) return null;
  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';
  try {
    return await fetchEmailById(gmail, user, messageId);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 404) return null; // message deleted — not fatal
    throw err;
  }
}

/**
 * Mark a message as read (remove UNREAD label).
 */
export async function markAsRead(messageId: string): Promise<void> {
  const gmail = getGmailClient();
  const user = process.env.GMAIL_DELEGATED_USER || 'me';

  await gmail.users.messages.modify({
    userId: user,
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
}
