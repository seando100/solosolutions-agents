/**
 * Check current ticket state + messages.
 * Run: npx tsx scripts/check-tickets.ts
 */
import 'dotenv/config';
import { getOpsClient } from '../packages/shared/src/supabase.js';

const ops = getOpsClient();

const { data: tickets } = await ops
  .from('support_tickets')
  .select('id, subject, source_email, status, assigned_agent, category, priority')
  .order('created_at', { ascending: true });

for (const t of tickets || []) {
  console.log(`\n--- Ticket: ${t.subject} ---`);
  console.log(`  From: ${t.source_email}`);
  console.log(`  Status: ${t.status} | Assigned: ${t.assigned_agent} | ${t.priority}/${t.category}`);

  const { data: msgs } = await ops
    .from('ticket_messages')
    .select('direction, from_email, to_email, body')
    .eq('ticket_id', t.id)
    .order('created_at', { ascending: true });

  for (const m of msgs || []) {
    console.log(`  [${m.direction}] ${m.from_email} → ${m.to_email}`);
    console.log(`    ${m.body.slice(0, 200)}...`);
  }
}
