/**
 * Quick test: Run Riley once to see if she can read Gmail and talk to Supabase.
 *
 * Run: npx tsx scripts/test-riley.ts
 */

import 'dotenv/config';
import { run } from '../agents/support/triage/src/index.js';

console.log('\n========================================');
console.log('Testing Riley (Support Triage Specialist)');
console.log('========================================\n');

try {
  const result = await run('test-run-001');
  console.log('\n========================================');
  console.log('Result:', result.summary);
  console.log('========================================\n');
} catch (err) {
  console.error('\nRiley failed:', err);
}
