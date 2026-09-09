/**
 * Seed the knowledge base with SoloLawyerAI FAQs.
 * Jordan uses this to answer support questions.
 *
 * Run: npx tsx scripts/seed-knowledge-base.ts
 */

import 'dotenv/config';
import { getOpsClient } from '../packages/shared/src/supabase.js';

const supabase = getOpsClient();

const faqs = [
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'What is SoloLawyerAI?',
    content: 'SoloLawyerAI is an AI-powered client intake platform designed specifically for solo attorneys. It handles client intake through chat, web forms, and phone (via AI voice assistant), collects case details, and organizes everything in your dashboard — so you can focus on practicing law instead of fielding intake calls.',
    tags: ['product', 'overview'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'What are the pricing plans?',
    content: 'SoloLawyerAI offers three plans:\n\n- **Starter ($49/mo)**: Chat widget + web intake form, email notifications, basic dashboard\n- **Pro ($79/mo)**: Everything in Starter + AI voice assistant (phone intake), bilingual support (English/Spanish), advanced analytics\n- **Pro+ ($119/mo)**: Everything in Pro + dedicated phone number, priority support, custom branding, API access\n\nAll plans include a 14-day free trial. A card is required to start the trial; you are not charged until day 15, and you can cancel before then at no cost.',
    tags: ['pricing', 'plans', 'billing'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'How do I cancel my subscription?',
    content: 'You can cancel your subscription at any time from your dashboard under Settings → Billing → Cancel Subscription. Your account will remain active until the end of your current billing period. No cancellation fees. If you need help, email support@sololawyerai.com.',
    tags: ['billing', 'cancellation'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'How do I set up the chat widget on my website?',
    content: 'To add the SoloLawyerAI chat widget to your website:\n\n1. Go to Dashboard → Settings → Chat Widget\n2. Copy the embed code (a small JavaScript snippet)\n3. Paste it into your website\'s HTML, just before the closing </body> tag\n4. The widget will appear as a chat bubble in the bottom-right corner\n\nWorks with any website — WordPress, Wix, Squarespace, custom sites, etc. If you need help with installation, our support team can walk you through it.',
    tags: ['setup', 'chat', 'widget', 'onboarding'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'How does the AI voice assistant work?',
    content: 'The AI voice assistant (available on Pro and Pro+ plans) answers phone calls on your behalf using natural-sounding AI. It:\n\n- Greets callers professionally using your firm name\n- Asks intake questions (name, contact info, legal issue, urgency)\n- Supports English and Spanish\n- Records the conversation summary (not audio) in your dashboard\n- Sends you an email notification with the intake details\n\nYou can customize the greeting, questions, and persona in Dashboard → Settings → Voice Assistant.',
    tags: ['voice', 'phone', 'vapi', 'ai assistant'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'How do I get a dedicated phone number?',
    content: 'Dedicated phone numbers are included with the Pro+ plan ($119/mo). Once you upgrade:\n\n1. Go to Dashboard → Settings → Phone Number\n2. Choose your area code preference\n3. A local number will be provisioned within minutes\n4. Forward your existing business line to this number, or use it directly\n\nThe number is yours as long as your subscription is active.',
    tags: ['phone', 'number', 'pro+'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'Is my client data secure?',
    content: 'Yes. SoloLawyerAI takes data security seriously:\n\n- All data is encrypted at rest and in transit (AES-256, TLS 1.3)\n- Hosted on Supabase (SOC 2 Type II certified) with US-based servers\n- No client data is used to train AI models\n- You own your data — export or delete anytime\n- Role-based access controls\n\nWe understand the sensitivity of legal client information and maintain strict data handling practices consistent with attorney-client privilege requirements.',
    tags: ['security', 'privacy', 'data', 'compliance'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'Can I customize the intake questions?',
    content: 'Yes! You can fully customize the intake questions for both the chat widget and voice assistant:\n\n1. Go to Dashboard → Settings → Intake Form\n2. Add, remove, or reorder questions\n3. Set required vs optional fields\n4. Add practice-area-specific questions (e.g., accident date for PI, filing deadline for immigration)\n\nChanges apply immediately to both chat and phone intake channels.',
    tags: ['customization', 'intake', 'forms', 'setup'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'What practice areas does SoloLawyerAI support?',
    content: 'SoloLawyerAI works with any practice area. The AI is trained to handle intake for common solo practice areas including:\n\n- Personal Injury\n- Family Law\n- Criminal Defense\n- Immigration\n- Estate Planning\n- Real Estate\n- Business Law\n- General Practice\n\nThe intake questions and AI responses adapt based on the practice area you configure in your settings.',
    tags: ['practice areas', 'legal', 'specialties'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'How do I contact support?',
    content: 'You can reach our support team at:\n\n- Email: support@sololawyerai.com (fastest response)\n- Dashboard: Click the Help icon in the bottom-left corner\n\nOur support hours are Monday–Friday, 9 AM – 6 PM ET. We typically respond within a few hours during business hours.',
    tags: ['support', 'contact', 'help'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'I forgot my password / can\'t log in',
    content: 'To reset your password:\n\n1. Go to app.sololawyerai.com/login\n2. Click "Forgot password?"\n3. Enter the email address you signed up with\n4. Check your inbox for a password reset link (check spam folder too)\n5. Click the link and set a new password\n\nIf you\'re still having trouble, email support@sololawyerai.com and we\'ll help you regain access.',
    tags: ['login', 'password', 'access', 'account'],
    source: 'manual' as const,
  },
  {
    vertical: 'sololawyer',
    category: 'faq' as const,
    title: 'Do you offer bilingual / Spanish support?',
    content: 'Yes! Bilingual support (English and Spanish) is available on Pro and Pro+ plans:\n\n- The chat widget automatically detects the visitor\'s language preference\n- The voice assistant can conduct full intake conversations in Spanish\n- Intake form fields support bilingual labels\n- Dashboard data is stored in the original language with English translations\n\nThis is especially valuable for immigration, family law, and personal injury practices serving Hispanic communities.',
    tags: ['bilingual', 'spanish', 'language'],
    source: 'manual' as const,
  },
];

async function main() {
  console.log('Seeding knowledge base with SoloLawyerAI FAQs...\n');

  const { data, error } = await supabase
    .from('knowledge_base')
    .insert(faqs)
    .select('id, title');

  if (error) {
    console.error('Error seeding KB:', error);
    return;
  }

  console.log(`Seeded ${data.length} FAQ entries:\n`);
  for (const entry of data) {
    console.log(`  ✓ ${entry.title}`);
  }
  console.log('\nJordan is ready to answer questions.');
}

main().catch(console.error);
