import {
  agentLogger,
  getAnthropicClient,
  DEFAULT_MODEL,
  getOpsClient,
} from '@solo/shared';
import type { AgentRunResult, VerticalId } from '@solo/shared';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ═══════════════════════════════════════════
 * EMERY — Copy Strategist
 * ═══════════════════════════════════════════
 *
 * "I write every word the customer sees — landing page,
 *  emails, FAQ, onboarding, error messages. All of it."
 *
 * Team: Spinup
 * Trigger: Invoked by spinup orchestrator after Skyler (schema) completes
 * ═══════════════════════════════════════════
 */

// ─── Vertical Marketing Configs ─────────────────────────────────────────────

export interface VerticalMarketingConfig {
  vertical: VerticalId;
  displayName: string;           // "SoloVetAI"
  professionSingular: string;    // "veterinarian"
  professionPlural: string;      // "veterinarians"
  professionTitle: string;       // "Veterinary Practice"
  clientTerm: string;            // "pet owner"
  clientTermPlural: string;      // "pet owners"
  issueTerm: string;             // "pet concern"
  caseTerm: string;              // "appointment"
  consultationTerm: string;      // "appointment"
  accentColor: string;           // "#10B981"
  accentName: string;            // "emerald"
  accentTailwind: string;        // "emerald-500"
  domain: string;                // "solovetai.com"
  launchTimeline: string;        // "Q2 2026"
  tagline: string;               // "AI-Powered Client Intake for Veterinary Practices"
  painPoints: [PainPoint, PainPoint, PainPoint];
  heroHeadline: string;
  heroDescription: string;
  closingHeadline: string;
  closingDescription: string;
  heroChat: HeroChatConfig;
  dualBenefitSteps: [DualBenefitStep, DualBenefitStep, DualBenefitStep, DualBenefitStep];
}

interface PainPoint {
  title: string;
  body: string;
}

interface HeroChatConfig {
  assistantName: string;         // "Luna"
  firmExample: string;           // "Pawsitive Care Veterinary"
  firmShort: string;             // "PC"
  roleLabel: string;             // "Veterinary Assistant"
  greeting: string;
  question: string;
  clientResponse: string;
  empathyFollowUp: string;
  notificationName: string;      // "Sarah Mitchell"
  notificationType: string;      // "Limping Dog"
  aiInsight: string;             // "AI: Possible ligament injury — X-ray recommended"
}

interface DualBenefitStep {
  label: string;                 // "Client Reaches Out"
  forYouTitle: string;
  forYouBody: string;
  forClientTitle: string;
  forClientBody: string;
}

// ─── Vertical Configs ────────────────────────────────────────────────────────

