import { logger, getOpsClient, sendReply, TEAM_ROSTER } from '@solo/shared';
import type { AgentRun, SupportTicket } from '@solo/shared';

/**
 * ═══════════════════════════════════════════
 * MORNING DIGEST
 * ═══════════════════════════════════════════
 *
 * Daily email to the founder summarizing what all agents
 * did overnight. Sent at 7 AM ET.
 *
 * Covers:
 *   - Agent run counts and statuses
 *   - Tickets created, resolved, escalated
 *   - Feedback received (from Quinn)
 *   - Feature requests logged
 *   - Any errors that need attention
 * ═══════════════════════════════════════════
 */
export async function buildMorningDigest(): Promise<void> {
  const ops = getOpsClient();
  const founderEmail = process.env.NOTIFICATION_EMAIL || 'sean@solosolutionsai.com';

  logger.info('Building morning digest...');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Gather data in parallel
  const [runsResult, ticketsResult, feedbackResult, featureResult, errorsResult] = await Promise.all([
    // All agent runs in the last 24h
    ops.from('agent_runs')
      .select('*')
      .gte('started_at', since)
      .order('started_at', { ascending: false }),

    // Tickets created/updated in the last 24h
    ops.from('support_tickets')
      .select('*')
      .gte('updated_at', since)
      .order('updated_at', { ascending: false }),

    // Feedback received in the last 24h
    ops.from('feedback')
      .select('*')
      .gte('feedback_received_at', since),

    // Feature requests from last 24h
    ops.from('feature_requests')
      .select('*')
      .gte('created_at', since),

    // Failed runs in the last 24h
    ops.from('agent_runs')
      .select('*')
      .eq('status', 'error')
      .gte('started_at', since),
  ]);

  const runs = (runsResult.data || []) as AgentRun[];
  const tickets = (ticketsResult.data || []) as SupportTicket[];
  const feedback = (feedbackResult.data || []) as Array<{ rating: number | null; sentiment: string | null; comment: string | null; customer_email: string }>;
  const featureReqs = (featureResult.data || []) as Array<{ title: string; category: string; mention_count: number }>;
  const errors = (errorsResult.data || []) as AgentRun[];

  // Compute agent run stats
  const agentStats = new Map<string, { runs: number; successes: number; errors: number }>();
  for (const run of runs) {
    const stats = agentStats.get(run.agent_name) || { runs: 0, successes: 0, errors: 0 };
    stats.runs++;
    if (run.status === 'success') stats.successes++;
    if (run.status === 'error') stats.errors++;
    agentStats.set(run.agent_name, stats);
  }

  // Ticket stats
  const newTickets = tickets.filter(t => new Date(t.created_at) >= new Date(since));
  const resolvedTickets = tickets.filter(t => t.status === 'resolved' && t.resolved_at && new Date(t.resolved_at) >= new Date(since));
  const escalatedTickets = tickets.filter(t => t.status === 'escalated' && t.escalated_at && new Date(t.escalated_at) >= new Date(since));
  const awaitingResponse = tickets.filter(t => t.status === 'awaiting_response');

  // Feedback stats
  const ratings = feedback.filter(f => f.rating != null).map(f => f.rating as number);
  const avgRating = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : 'N/A';

  // Build the digest
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  let body = `Good morning! Here's your daily operations summary.\n\n`;
  body += `═══════════════════════════════════════\n`;
  body += `MORNING DIGEST — ${today}\n`;
  body += `═══════════════════════════════════════\n\n`;

  // Agent Activity
  body += `AGENT ACTIVITY (last 24h)\n`;
  body += `  Total runs: ${runs.length}\n`;

  const activeAgents = Array.from(agentStats.entries())
    .sort((a, b) => b[1].runs - a[1].runs);

  for (const [name, stats] of activeAgents) {
    const profile = TEAM_ROSTER.find(a => a.name === name);
    const displayName = profile ? `${profile.display_name} (${profile.title})` : name;
    const errorNote = stats.errors > 0 ? ` [${stats.errors} error(s)]` : '';
    body += `  ${displayName}: ${stats.runs} runs, ${stats.successes} success${errorNote}\n`;
  }
  body += `\n`;

  // Ticket Summary
  body += `TICKET SUMMARY\n`;
  body += `  New tickets: ${newTickets.length}\n`;
  body += `  Resolved: ${resolvedTickets.length}\n`;
  body += `  Escalated: ${escalatedTickets.length}\n`;
  body += `  Awaiting customer response: ${awaitingResponse.length}\n`;

  if (resolvedTickets.length > 0) {
    body += `\n  Recent resolutions:\n`;
    for (const t of resolvedTickets.slice(0, 5)) {
      body += `    • "${t.subject}" — ${t.resolution_summary?.slice(0, 80) || 'no summary'}\n`;
    }
  }
  body += `\n`;

  // Feedback
  if (feedback.length > 0 || ratings.length > 0) {
    body += `CUSTOMER FEEDBACK\n`;
    body += `  Responses: ${feedback.length}\n`;
    body += `  Average rating: ${avgRating}/5\n`;
    if (ratings.length > 0) {
      const dist = [1, 2, 3, 4, 5].map(n => `${n}★: ${ratings.filter(r => r === n).length}`);
      body += `  Distribution: ${dist.join(' | ')}\n`;
    }
    body += `\n`;
  }

  // Feature Requests
  if (featureReqs.length > 0) {
    body += `NEW FEATURE REQUESTS\n`;
    for (const fr of featureReqs.slice(0, 5)) {
      body += `  • ${fr.title} (${fr.category}) — ${fr.mention_count} mention(s)\n`;
    }
    body += `\n`;
  }

  // Errors / Attention Needed
  if (errors.length > 0) {
    body += `⚠ ERRORS NEEDING ATTENTION\n`;
    for (const err of errors.slice(0, 5)) {
      const profile = TEAM_ROSTER.find(a => a.name === err.agent_name);
      body += `  ${profile?.display_name || err.agent_name}: ${err.error_message?.slice(0, 100) || 'unknown error'}\n`;
      body += `    at ${new Date(err.started_at).toLocaleTimeString()}\n`;
    }
    body += `\n`;
  }

  if (runs.length === 0 && newTickets.length === 0) {
    body += `All quiet — no agent activity or tickets in the last 24 hours.\n\n`;
  }

  body += `— SoloSolutionsAI Operations`;

  // Send the digest
  try {
    await sendReply({
      to: founderEmail,
      subject: `[Daily Digest] SoloSolutionsAI — ${new Date().toLocaleDateString()}`,
      body,
      threadId: '', // New thread each day
      inReplyToMessageId: '',
      fromName: 'SoloSolutionsAI Operations',
    });

    logger.info('Morning digest sent successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to send morning digest');
  }
}
