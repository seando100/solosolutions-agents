/**
 * Reset escalated tickets back to 'new' for retesting.
 * Run: npx tsx scripts/reset-tickets.ts
 */
import 'dotenv/config';
import { getOpsClient } from '../packages/shared/src/supabase.js';

const ops = getOpsClient();

const { data, error } = await ops
  .from('support_tickets')
  .update({
    status: 'new',
    assigned_agent: 'jordan',
    escalated_at: null,
    resolution_summary: null,
    updated_at: new Date().toISOString(),
  })
  .eq('status', 'escalated')
  .select('id, subject');

if (error) {
  console.error('Error:', error);
} else {
  console.log(`Reset ${data.length} ticket(s):`);
  for (const t of data) console.log(`  ✓ ${t.subject}`);
}
