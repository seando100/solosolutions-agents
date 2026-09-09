# Vertical Spinup Specification

## What Is a Spun-Up Vertical?

A fully populated, branded marketing site for a Solo[Profession]AI vertical. It is a **real React app** cloned from SoloLawyerAI's codebase — not a throwaway landing page. When the product goes live, the admin portal, intake engine, and integrations get activated on the same codebase.

Until then, these are **pre-launch marketing sites** with clear "Coming Soon" disclosures.

---

## What's INCLUDED (Pre-Launch)

### Marketing Pages (fully populated, profession-specific)
- **Homepage (Index.tsx)** — Hero, trust bar, pain points, features, how it works, pricing preview, closing CTA. All copy adapted for the profession.
- **Features page (Features.tsx)** — Detailed feature descriptions, same capabilities as SoloLawyerAI but rewritten for the vertical (e.g., "AI captures your client's pet history" not "AI captures your client's legal issue").
- **Pricing page (Pricing.tsx)** — Same 3-tier structure (Starter $49 / Pro $79 / Pro+ $119). Same feature breakdown. Profession-specific language.
- **Privacy Policy & Terms** — Adapted for the profession (veterinary records vs legal documents, etc.).

### Branding (unique per vertical)
- **Wordmark** — Solo[Profession]AI with profession-specific accent color:
  - SoloVetAI: Emerald #10B981
  - SoloRealtorAI: Blue #3B82F6
  - SoloAccountantAI: Purple #8B5CF6
  - SoloInsureAI: Amber #F59E0B
  - SoloTherapistAI: Pink #EC4899
- **Navy base color** — #0F2745 (shared across all verticals)
- **Tailwind config** — accent color wired throughout (buttons, badges, links, hover states)
- **Favicon + OG image** — branded for the vertical
- **Meta tags** — unique title, description, OG tags per vertical for SEO

### "Coming Soon" Disclosures
- **Badge on hero** — "Coming Q2 2026" or "Coming Q3 2026" (per timeline below)
- **CTA buttons** — Instead of "Start Free Trial" → "Get Notified at Launch" or "Join the Waitlist"
- **No sign-up flow** — Auth pages, admin portal, and intake engine are NOT accessible
- **No Stripe** — Pricing is informational only ("Start Free Trial" buttons → waitlist)
- **Timeline:**
  - Q2 2026: SoloVetAI, SoloRealtorAI
  - Q3 2026: SoloAccountantAI, SoloInsureAI, SoloTherapistAI

### Contact / Lead Capture
- **Contact page or modal** — Simple form: name, email, profession/practice type, message
- **All submissions email to:** sean@solosolutionsai.com
- **Purpose:** Capture interest from professionals who discover the site pre-launch
- **Implementation:** Resend API (same as SoloLawyerAI email stack) or simple mailto form
- **Auto-response:** Brief "Thanks for your interest, we'll notify you when [Vertical] launches"

### Footer
- Links to Privacy Policy, Terms of Service, Contact
- "A SoloSolutionsAI Product" with link to solosolutionsai.com
- Copyright: © 2026 SoloSolutionsAI

---

## What's NOT INCLUDED (Pre-Launch)

| Feature | Status | Notes |
|---------|--------|-------|
| Attorney sign-up / auth | Hidden | Auth pages exist in codebase but routes not exposed |
| Admin portal | Hidden | Component code present, not routed |
| Client intake (chat) | Hidden | Engine ready, not accessible |
| Client intake (phone/Vapi) | Not configured | Kai sets this up at go-live |
| Supabase project | Not created | Lennox provisions at go-live |
| Edge functions | Not deployed | Same codebase, deployed at go-live |
| Stripe integration | Not built | Not done for SoloLawyerAI yet either |
| WordPress plugin | Not adapted | Comes after product goes live |
| Document Intelligence | Hidden | Same code, activated at go-live |

---

## Profession-Specific Content Adaptation

The SoloLawyerAI marketing content is the reference. Every piece of copy gets adapted:

### Terminology Mapping

| SoloLawyerAI | SoloVetAI | SoloRealtorAI | SoloAccountantAI | SoloInsureAI | SoloTherapistAI |
|-------------|-----------|---------------|-------------------|-------------|-----------------|
| Attorney | Veterinarian | Realtor / Agent | Accountant / CPA | Insurance Agent | Therapist |
| Client | Pet Owner | Buyer / Seller | Client | Policyholder | Patient / Client |
| Legal issue | Pet concern / symptoms | Property needs | Financial situation | Insurance needs | What brings you in |
| Case | Appointment / Visit | Transaction | Engagement | Policy / Claim | Treatment |
| Legal matter | Animal's condition | Property search | Tax situation | Coverage needs | Mental health journey |
| Consultation | Appointment | Showing / Meeting | Consultation | Policy review | Session |
| Court dates | Follow-up appointments | Closing dates | Filing deadlines | Claim deadlines | Next session |
| Practice areas | Specialties | Property types | Service areas | Insurance lines | Specializations |
| Opposing party | N/A | Other agent | IRS / Tax authority | Claims adjuster | N/A |

### Pain Points (3 per vertical, adapted from SoloLawyerAI's "Sound Familiar?" section)