export const VERTICAL_CONFIGS: Record<string, VerticalMarketingConfig> = {
  solovet: {
    vertical: 'solovet',
    displayName: 'SoloVetAI',
    professionSingular: 'veterinarian',
    professionPlural: 'veterinarians',
    professionTitle: 'Veterinary Practice',
    clientTerm: 'pet owner',
    clientTermPlural: 'pet owners',
    issueTerm: 'pet concern',
    caseTerm: 'visit',
    consultationTerm: 'appointment',
    accentColor: '#10B981',
    accentName: 'emerald',
    accentTailwind: 'emerald-500',
    domain: 'solovetai.com',
    launchTimeline: 'Q2 2026',
    tagline: 'AI-Powered Client Intake for Veterinary Practices',
    heroHeadline: 'Your Next Patient Intake Runs Itself.',
    heroDescription: 'SoloVetAI handles client intake by chat, phone, or website widget — captures every detail about the animal\'s symptoms and history, and delivers a structured visit summary with AI context notes — so your team is prepared before the first appointment.',
    closingHeadline: 'Your intake runs while you\'re in surgery.',
    closingDescription: 'Stop losing new patients to missed calls and after-hours gaps. Chat, phone, and document intake — always on, always branded, always ready.',
    painPoints: [
      {
        title: 'Phone rings non-stop',
        body: 'A worried pet owner calls while you\'re in an exam room. They leave a voicemail. You call back between appointments. They don\'t answer. By the time you connect, they\'ve taken their pet somewhere else.',
      },
      {
        title: 'Every visit starts from zero',
        body: 'You spend the first 10 minutes of every new patient visit learning basics — pet name, breed, symptoms, history — that you could have captured before they walked in.',
      },
      {
        title: 'After-hours emergencies go dark',
        body: 'A pet owner\'s dog starts limping at 10pm on a Saturday. They search for vets, find your website, and have no way to tell you what\'s wrong. They call the 24-hour emergency clinic instead.',
      },
    ],
    heroChat: {
      assistantName: 'Luna',
      firmExample: 'Pawsitive Care Veterinary',
      firmShort: 'PC',
      roleLabel: 'Veterinary Assistant',
      greeting: 'Hi! I\'m Luna with Pawsitive Care Veterinary. I\'ll help gather details about your pet before your visit — it only takes a few minutes.',
      question: 'What brings your pet in today?',
      clientResponse: 'My dog has been limping on his back left leg since yesterday — he yelped when he jumped off the couch.',
      empathyFollowUp: 'I\'m sorry to hear that — let\'s make sure the vet has everything they need. How old is your dog, and what breed?',
      notificationName: 'Sarah Mitchell',
      notificationType: 'Limping Dog · Lab Mix',
      aiInsight: 'AI: Possible ligament injury — onset timing critical',
    },
    dualBenefitSteps: [
      {
        label: 'Pet Owner Reaches Out',
        forYouTitle: 'Never miss a new patient',
        forYouBody: 'Intake runs 24/7 — nights, weekends, holidays. Every pet owner is captured the moment they reach out.',
        forClientTitle: 'Get help the moment your pet needs it',
        forClientBody: 'No voicemail, no waiting until Monday. Reach out at 2am when your pet is in distress and get an immediate, caring response.',
      },
      {
        label: 'AI Conversation',
        forYouTitle: 'Every detail captured automatically',
        forYouBody: 'Structured intake with pet history, symptoms, and timeline — no scribbled notes, no missed details, no 10-minute fact-finding at check-in.',
        forClientTitle: 'Tell your pet\'s story once — conversationally',
        forClientBody: 'No intimidating forms. A warm, empathetic conversation that feels like talking to a real person — so you can explain exactly what\'s going on.',
      },
      {
        label: 'Vet Reviews',
        forYouTitle: 'Walk into every exam fully prepared',
        forYouBody: 'AI-generated visit brief with symptom analysis, breed-specific flags, and suggested diagnostics — before the pet even arrives.',
        forClientTitle: 'Your vet already understands your pet\'s situation',
        forClientBody: 'No repeating yourself. Your first real conversation starts where it should — with the exam, diagnosis, and next steps.',
      },
      {
        label: 'First Appointment',
        forYouTitle: 'More time for what matters',
        forYouBody: 'Spend your time on diagnosis and treatment — not copying intake notes from voicemail or chasing down basic pet history.',
        forClientTitle: 'A faster path to care for your pet',
        forClientBody: 'From "my pet needs a vet" to a prepared appointment — faster than you thought possible. The care of a specialist with the personal touch of a neighborhood practice.',
      },
    ],
  },
  solorealtor: {
    vertical: 'solorealtor',
    displayName: 'SoloRealtorAI',
    professionSingular: 'realtor',
    professionPlural: 'realtors',
    professionTitle: 'Real Estate',
    clientTerm: 'buyer',
    clientTermPlural: 'buyers and sellers',
    issueTerm: 'property needs',
    caseTerm: 'transaction',
    consultationTerm: 'showing',
    accentColor: '#3B82F6',
    accentName: 'blue',
    accentTailwind: 'blue-500',
    domain: 'solorealtorai.com',
    launchTimeline: 'Q2 2026',
    tagline: 'AI-Powered Client Intake for Real Estate Agents',
    heroHeadline: 'Your Next Client Intake Runs Itself.',
    heroDescription: 'SoloRealtorAI handles client intake by chat, phone, or website widget — captures every detail about what buyers want and sellers need, and delivers a structured summary with AI context notes — so you\'re prepared before the first showing.',
    closingHeadline: 'Your intake runs while you\'re at a closing.',
    closingDescription: 'Stop losing leads to missed calls and after-hours gaps. Chat, phone, and document intake — always on, always branded, always ready.',
    painPoints: [
      {
        title: 'Buyer inquiries pile up',
        body: 'A buyer submits an inquiry while you\'re at a showing. They email, call, and text. You respond 4 hours later. By then, they\'ve already scheduled with another agent who replied in 5 minutes.',
      },
      {
        title: 'Every showing starts from scratch',
        body: 'You spend the first 15 minutes of every buyer meeting asking the basics — budget, neighborhoods, timeline, pre-approval status — that you could have captured before you ever met.',
      },
      {
        title: 'Hot leads go cold after hours',
        body: 'A seller decides to list their home at 9pm on a Tuesday. They browse agent websites, fill out a contact form, and hear nothing until tomorrow. They pick the agent who responded first.',
      },
    ],
    heroChat: {
      assistantName: 'Sage',
      firmExample: 'Keystone Real Estate',
      firmShort: 'KR',
      roleLabel: 'Real Estate Assistant',
      greeting: 'Hi! I\'m Sage with Keystone Real Estate. I\'ll help gather details about what you\'re looking for — it only takes a few minutes.',
      question: 'Are you looking to buy, sell, or both?',
      clientResponse: 'We\'re looking to buy our first home — ideally a 3-bed in the Westside area, under $450K.',
      empathyFollowUp: 'That\'s exciting — buying your first home is a big step! Let\'s make sure the agent has everything they need. What\'s your target timeline?',
      notificationName: 'David & Maria Chen',
      notificationType: 'First-Time Buyer · Westside',
      aiInsight: 'AI: Pre-approval needed — median Westside $420K, in range',
    },
    dualBenefitSteps: [
      {
        label: 'Buyer Reaches Out',
        forYouTitle: 'Never miss a lead',
        forYouBody: 'Intake runs 24/7 — nights, weekends, open house days. Every prospect is captured the moment they reach out.',
        forClientTitle: 'Get help the moment you start looking',
        forClientBody: 'No voicemail, no waiting until Monday. Start your home search at midnight and get an immediate, helpful response.',
      },
      {
        label: 'AI Conversation',
        forYouTitle: 'Every detail captured automatically',
        forYouBody: 'Structured intake with budget, neighborhoods, timeline, and must-haves — no scribbled notes, no missed details, no 15-minute fact-finding at the first meeting.',
        forClientTitle: 'Tell your story once — conversationally',
        forClientBody: 'No intimidating forms. A warm conversation that helps you articulate exactly what you\'re looking for — so your agent finds the right homes from day one.',
      },
      {
        label: 'Agent Reviews',
        forYouTitle: 'Walk into every meeting fully prepared',
        forYouBody: 'AI-generated client brief with budget analysis, neighborhood insights, and suggested listings — before you ever pick up the phone.',
        forClientTitle: 'Your agent already understands what you want',
        forClientBody: 'No repeating yourself. Your first real conversation starts where it should — with properties that actually match what you\'re looking for.',
      },
      {
        label: 'First Showing',
        forYouTitle: 'More time for what matters',
        forYouBody: 'Spend your time on showings, negotiations, and closing deals — not copying intake notes from voicemail or chasing down pre-approval status.',
        forClientTitle: 'A faster path to your new home',
        forClientBody: 'From "we need a realtor" to touring homes that fit — faster than you thought possible. The resources of a large brokerage with the personal touch of a solo agent.',
      },
    ],
  },

  soloaccountant: {
    vertical: 'soloaccountant',
    displayName: 'SoloAccountantAI',
    professionSingular: 'accountant',
    professionPlural: 'accountants',
    professionTitle: 'Accounting Practice',
    clientTerm: 'client',
    clientTermPlural: 'clients',
    issueTerm: 'financial situation',
    caseTerm: 'engagement',
    consultationTerm: 'consultation',
    accentColor: '#8B5CF6',
    accentName: 'violet',
    accentTailwind: 'violet-500',
    domain: 'soloaccountantai.com',
    launchTimeline: 'Q3 2026',
    tagline: 'AI-Powered Client Intake for Accounting Practices',
    heroHeadline: 'Your Next Client Intake Runs Itself.',
    heroDescription: 'SoloAccountantAI handles client intake by chat, phone, or website widget — captures every detail about their financial situation and needs, and delivers a structured summary with AI context notes — so you\'re prepared before the first meeting.',
    closingHeadline: 'Your intake runs through tax season.',
    closingDescription: 'Stop losing clients to slow responses and after-hours gaps. Chat, phone, and document intake — always on, always branded, always ready.',
    painPoints: [
      {
        title: 'Tax season buries you',
        body: 'New client calls while you\'re deep in a return. They leave a voicemail. You call back between filings. By the time you connect, they\'ve found an accountant who picked up the phone.',
      },
      {
        title: 'Missing documents, every time',
        body: 'New clients show up to their first meeting missing half the documents you need — last year\'s return, W-2s, 1099s — and you spend the session making a list instead of reviewing numbers.',
      },
      {
        title: 'After-hours leads go unanswered',
        body: 'A small business owner realizes they need an accountant at 11pm after staring at their books. They email three firms. The one that responds first gets the client.',
      },
    ],
    heroChat: {
      assistantName: 'Avery',
      firmExample: 'Summit Financial Group',
      firmShort: 'SF',
      roleLabel: 'Accounting Assistant',
      greeting: 'Hi! I\'m Avery with Summit Financial Group. I\'ll help gather details about your financial needs — it only takes a few minutes.',
      question: 'What type of accounting service are you looking for?',
      clientResponse: 'I just started an LLC and need help with quarterly taxes and bookkeeping — I\'m completely lost with the business side.',
      empathyFollowUp: 'Starting a business is a big step — you\'re smart to get professional help early. Let\'s make sure the accountant has everything they need. What type of business is it?',
      notificationName: 'Rachel Torres',
      notificationType: 'New LLC · Quarterly Taxes',
      aiInsight: 'AI: Q1 estimated taxes likely due — entity election timing critical',
    },
    dualBenefitSteps: [
      {
        label: 'Client Reaches Out',
        forYouTitle: 'Never miss a new client',
        forYouBody: 'Intake runs 24/7 — nights, weekends, tax season crunch. Every prospect is captured the moment they reach out.',
        forClientTitle: 'Get help the moment you need it',
        forClientBody: 'No voicemail, no waiting until business hours. Reach out at midnight during tax panic and get an immediate, helpful response.',
      },
      {
        label: 'AI Conversation',
        forYouTitle: 'Every detail captured automatically',
        forYouBody: 'Structured intake with business type, revenue range, service needs, and deadlines — no scribbled notes, no missed details, no 20-minute fact-finding calls.',
        forClientTitle: 'Explain your situation once — conversationally',
        forClientBody: 'No intimidating forms full of accounting jargon. A warm conversation that helps you explain your financial situation in plain language.',
      },
      {
        label: 'Accountant Reviews',
        forYouTitle: 'Walk into every meeting fully prepared',
        forYouBody: 'AI-generated client brief with entity analysis, deadline flags, and suggested service scope — before you ever pick up the phone.',
        forClientTitle: 'Your accountant already understands your situation',
        forClientBody: 'No repeating yourself. Your first real conversation starts where it should — with strategy, tax planning, and next steps.',
      },
      {
        label: 'First Consultation',
        forYouTitle: 'More time for what matters',
        forYouBody: 'Spend your time on analysis and advisory — not copying intake notes from voicemail or chasing down basic financial information.',
        forClientTitle: 'A faster path to financial clarity',
        forClientBody: 'From "I need an accountant" to a prepared consultation — faster than you thought possible. Expert guidance with the personal attention of a dedicated CPA.',
      },
    ],
  },

  soloinsure: {
    vertical: 'soloinsure',
    displayName: 'SoloInsureAI',
    professionSingular: 'insurance agent',
    professionPlural: 'insurance agents',
    professionTitle: 'Insurance Agency',
    clientTerm: 'policyholder',
    clientTermPlural: 'policyholders',
    issueTerm: 'insurance needs',
    caseTerm: 'policy',
    consultationTerm: 'policy review',
    accentColor: '#F59E0B',
    accentName: 'amber',
    accentTailwind: 'amber-500',
    domain: 'soloinsureai.com',
    launchTimeline: 'Q3 2026',
    tagline: 'AI-Powered Client Intake for Insurance Agents',
    heroHeadline: 'Your Next Client Intake Runs Itself.',
    heroDescription: 'SoloInsureAI handles client intake by chat, phone, or website widget — captures every detail about their coverage needs and current policies, and delivers a structured summary with AI context notes — so you\'re prepared before the first call.',
    closingHeadline: 'Your intake runs while you\'re closing deals.',
    closingDescription: 'Stop losing clients to slow quotes and after-hours gaps. Chat, phone, and document intake — always on, always branded, always ready.',
    painPoints: [
      {
        title: 'Quote requests stack up',
        body: 'A prospect fills out your website form for an auto quote. Then another for homeowners. Then a call about life insurance. Each one needs the same 20 questions answered — and you\'re already behind.',
      },
      {
        title: 'Incomplete applications, every time',
        body: 'You send a client a quote request form. It comes back missing their current carrier, policy limits, and claims history. You spend more time chasing info than writing the policy.',
      },
      {
        title: 'After-hours leads vanish',
        body: 'Someone\'s car gets totaled at 8pm. They need new coverage by morning. They find your website, see no way to start the process, and call the 1-800 number for a national carrier instead.',
      },
    ],
    heroChat: {
      assistantName: 'Parker',
      firmExample: 'Shield Insurance Group',
      firmShort: 'SI',
      roleLabel: 'Insurance Assistant',
      greeting: 'Hi! I\'m Parker with Shield Insurance Group. I\'ll help gather details about your insurance needs — it only takes a few minutes.',
      question: 'What type of insurance are you looking for today?',
      clientResponse: 'I just bought a new house and need to bundle homeowners and auto insurance — my current rates feel way too high.',
      empathyFollowUp: 'Congrats on the new home! Bundling is a great idea — we can usually find significant savings. Let me get a few details to make sure the agent can quote you accurately.',
      notificationName: 'Jason & Amy Wright',
      notificationType: 'Bundle · Home + Auto',
      aiInsight: 'AI: Current rates above market — high savings potential on bundle',
    },
    dualBenefitSteps: [
      {
        label: 'Client Reaches Out',
        forYouTitle: 'Never miss a quote request',
        forYouBody: 'Intake runs 24/7 — nights, weekends, after accidents. Every prospect is captured the moment they reach out.',
        forClientTitle: 'Get help the moment you need coverage',
        forClientBody: 'No voicemail, no waiting until Monday. Reach out after a fender-bender at midnight and get an immediate, helpful response.',
      },
      {
        label: 'AI Conversation',
        forYouTitle: 'Every detail captured automatically',
        forYouBody: 'Structured intake with coverage needs, current policies, claims history, and budget — no scribbled notes, no chasing missing info, no back-and-forth emails.',
        forClientTitle: 'Explain your needs once — conversationally',
        forClientBody: 'No intimidating forms full of insurance jargon. A warm conversation that helps you explain what coverage you need in plain language.',
      },
      {
        label: 'Agent Reviews',
        forYouTitle: 'Walk into every call fully prepared',
        forYouBody: 'AI-generated client brief with coverage gaps, competitive analysis flags, and suggested products — before you ever pick up the phone.',
        forClientTitle: 'Your agent already understands your needs',
        forClientBody: 'No repeating yourself. Your first real conversation starts where it should — with quotes, options, and savings.',
      },
      {
        label: 'First Policy Review',
        forYouTitle: 'More time for what matters',
        forYouBody: 'Spend your time on quoting and relationship-building — not copying intake notes from voicemail or chasing down current policy details.',
        forClientTitle: 'A faster path to the right coverage',
        forClientBody: 'From "I need insurance" to a prepared quote — faster than you thought possible. Competitive rates with the personal attention of a dedicated agent.',
      },
    ],
  },

  solotherapist: {
    vertical: 'solotherapist',
    displayName: 'SoloTherapistAI',
    professionSingular: 'therapist',
    professionPlural: 'therapists',
    professionTitle: 'Therapy Practice',
    clientTerm: 'client',
    clientTermPlural: 'clients',
    issueTerm: 'what brings you in',
    caseTerm: 'treatment',
    consultationTerm: 'session',
    accentColor: '#EC4899',
    accentName: 'pink',
    accentTailwind: 'pink-500',
    domain: 'solotherapistai.com',
    launchTimeline: 'Q3 2026',
    tagline: 'AI-Powered Client Intake for Therapy Practices',
    heroHeadline: 'Your Next Client Intake Runs Itself.',
    heroDescription: 'SoloTherapistAI handles client intake by chat, phone, or website widget — creates a warm, private space for new clients to share what brings them in, and delivers a structured summary with AI context notes — so you\'re prepared before the first session.',
    closingHeadline: 'Your intake runs while you\'re with clients.',
    closingDescription: 'Stop losing new patients to cold intake forms and after-hours gaps. Chat, phone, and document intake — always on, always warm, always ready.',
    painPoints: [
      {
        title: 'Intake forms feel clinical',
        body: 'A prospective patient finally works up the courage to seek help. They visit your website and find a cold, clinical intake form. It feels like filling out paperwork at a hospital — not the first impression you want.',
      },
      {
        title: 'First sessions start from zero',
        body: 'You spend the first 15 minutes of every new patient session catching up on basics — what brings them in, their history, what they\'ve tried before — when you could be building rapport and starting treatment.',
      },
      {
        title: 'After-hours cries for help go dark',
        body: 'Someone decides at 11pm on a Wednesday that they need to talk to someone. They find your website, see no way to reach out, and the moment passes. They don\'t call back in the morning.',
      },
    ],
    heroChat: {
      assistantName: 'River',
      firmExample: 'Calm Harbor Therapy',
      firmShort: 'CH',
      roleLabel: 'Intake Coordinator',
      greeting: 'Hi, welcome to Calm Harbor Therapy. I\'m River, and I\'m here to help you take this first step. Everything you share is private — let\'s start whenever you\'re ready.',
      question: 'What brings you to therapy today?',
      clientResponse: 'I\'ve been dealing with a lot of anxiety lately — it\'s affecting my sleep and my work. I\'ve never talked to a therapist before.',
      empathyFollowUp: 'Thank you for sharing that — reaching out for the first time takes real courage. Let\'s make sure the therapist has what they need to help you. How long have you been experiencing these feelings?',
      notificationName: 'Emily Park',
      notificationType: 'Anxiety · First-Time Client',
      aiInsight: 'AI: Sleep + work impact noted — assess for GAD screening',
    },
    dualBenefitSteps: [
      {
        label: 'Client Reaches Out',
        forYouTitle: 'Never miss someone asking for help',
        forYouBody: 'Intake runs 24/7 — nights, weekends, when people need help most. Every person who reaches out is met with a warm, immediate response.',
        forClientTitle: 'Get support the moment you\'re ready',
        forClientBody: 'No voicemail, no waiting for business hours. Reach out at 2am when you can\'t sleep and get an immediate, caring response that feels human.',
      },
      {
        label: 'AI Conversation',
        forYouTitle: 'Every detail captured with care',
        forYouBody: 'Sensitive, structured intake that captures what brings them in, their history, and their goals — in a warm, conversational tone that respects the vulnerability of the moment.',
        forClientTitle: 'Share at your own pace — conversationally',
        forClientBody: 'No cold forms. A warm, private conversation that feels like talking to a caring person — because the hardest part is just starting.',
      },
      {
        label: 'Therapist Reviews',
        forYouTitle: 'Walk into every first session prepared',
        forYouBody: 'AI-generated intake summary with presenting concerns, relevant history, and suggested screening considerations — so you can focus on connection from minute one.',
        forClientTitle: 'Your therapist already understands your situation',
        forClientBody: 'No repeating your story. Your first session starts where it should — with your therapist already understanding what brought you here.',
      },
      {
        label: 'First Session',
        forYouTitle: 'More time for what matters',
        forYouBody: 'Spend your time on therapeutic rapport and treatment — not administrative intake questions that could have been captured before the session.',
        forClientTitle: 'A gentler path to getting help',
        forClientBody: 'From "I think I need therapy" to a prepared first session — with a therapist who already gets it. Professional care with the warmth you need right now.',
      },
    ],
  },
};

