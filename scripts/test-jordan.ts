/**
 * Quick test: Run Jordan once to see if she can handle tickets.
 *
 * Run: npx tsx scripts/test-jordan.ts
 */

import 'dotenv/config';
import { run } from '../agents/support/tier1-responder/src/index.js';

console.log('\n========================================');
console.log('Testing Jordan (Tier 1 Support Rep)');
console.log('========================================\n');

try {
  const result = await run('test-run-002');
  console.log('\n========================================');
  console.log('Result:', result.summary);
  console.log('========================================\n');
} catch (err) {
  console.error('\nJordan failed:', err);
}
