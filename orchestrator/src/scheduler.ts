import cron from 'node-cron';
import { logger } from '@solo/shared';
import { runAgent } from './runner.js';
import { buildMorningDigest } from './digest.js';

/**
 * The scheduler is the heartbeat of the agent workforce.
 * It fires cron jobs that trigger each agent's run() function.
 *
 * Currently active:
 *   - Riley (Triage): every 2 minutes — checks Gmail for new support emails
 *   - Avery (Escalation): every 10 minutes — notifies founder about escalated tickets
 *   - Sloan (Chief of Staff): every 15 minutes — advisory board + founder inbox
 *   - Quinn (Feedback Collector): hourly — follow-ups, feedback collection, daily digest
 *   - Morning Digest: daily at 7 AM ET — full operations summary
 *
 * Future additions (uncomment as agents come online):
 *   - Morgan (Onboarding Coach): daily at 9 AM ET
 *   - Sage (Churn Prevention): daily at 10 AM ET
 */
export function startScheduler() {
  logger.info('Scheduler starting — registering cron jobs');

  // ── Riley (Triage) — every 2 minutes ──
  cron.schedule('*/2 * * * *', () => {
    runAgent('riley', 'cron');
  });
  logger.info('  ✓ Riley (Triage) — every 2 minutes');

  // ── Casey (Bug Detective) — every 5 minutes ──
  cron.schedule('*/5 * * * *', () => {
    runAgent('casey', 'cron');
  });
  logger.info('  ✓ Casey (Bug Detective) — every 5 minutes');

  // ── Avery (Escalation) — every 10 minutes ──
  cron.schedule('*/10 * * * *', () => {
    runAgent('avery', 'cron');
  });
  logger.info('  ✓ Avery (Escalation) — every 10 minutes');

  // ── Quinn (Feedback Collector) — hourly ──
  cron.schedule('0 * * * *', () => {
    runAgent('quinn', 'cron');
  });
  logger.info('  ✓ Quinn (Feedback Collector) — hourly');

  // ── Sloan (Chief of Staff) — every 15 minutes ──
  cron.schedule('*/15 * * * *', () => {
    runAgent('sloan', 'cron');
  });
  logger.info('  ✓ Sloan (Chief of Staff) — every 15 minutes');

  // ── Morning Digest — 7 AM ET (12:00 UTC / 11:00 UTC during DST) ──
  cron.schedule('0 11,12 * * *', () => {
    buildMorningDigest();
  });
  logger.info('  ✓ Morning Digest — 7 AM ET daily');

  // ── Morgan (Onboarding Coach) — daily at 9 AM ET (13:00/14:00 UTC) ──
  cron.schedule('0 13,14 * * *', () => {
    runAgent('morgan', 'cron');
  });
  logger.info('  ✓ Morgan (Onboarding Coach) — 9 AM ET daily');

  // ── Sage (Retention Specialist) — daily at 10 AM ET (14:00/15:00 UTC) ──
  cron.schedule('0 14,15 * * *', () => {
    runAgent('sage', 'cron');
  });
  logger.info('  ✓ Sage (Retention Specialist) — 10 AM ET daily');

  logger.info('Scheduler running. Waiting for triggers...');
}
