/**
 * One-time setup: Create the solosolutions_ops database tables.
 *
 * Run: npx tsx scripts/setup-ops-db.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_OPS_URL!;
const key = process.env.SUPABASE_OPS_SERVICE_KEY!;
const supabase = createClient(url, key);

const sql = `
-- ==========================================
-- SoloSolutionsAI Ops Database Schema
-- Riley, Jordan, and the whole team use these tables
-- ==========================================

-- Support tickets (created by Riley, worked by Jordan/Casey/Avery)
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical TEXT NOT NULL DEFAULT 'sololawyer',
  source_email TEXT NOT NULL,
  source_message_id TEXT,
  thread_id TEXT,
  subject TEXT,
  body_preview TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low')),
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('billing', 'technical', 'onboarding', 'feature_request', 'general')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'awaiting_response', 'resolved', 'escalated')),
  assigned_agent TEXT,
  customer_id TEXT,
  resolution_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ
);

-- Individual messages within a ticket thread
CREATE TABLE IF NOT EXISTS ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  gmail_message_id TEXT,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  sent_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent run log (every agent execution is tracked here)
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  agent_name TEXT NOT NULL,
  vertical TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron', 'direct_invoke', 'webhook')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  input_summary TEXT,
  output_summary TEXT,
  error_message TEXT,
  tokens_used INTEGER,
  cost_usd NUMERIC(10,6),
  metadata JSONB
);

-- Gmail sync state (tracks where Riley left off reading)
CREATE TABLE IF NOT EXISTS gmail_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address TEXT NOT NULL UNIQUE,
  vertical TEXT NOT NULL,
  last_history_id TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Knowledge base (Jordan uses this to answer questions)
CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical TEXT NOT NULL DEFAULT 'global',
  category TEXT NOT NULL CHECK (category IN ('faq', 'help_doc', 'resolved_ticket')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  source TEXT NOT NULL CHECK (source IN ('manual', 'resolved_ticket', 'help_center')),
  source_ticket_id UUID REFERENCES support_tickets(id),
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_thread ON support_tickets(thread_id);
CREATE INDEX IF NOT EXISTS idx_tickets_vertical ON support_tickets(vertical);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_kb_vertical_category ON knowledge_base(vertical, category);
`;

async function main() {
  console.log('Setting up solosolutions_ops database...\n');

  // Execute via Supabase's rpc or direct SQL
  // We'll use the REST API to run raw SQL
  const res = await fetch(`${url}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });

  // Supabase doesn't have a direct raw SQL endpoint via REST.
  // We need to use the SQL editor approach — let's use the management API instead.
  // For now, let's just output the SQL so you can paste it into the SQL editor.

  console.log('Copy the SQL below and paste it into Supabase SQL Editor:');
  console.log('(Dashboard → SQL Editor → New Query → Paste → Run)\n');
  console.log('========================================');
  console.log(sql);
  console.log('========================================');
  console.log('\nAfter running, come back here and confirm.');
}

main().catch(console.error);
