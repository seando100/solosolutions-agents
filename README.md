# SoloSolutions Agents

The agent workforce that builds, supports and markets SoloBusinessAI. **Twenty-four agents
across four families**, coordinated by a scheduler that runs them on their own cadences
against real inboxes, a real database and real customers.

This is not a demo harness. Riley reads actual support email every two minutes.

## The four families

| Family | Count | What it owns |
|---|---|---|
| **spinup** | 6 | Standing up an entire new vertical product from a single brief |
| **support** | 7 | Triage, first-line response, technical investigation, escalation, onboarding, retention, feedback |
| **marketing** | 8 | Ads, SEO, social, content, analytics, competitor watch, review solicitation |
| **corporate** | 3 | Chief of staff, CMO, PR and comms |

## The spin-up pipeline

Six agents take a profession as a brief and hand back a deployed, tested product. Each owns
one stage and hands off to the next.

| Agent | Role | Stage |
|---|---|---|
| **Skyler** | Schema Architect | Researches the profession and designs the intake schema: questions, field types, validation rules, bilingual labels |
| **Rory** | Codebase Engineer | Clones the platform template and swaps every profession-specific element: branding, colour, copy, schema |
| **Emery** | Copy Strategist | Writes the customer-facing copy: landing page, emails, FAQ, onboarding, error messages |
| **Lennox** | Infrastructure Engineer | Creates the Supabase project, runs migrations, deploys to Vercel, configures DNS and environment |
| **Kai** | Voice Systems Engineer | Builds the voice assistant, its persona and prompt, the webhook endpoint and the phone number |
| **Dakota** | QA Engineer | Runs the smoke test end to end: verifies the deployment, creates a test account, completes an intake, checks the database, confirms the emails sent |

**A vertical is not live until Dakota's smoke test passes against the real deployment.** That
gate is the whole point. Anything can generate a codebase; the difficult part is knowing
whether what came out actually works, and refusing to claim it does until something has
proven it.

## The support tier

| Agent | Role |
|---|---|
| **Riley** | Support Triage. Reads inbound support email, classifies and routes it |
| **Clark** | Tier 1 Support. Handles everyday questions autonomously |
| **Casey** | Technical Investigator. Diagnoses issues by querying the actual system state |
| **Avery** | Escalation Coordinator. Packages what a human needs to decide |
| **Morgan** | Onboarding Coach. Watches new signups and nudges the ones who stall |
| **Sage** | Retention Specialist. Spots the warning signs before a customer leaves |
| **Quinn** | Feedback Analyst. Follows up on resolved tickets and collects ratings |

## How they are coordinated

`orchestrator/scheduler.ts` is the heartbeat. Each agent exposes a `run()` and the scheduler
fires it on its own cadence, because these jobs have genuinely different clocks:

```
  Riley   (triage)          every 2 minutes    inbound support email
  Avery   (escalation)      every 10 minutes   tickets needing a human
  Sloan   (chief of staff)  every 15 minutes   advisory board, founder inbox
  Quinn   (feedback)        hourly             follow-ups and ratings
  Digest                    daily 7am ET       full operations summary
```

`packages/shared` holds what every agent needs and nothing it does not: the Anthropic client,
Gmail and Supabase access, config, typed contracts and logging. Agents do not import each
other. An agent is a function with a schedule, a contract and a job.

## Design positions worth stating

**Named agents with real roles, not "agent_1".** Naming forces a scope. If you cannot say in
one line what Sage does that Morgan does not, the split is wrong.

**A gate at the end, not confidence at the start.** The pipeline's last agent is QA, and it
can refuse. A system that cannot say no about its own output is a generator, not a workflow.

**Different clocks for different work.** Support email at two minutes and a digest at seven in
the morning are not the same problem, and forcing them into one loop makes both worse.

**Failures stay local.** One agent failing does not stop the others, because they share a
scheduler rather than a call stack.

---

Built by [Sean Doherty](https://github.com/seando100).