// ─── Prompt Templates ────────────────────────────────────────────────────────

/**
 * Builds the system prompt for Emery's copy adaptation task.
 * This tells Claude exactly what to change and what to preserve.
 */
function buildIndexPagePrompt(config: VerticalMarketingConfig): string {
  return `You are Emery, a copy strategist for SoloSolutionsAI. Your job is to adapt the SoloLawyerAI marketing homepage for a new vertical: ${config.displayName}.

## CRITICAL RULES
1. Output ONLY the complete, valid TSX file — no markdown, no explanation, no code fences.
2. Preserve the EXACT same component structure, Tailwind classes, layout, and section order.
3. Change ONLY text content, brand names, and profession-specific terminology.
4. NEVER invent features that don't exist in the reference.
5. The accent color #E8713A (SoloLawyerAI orange) must be replaced with ${config.accentColor} (${config.accentName}).
6. Replace #0F2745 references ONLY in text/branding, NOT in the navy UI backgrounds (navy is shared brand).
7. All "Start Free Trial" buttons → "Join the Waitlist" (pre-launch site).
8. Add a "Coming ${config.launchTimeline}" badge next to the hero badge.
9. The hero illustration chat must use the provided conversation (assistant name, firm, dialogue).
10. The component must be named "Index" and exported as default.

## TERMINOLOGY REPLACEMENTS
- "SoloLawyerAI" → "${config.displayName}"
- "attorney" / "lawyer" → "${config.professionSingular}"
- "client" (when referring to the professional's customer) → "${config.clientTerm}"
- "legal issue" / "legal matter" → "${config.issueTerm}"
- "case" → "${config.caseTerm}"
- "consultation" → "${config.consultationTerm}"
- "practice area" → "specialty"
- "court dates" → "follow-up ${config.consultationTerm}s"
- "solo attorney" / "solo attorneys" → "solo ${config.professionPlural}"

## HERO SECTION
- Badge: "AI-Powered ${config.professionTitle} Intake"
- Headline: "${config.heroHeadline}"
- Description: "${config.heroDescription}"
- CTA: "Join the Waitlist" (not "Start Free Trial")
- Add second badge: "Coming ${config.launchTimeline}" with accent color background

## HERO CHAT ILLUSTRATION
- Assistant name: "${config.heroChat.assistantName}"
- Firm: "${config.heroChat.firmExample}"
- Initials: "${config.heroChat.firmShort}"
- Role: "${config.heroChat.roleLabel}"
- Greeting: "${config.heroChat.greeting}"
- Question: "${config.heroChat.question}"
- Client response: "${config.heroChat.clientResponse}"
- Empathy follow-up: "${config.heroChat.empathyFollowUp}"
- Notification card: name="${config.heroChat.notificationName}", type="${config.heroChat.notificationType}"
- AI insight: "${config.heroChat.aiInsight}"

## PAIN POINTS (Section 3)
Subheading: "Solo ${config.professionPlural} lose time and ${config.clientTermPlural} to the same three problems every day."
1. "${config.painPoints[0].title}" — ${config.painPoints[0].body}
2. "${config.painPoints[1].title}" — ${config.painPoints[1].body}
3. "${config.painPoints[2].title}" — ${config.painPoints[2].body}
Closing: "${config.displayName} handles all three — automatically."

## FEATURE HIGHLIGHTS (Section 4)
Keep same 6 features. Adapt descriptions for ${config.professionTitle} context:
- "AI Client Intake" — adapt for ${config.clientTermPlural}
- "AI Phone Intake" — adapt for ${config.professionTitle}
- "Case Summary & AI Notes" → "${config.caseTerm.charAt(0).toUpperCase() + config.caseTerm.slice(1)} Summary & AI Notes"
- "Document Intelligence" — adapt document types for ${config.professionTitle}
- "AI Intelligence Brief" — adapt analysis for ${config.professionTitle}
- "Marketing Kit" — same capability, ${config.professionTitle}-specific templates

## HOW IT WORKS (Section 5)
Same 3 steps, adapted terminology. Replace "practice area" with "specialty".

## DUAL BENEFIT (Section 6)
Use these exact steps:
${config.dualBenefitSteps.map((s, i) => `Step ${i + 1} "${s.label}": For You: "${s.forYouTitle}" / "${s.forYouBody}" | For Client: "${s.forClientTitle}" / "${s.forClientBody}"`).join('\n')}

## PRICING (Section 7)
Same 3 tiers, same prices, same features. Replace profession terms only.
All "Start Free Trial" → "Join the Waitlist".

## CLOSING CTA (Section 8)
- Headline: "${config.closingHeadline}"
- Description: "${config.closingDescription}"
- CTA: "Join the Waitlist"

## CONTACT FORM
Add a simple contact section before the footer (or integrate into closing CTA):
- Fields: name, email, practice type/specialty, message
- Submit sends to sean@solosolutionsai.com (use mailto: for now)
- Brief confirmation text: "Thanks for your interest! We'll notify you when ${config.displayName} launches."
`;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

export async function run(runId: string, vertical: VerticalId): Promise<AgentRunResult> {
  const log = agentLogger('emery', runId);
  log.info({ vertical }, 'Starting copy generation...');

  const config = VERTICAL_CONFIGS[vertical];
  if (!config) {
    log.error({ vertical }, 'No marketing config found for vertical');
    return { summary: `ERROR: No marketing config for ${vertical}` };
  }

  // 1. Read reference Index.tsx from SoloLawyerAI (READ-ONLY — never write to this path)
  const SOLOLAWYER_PATH = process.env.SOLOLAWYER_REPO_PATH || 'c:/DevProjects/sololawyerai';
  const referenceIndex = readFileSync(join(SOLOLAWYER_PATH, 'src/pages/Index.tsx'), 'utf-8');
  log.info(`Read reference Index.tsx (${referenceIndex.length} chars)`);

  // 2. Build the adaptation prompt
  const systemPrompt = buildIndexPagePrompt(config);

  // 3. Call Claude to generate adapted page
  const anthropic = getAnthropicClient();
  log.info('Calling Claude for Index.tsx adaptation...');

  const response = await anthropic.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 16000,
    temperature: 0.3,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Here is the reference SoloLawyerAI Index.tsx. Adapt it for ${config.displayName} following the rules above. Output ONLY the complete TSX file.\n\n${referenceIndex}`,
      },
    ],
  });

  const outputText = response.content[0].type === 'text' ? response.content[0].text : '';

  // 4. Basic validation — check it looks like valid TSX
  if (!outputText.includes('export default Index') && !outputText.includes('export default')) {
    log.error('Output does not contain default export — likely invalid');
    return { summary: `ERROR: Claude output for ${vertical} Index.tsx appears invalid` };
  }

  // 5. Write to output directory
  const outputDir = process.env.OUTPUT_DIR || join(process.cwd(), 'output', vertical);
  const pagesDir = join(outputDir, 'src', 'pages');
  mkdirSync(pagesDir, { recursive: true });

  // Strip any markdown code fences Claude might have added despite instructions
  let cleanOutput = outputText;
  if (cleanOutput.startsWith('```')) {
    cleanOutput = cleanOutput.replace(/^```\w*\n/, '').replace(/\n```$/, '');
  }

  writeFileSync(join(pagesDir, 'Index.tsx'), cleanOutput, 'utf-8');
  log.info(`Wrote adapted Index.tsx to ${pagesDir} (${cleanOutput.length} chars)`);

  // 6. Log token usage
  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
  log.info({ tokensUsed }, 'Copy generation complete');

  return {
    summary: `Generated ${config.displayName} Index.tsx (${cleanOutput.length} chars, ${tokensUsed} tokens)`,
    tokensUsed,
  };
}
