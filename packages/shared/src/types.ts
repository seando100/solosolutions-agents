// ==========================================
// SoloSolutionsAI — Shared Types
// ==========================================

/** Support ticket priority levels */
export type TicketPriority = 'urgent' | 'normal' | 'low';

/** Support ticket categories */
export type TicketCategory = 'billing' | 'technical' | 'onboarding' | 'feature_request' | 'general';

/** Ticket lifecycle status */
export type TicketStatus = 'new' | 'in_progress' | 'awaiting_response' | 'resolved' | 'escalated';

/** Which agent is handling the ticket */
export type AssignedAgent = 'riley' | 'clark' | 'jordan' | 'casey' | 'morgan' | 'avery';

/** Agent names across all teams */
export type AgentName =
  // Corporate Team
  | 'sloan'    // Chief of Staff (canonical — 'sloane' kept for legacy)
  | 'sloane'   // Chief of Staff (legacy alias)
  | 'blair'    // CMO / Marketing Strategist
  | 'wren'     // Customer Care Director
  | 'tatum'    // PR & Communications Lead
  | 'marlowe'  // CFO / Financial Analyst
  | 'peyton'   // Performance & Analytics Director
  | 'harley'   // Corporate Marketing Lead
  | 'noel'     // Legal & Compliance Officer
  | 'sasha'    // Workforce Manager
  // Support Team
  | 'riley'    // Triage
  | 'clark'    // Tier 1 Responder (renamed from jordan)
  | 'jordan'   // Tier 1 Responder (legacy alias)
  | 'casey'    // Bug Detective
  | 'morgan'   // Onboarding Coach
  | 'sage'     // Retention Specialist
  | 'quinn'    // Feedback Analyst
  | 'avery'    // Escalation Coordinator
  // Marketing Team
  | 'harper'   // Content Writer
  | 'ellis'    // Social Media
  | 'reese'    // Ad Creative
  | 'blake'    // Ad Campaign Manager
  | 'rowan'    // SEO Analyst
  | 'finley'   // Review Solicitor
  | 'cameron'  // Analytics Lead
  | 'drew'     // Competitive Intelligence
  // Spinup Team
  | 'skyler'   // Schema Architect
  | 'emery'    // Copy Strategist
  | 'rory'     // Codebase Engineer
  | 'lennox'   // Infrastructure Engineer
  | 'kai'      // Voice Systems Engineer
  | 'dakota';  // QA Engineer

/** Team names */
export type TeamName = 'corporate' | 'support' | 'marketing' | 'spinup';

/** Vertical identifiers */
export type VerticalId = 'sololawyer' | 'solovet' | 'solorealtor' | 'solotherapist' | 'soloaccountant' | 'soloinsure';

/** Agent run trigger types */
export type RunTrigger = 'cron' | 'direct_invoke' | 'webhook';

/** Agent run status */
export type RunStatus = 'running' | 'success' | 'error';

// ==========================================
// Database row types (match solosolutions_ops schema)
// ==========================================

export interface SupportTicket {
  id: string;
  vertical: VerticalId;
  source_email: string;
  source_message_id: string;
  thread_id: string;
  subject: string | null;
  body_preview: string | null;
  priority: TicketPriority;
  category: TicketCategory;
  status: TicketStatus;
  assigned_agent: AssignedAgent | null;
  customer_id: string | null;
  resolution_summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  escalated_at: string | null;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  direction: 'inbound' | 'outbound';
  gmail_message_id: string | null;
  from_email: string;
  to_email: string;
  subject: string | null;
  body: string;
  sent_at: string;
  created_at: string;
}

export interface AgentRun {
  id: string;
  agent_name: AgentName;
  vertical: VerticalId | null;
  trigger: RunTrigger;
  started_at: string;
  completed_at: string | null;
  status: RunStatus;
  input_summary: string | null;
  output_summary: string | null;
  error_message: string | null;
  tokens_used: number | null;
  cost_usd: number | null;
  metadata: Record<string, unknown> | null;
}

