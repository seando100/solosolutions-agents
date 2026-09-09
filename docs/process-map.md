# How this workforce got its shape

Notes on the two processes this replaced, why each one was worth automating, and the specific ways
the first attempts were wrong.

## Process one: standing up a new vertical

Before the pipeline, launching a profession was a project. The same project, every time, with
different content.

Research the profession well enough to know what a practitioner needs to ask a new client. Design
the intake schema: questions, field types, validation, bilingual labels. Clone the platform and
swap every profession-specific element. Write the landing page, the emails, the FAQ, the
onboarding, the error messages. Create the database project, run the migrations, deploy,
configure DNS and environment. Build the voice assistant, its persona and prompt, its webhook,
its phone number. Then test it, end to end, as a real user would.

### Where it leaked

1. **It was pure repetition with varying content.** The sequence never changed. Only the domain
   knowledge did, which is the definition of something that should be data rather than effort.
2. **The steps have hard dependencies.** Schema before codebase, because the codebase is shaped by
   the schema. Copy before deployment. Getting the order wrong meant redoing work.
3. **Verification is last, so verification is what got skipped.** Under time pressure the step
   that gets dropped is always the one at the end, and it is the only one that establishes whether
   any of the preceding work succeeded.
4. **Each manual run drifted from the last.** Two verticals launched a month apart differed in
   ways nobody intended and nobody documented.
5. **The knowledge lived in whoever did it last.** Which is fine until they are doing something
   else.

### What that produced

Six agents, one per stage, each handing off to the next. Named rather than numbered, because
naming forces a scope: if you cannot say in a sentence what one does that another does not, the
split is wrong.

The schema agent goes first, because everything downstream is shaped by it. The QA agent goes
last, and **it can refuse**. A vertical is not live until its smoke test passes against the real
deployment: the deployment responds, a test account is created, an intake is completed, the record
lands in the database, the emails send.

That gate is the entire point. Anything can generate a codebase. The hard part is knowing whether
what came out works, and declining to claim it does until something has checked. Putting
verification last in a manual process makes it the first casualty; making it an agent with veto
makes it the thing that cannot be skipped.

## Process two: supporting the people using it

A small business owner emails for help. It arrives in an inbox. It sits there until someone looks.
Meanwhile the owner is blocked on something that is usually simple.

### Where it leaked

1. **Response time is the whole experience.** A simple question answered in two minutes and the
   same question answered next day are different products.
2. **Most questions are not hard.** They are the same handful, repeatedly, and answering them
   consumes the time needed for the ones that are hard.
3. **Diagnosis needs system state, not conversation.** Half of what looks like a support question
   is a technical question that needs someone to go and look at the data.
4. **The people who quietly stop using it never write in.** Silence is the signal, and nothing was
   watching for it.

### What that produced

A tier rather than a queue. Triage reads and routes. First-line handles the ordinary questions
autonomously. A technical investigator diagnoses by querying actual system state. An escalation
coordinator packages what a human needs in order to decide. An onboarding coach watches new
signups and nudges the ones who stall, and a retention agent watches for the silence in point 4.

## Why they are scheduled rather than orchestrated

Each agent exposes a `run()` and the scheduler fires it on its own cadence, because these jobs
genuinely have different clocks. Triage on inbound email every couple of minutes. Escalation every
ten. The chief of staff every fifteen. Feedback hourly. A full operations digest once a day.

Forcing those into a single loop makes all of them worse: either email waits for the digest's
cadence, or the digest runs every two minutes.

Agents do not import each other. They share a scheduler, a set of typed contracts and a common
Anthropic, Gmail and Supabase client, and nothing else. One failing therefore does not take the
others down, which a call stack cannot promise.

## What is deliberately not automated

- **Anything a human has to own.** Escalation exists to package a decision, not to make it.
- **The judgement about whether a vertical is worth launching.** The pipeline builds one; it does
  not decide the market is there.
- **Refunds, disputes, and anything where being wrong is expensive.** The dividing line throughout:
  automate where being fast is valuable and being wrong is cheap.

## Where the map was wrong

**The agents assumed one vertical.** Triage, first-line and technical investigation were all
written while there was a single profession, and each had assumptions about it baked in. Widening
to more professions meant removing hardcoded domain knowledge from three agents at once. The
lesson is the ordinary one: the first instance of anything is indistinguishable from the general
case until there is a second.

**The support taxonomy put setup questions in the wrong lane.** Triage classified onboarding
questions as technical, so new users asking ordinary "how do I start" questions were routed to
diagnosis rather than to coaching. A misrouted question is worse than an unanswered one, because
it arrives somewhere confident and unhelpful.

**Two components agreed on a concept and disagreed on a string.** A digest deduplicated against
one spelling of an agent's name while the records carried another, so duplicates survived a check
that looked correct. This class of bug, where a name drifts between components that were written
at different times, is invisible in code review and only surfaces by tracing a real record end to
end. It has since happened in unrelated systems, and it is now something to check for explicitly.

**The feedback agent became a nuisance.** Following up on resolved tickets is reasonable. Doing it
more than once, because nothing enforced at-most-once, is not, and it turned a courtesy into spam.
Rebuilt so a follow-up is claimed in the database before it is sent, which makes duplicate sends
structurally impossible rather than merely unlikely.