**SoloVetAI:**
1. Phone rings non-stop with worried pet owners — you can't triage what you can't hear
2. New patients arrive and you start every visit from zero
3. After-hours emergencies with no way to capture symptoms before morning

**SoloRealtorAI:**
1. Buyer inquiries pile up faster than you can qualify them
2. Every showing starts with "So, what are you looking for?" — again
3. Hot leads go cold while you're at a closing

**SoloAccountantAI:**
1. Tax season buries you in the same intake questions, client after client
2. New clients show up missing half the documents you need
3. Prospects email after hours and you don't get back to them until it's too late

**SoloInsureAI:**
1. Quote requests stack up and every one needs the same 20 questions answered
2. Applications come in incomplete — you chase the same missing info every time
3. Leads from your website sit unanswered after 5pm

**SoloTherapistAI:**
1. New patient intake forms are cold and clinical — not the first impression you want
2. You spend the first 15 minutes of every session catching up on basics
3. Potential patients reach out after hours when they're most vulnerable — and hear nothing back

### Feature Descriptions
Same 6 features as SoloLawyerAI, rewritten for each profession:
1. AI Client Intake (chat) — profession-specific examples
2. AI Phone Intake (Pro+) — profession-specific persona
3. Case Summary & AI Notes → Visit Summary / Transaction Summary / etc.
4. Document Intelligence (Pro+) — profession-specific document types
5. AI Intelligence Brief (Pro+) — profession-specific analysis
6. Marketing Kit (Pro) — same capability, profession-specific templates

---

## HARD RULE: SoloLawyerAI Is Read-Only

**No spinup agent may modify, write to, or alter any file in the SoloLawyerAI codebase (`c:\DevProjects\sololawyerai` / `seando100/sololawyerai`).** SoloLawyerAI is the source of truth and the live production product. Agents may READ it as reference material and CLONE it as a starting point for a new vertical repo, but the original is never touched.

- Rory clones a **copy** — all modifications happen in the new vertical's repo
- Emery reads SoloLawyerAI copy as reference — writes output to the vertical's repo only
- Skyler reads SoloLawyerAI schema as reference — writes output to the vertical's repo only
- If a shared improvement is identified (e.g., a bug fix that benefits all verticals), it gets flagged for human review — never auto-applied

Any agent that attempts to write to the SoloLawyerAI repo is considered a critical failure.

### Tagged Snapshot Strategy

Agents clone from a **tagged snapshot**, not from `main` (which may have in-progress work).

```
git tag template-v1    # Human tags SoloLawyerAI when stable + ready for cloning
```

**Rory's clone flow:**
1. `git clone --branch template-v1 seando100/sololawyerai solovetai`
2. `cd solovetai && rm -rf .git && git init` — strip history, fresh repo
3. All modifications happen in the new repo
4. `git remote add origin seando100/solovetai && git push`

**Tag bumping:** When SoloLawyerAI reaches a new stable milestone, human bumps the tag (`template-v2`). This is the only way improvements propagate to future verticals. Existing verticals are NOT auto-updated — that's a separate, human-approved process.

---

## Technical Requirements

### Stack (identical to SoloLawyerAI)
- Vite + React 18 + TypeScript
- Tailwind CSS + shadcn/ui components
- React Router (public marketing routes only for pre-launch)
- Vercel deployment with custom domain
- GitHub repo: `seando100/solo[profession]ai`

### SEO Requirements
- `<title>` — "Solo[Profession]AI — AI-Powered [Profession] Intake"
- `<meta name="description">` — Unique 150-char description per vertical
- Open Graph tags (og:title, og:description, og:image, og:url)
- Semantic HTML (proper heading hierarchy, sections, nav)
- Sitemap.xml (even for pre-launch — helps indexing)
- robots.txt allowing all crawlers

### Domains (already owned + DNS configured)
- solovetai.com
- solorealtorai.com
- soloaccountantai.com
- soloinsureai.com
- solotherapistai.com

---

## Quality Gates (Dakota's Smoke Test — Pre-Launch Subset)

For pre-launch sites, Dakota runs a reduced test suite:

1. ✅ Domain resolves, returns 200
2. ✅ Correct `<title>`, `<meta description>`, OG tags
3. ✅ Wordmark shows correct profession name + accent color
4. ✅ All marketing pages render without errors
5. ✅ "Coming Q2/Q3" badge visible on hero
6. ✅ CTA buttons lead to waitlist/contact — NOT sign-up
7. ✅ Contact form submits successfully to sean@solosolutionsai.com
8. ✅ Footer links work (Privacy, Terms, SoloSolutionsAI)
9. ✅ Mobile responsive (no layout breaks on 375px viewport)
10. ✅ No references to "attorney", "legal", or "SoloLawyerAI" in visible content
11. ✅ Clean console (no JS errors, no 404s)
12. ✅ Lighthouse performance score > 80

---

## Reference Material

- **SoloLawyerAI codebase:** `c:\DevProjects\sololawyerai` (the template)
- **Marketing pages:** `src/pages/Index.tsx`, `src/pages/Features.tsx`, `src/pages/Pricing.tsx`
- **Brand config:** `memory/MEMORY.md` → brand architecture section
- **Agent workforce:** `docs/solosolutions-agent-workforce.html`
- **Corporate strategy:** `docs/solosolutions-corporate-strategy.md`
