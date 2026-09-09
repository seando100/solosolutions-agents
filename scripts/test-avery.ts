/**
 * Quick test: Run Avery once to check for escalated tickets and notify founder.
 *
 * Run: npx tsx scripts/test-avery.ts
 */

import 'dotenv/config';
import { run } from '../agents/support/escalation/src/index.js';

console.log('\n========================================');
console.log('Testing Avery (Escalation Coordinator)');
console.log('========================================\n');

try {
  const result = await run('test-run-avery');
  console.log('\n========================================');
  console.log('Result:', result.summary);
  console.log('========================================\n');
} catch (err) {
  console.error('\nAvery failed:', err);
}