export interface KnowledgeBaseEntry {
  id: string;
  vertical: VerticalId | 'global';
  category: 'faq' | 'help_doc' | 'resolved_ticket';
  title: string;
  content: string;
  tags: string[];
  source: 'manual' | 'resolved_ticket' | 'help_center';
  source_ticket_id: string | null;
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface GmailSyncState {
  id: string;
  email_address: string;
  vertical: VerticalId | null; // null for cross-vertical/corporate agents (e.g. Sloan)
  last_history_id: string;
  last_synced_at: string;
}

// ==========================================
// Vertical configuration
// ==========================================

export interface VerticalConfig {
  vertical: VerticalId;
  display_name: string;
  domain: string;
  support_email: string;
  supabase: {
    url: string;
    service_key: string;
  };
  branding: {
    company_name: string;
    tagline: string;
    support_signature: string;
  };
}

// ==========================================
// Agent team metadata (for logging, digest, etc.)
// ==========================================

export interface AgentProfile {
  name: AgentName;
  display_name: string;
  title: string;
  team: TeamName;
  one_liner: string;
}

export const TEAM_ROSTER: AgentProfile[] = [
  // Corporate Team
  { name: 'sloan',   display_name: 'Sloan',   title: 'Chief of Staff',              team: 'corporate', one_liner: 'I\'m the founder\'s right hand — daily briefing, master task queue, cross-team coordination. I keep you out of the routing bottleneck.' },
  { name: 'blair',   display_name: 'Blair',   title: 'CMO / Marketing Strategist',  team: 'corporate', one_liner: 'I set the marketing strategy across all verticals — budget allocation, channel priorities, launch campaigns. The marketing teams execute my playbook.' },
  { name: 'wren',    display_name: 'Wren',    title: 'Customer Care Director',      team: 'corporate', one_liner: 'When support escalates across any vertical, it lands on my desk. I handle VIPs, cross-vertical issues, and keep support quality consistent.' },
  { name: 'tatum',   display_name: 'Tatum',   title: 'PR & Communications Lead',    team: 'corporate', one_liner: 'Press releases, partnership outreach, corporate blog, media pitches — I make sure the world knows what we\'re building.' },
  { name: 'marlowe', display_name: 'Marlowe', title: 'CFO / Financial Analyst',     team: 'corporate', one_liner: 'I watch the money — Stripe revenue, MRR, churn, LTV, runway. Monthly financial report, advisor rev share calculations, the works.' },
  { name: 'peyton',  display_name: 'Peyton',  title: 'Performance Director',        team: 'corporate', one_liner: 'I score every agent, run the Agent of the Month program, and build KPI dashboards so you always know what\'s working.' },
  { name: 'harley',  display_name: 'Harley',  title: 'Corporate Marketing Lead',    team: 'corporate', one_liner: 'I own solosolutionsai.com content, investor materials, and brand consistency enforcement across all verticals.' },
  { name: 'noel',    display_name: 'Noel',    title: 'Legal & Compliance Officer',  team: 'corporate', one_liner: 'Privacy policies, terms of service, trademark tracking, ethics compliance per profession — I keep us clean across every vertical.' },
  { name: 'sasha',   display_name: 'Sasha',   title: 'Workforce Manager',           team: 'corporate', one_liner: 'I onboard agent instances for new verticals, trigger retraining, plan workforce capacity, and co-run Agent of the Month.' },
  // Support Team
  { name: 'riley',   display_name: 'Riley',   title: 'Support Triage Specialist', team: 'support',   one_liner: 'I read every inbound email and portal ticket, figure out what it\'s about, how urgent it is, and get it to the right person.' },
  { name: 'clark',   display_name: 'Clark',   title: 'Tier 1 Support Rep',        team: 'support',   one_liner: 'I handle the everyday questions — setup help, how-tos, billing basics. If I\'m confident, I reply on the spot.' },
  { name: 'jordan',  display_name: 'Jordan',  title: 'Tier 1 Support Rep (legacy)', team: 'support', one_liner: 'Legacy alias for Clark.' },
  { name: 'casey',   display_name: 'Casey',   title: 'Technical Investigator',    team: 'support',   one_liner: 'When something\'s broken, I dig into the logs before anyone panics. Usually I can tell you what happened in minutes.' },
  { name: 'morgan',  display_name: 'Morgan',  title: 'Onboarding Coach',          team: 'support',   one_liner: 'I watch new signups and nudge them if they stall. No logo uploaded by day 3? They\'re hearing from me.' },
  { name: 'sage',    display_name: 'Sage',    title: 'Retention Specialist',      team: 'support',   one_liner: 'I spot the warning signs — no logins, no intakes, failed payment — and re-engage before they ghost.' },
  { name: 'quinn',   display_name: 'Quinn',   title: 'Feedback Analyst',          team: 'support',   one_liner: 'After every resolved ticket, I follow up. I turn patterns in feedback into a ranked feature backlog.' },
  { name: 'avery',   display_name: 'Avery',   title: 'Escalation Coordinator',    team: 'support',   one_liner: 'When it\'s beyond self-serve, I package everything up clean so you can respond in minutes, not hours.' },
  // Marketing Team
  { name: 'harper',  display_name: 'Harper',  title: 'Content Writer',            team: 'marketing', one_liner: 'I write the blog posts — SEO-optimized, profession-specific, 4 per month per vertical.' },
  { name: 'ellis',   display_name: 'Ellis',   title: 'Social Media Manager',      team: 'marketing', one_liner: 'I create and schedule posts for Facebook, Instagram, and LinkedIn — wherever the profession hangs out.' },
  { name: 'reese',   display_name: 'Reese',   title: 'Ad Creative Director',      team: 'marketing', one_liner: 'I write the ad copy — headlines, descriptions, A/B variants. I refresh monthly so nothing goes stale.' },
  { name: 'blake',   display_name: 'Blake',   title: 'Ad Campaign Manager',       team: 'marketing', one_liner: 'I set up the campaigns, watch the numbers daily, pause the losers, and scale the winners.' },
  { name: 'rowan',   display_name: 'Rowan',   title: 'SEO Analyst',               team: 'marketing', one_liner: 'I track your keyword rankings, find content gaps, and flag when competitors start outranking you.' },
  { name: 'finley',  display_name: 'Finley',  title: 'Review Solicitor',          team: 'marketing', one_liner: 'After someone\'s been a happy customer for 2 weeks, I ask them to leave a review. Politely.' },
  { name: 'cameron', display_name: 'Cameron', title: 'Analytics Lead',            team: 'marketing', one_liner: 'I pull the numbers from everywhere — ads, Stripe, Supabase — and give you one clean weekly report.' },
  { name: 'drew',    display_name: 'Drew',    title: 'Competitive Intelligence',  team: 'marketing', one_liner: 'I watch what competitors are doing — pricing changes, new features, new entrants — so you\'re never surprised.' },
  // Spinup Team
  { name: 'skyler',  display_name: 'Skyler',  title: 'Schema Architect',          team: 'spinup',    one_liner: 'Tell me the profession and I\'ll research it, design the full intake schema, validation rules, bilingual labels — everything.' },
  { name: 'emery',   display_name: 'Emery',   title: 'Copy Strategist',           team: 'spinup',    one_liner: 'I write every word the customer sees — landing page, emails, FAQ, onboarding, error messages. All of it.' },
  { name: 'rory',    display_name: 'Rory',    title: 'Codebase Engineer',         team: 'spinup',    one_liner: 'I clone the template repo, swap out everything profession-specific, and hand you a clean, buildable codebase.' },
  { name: 'lennox',  display_name: 'Lennox',  title: 'Infrastructure Engineer',   team: 'spinup',    one_liner: 'Supabase project, database migrations, Vercel deployment, DNS — I wire it all up and hand you the keys.' },
  { name: 'kai',     display_name: 'Kai',     title: 'Voice Systems Engineer',    team: 'spinup',    one_liner: 'I create the Vapi voice assistant, configure the persona, set up the webhook, and provision the phone number.' },
  { name: 'dakota',  display_name: 'Dakota',  title: 'QA Engineer',               team: 'spinup',    one_liner: 'I run the full smoke test — create an account, complete an intake, check the database, verify emails sent. If it passes, it\'s live.' },
];

/** Agent run result — returned by each agent's run() function */
export interface AgentRunResult {
  summary: string;
  tokensUsed?: number;
}

/** Look up an agent's profile by name */
export function getAgent(name: AgentName): AgentProfile {
  const agent = TEAM_ROSTER.find(a => a.name === name);
  if (!agent) throw new Error(`Unknown agent: ${name}`);
  return agent;
}

/** Get all agents on a team */
export function getTeam(team: TeamName): AgentProfile[] {
  return TEAM_ROSTER.filter(a => a.team === team);
}
