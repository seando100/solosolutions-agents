import { v4 as uuid } from 'uuid';
import { agentLogger, getAgent, getOpsClient } from '@solo/shared';
import type { AgentName, AgentRunResult, RunTrigger, RunStatus } from '@solo/shared';

/**
 * Runs an agent with full lifecycle logging.
 * Every run is recorded in the agent_runs table for audit and the morning digest.
 *
 * Flow:
 *   1. Log start to agent_runs (status: 'running')
 *   2. Import and execute the agent's run() function
 *   3. Update agent_runs with result (status: 'success' or 'error')
 */
export async function runAgent(agentName: AgentName, trigger: RunTrigger) {
  const runId = uuid();
  const profile = getAgent(agentName);
  const log = agentLogger(agentName, runId);

  log.info(`${profile.display_name} (${profile.title}) starting — triggered by ${trigger}`);

  const startedAt = new Date().toISOString();
  let status: RunStatus = 'running';

  // Log the start of the run
  try {
    const ops = getOpsClient();
    await ops.from('agent_runs').insert({
      id: runId,
      agent_name: agentName,
      trigger,
      started_at: startedAt,
      status,
    });
  } catch (err) {
    // Don't fail the agent run if logging fails
    log.warn({ err }, 'Failed to log agent run start to database');
  }

  try {
    // Dynamically import the agent's run function
    const agentModule = await importAgent(agentName);
    const result = await agentModule.run(runId);

    status = 'success';
    log.info({ result: result?.summary }, `${profile.display_name} completed successfully`);

    // Update the run record
    try {
      const ops = getOpsClient();
      await ops.from('agent_runs').update({
        status,
        completed_at: new Date().toISOString(),
        output_summary: result?.summary || null,
        tokens_used: result?.tokensUsed || null,
      }).eq('id', runId);
    } catch (err) {
      log.warn({ err }, 'Failed to update agent run record');
    }
  } catch (err) {
    status = 'error';
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err }, `${profile.display_name} failed: ${errorMessage}`);

    // Update the run record with error
    try {
      const ops = getOpsClient();
      await ops.from('agent_runs').update({
        status,
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      }).eq('id', runId);
    } catch (logErr) {
      log.warn({ err: logErr }, 'Failed to update agent run error record');
    }
  }
}

/**
 * Dynamically imports an agent module based on its name.
 * Maps agent names to their directory paths.
 */
async function importAgent(name: AgentName): Promise<{ run: (runId: string) => Promise<AgentRunResult | undefined> }> {
  const agentPaths: Record<string, string> = {
    // Support Team
    riley:   '../../agents/support/triage/src/index.js',
    clark:   '../../agents/support/tier1-responder/src/index.js',
    jordan:  '../../agents/support/tier1-responder/src/index.js',  // Legacy alias
    casey:   '../../agents/support/bug-detective/src/index.js',
    morgan:  '../../agents/support/onboarding-coach/src/index.js',
    sage:    '../../agents/support/churn-prevention/src/index.js',
    quinn:   '../../agents/support/feedback-collector/src/index.js',
    avery:   '../../agents/support/escalation/src/index.js',
    // Marketing Team
    harper:  '../../agents/marketing/content-writer/src/index.js',
    ellis:   '../../agents/marketing/social-media/src/index.js',
    reese:   '../../agents/marketing/ad-creative/src/index.js',
    blake:   '../../agents/marketing/ad-manager/src/index.js',
    rowan:   '../../agents/marketing/seo/src/index.js',
    finley:  '../../agents/marketing/review-solicitor/src/index.js',
    cameron: '../../agents/marketing/analytics/src/index.js',
    drew:    '../../agents/marketing/competitor-watch/src/index.js',
    // Corporate Team
    sloan:   '../../agents/corporate/chief-of-staff/src/index.js',
    // Spinup Team
    skyler:  '../../agents/spinup/schema-architect/src/index.js',
    emery:   '../../agents/spinup/copy-agent/src/index.js',
    rory:    '../../agents/spinup/codebase-cloner/src/index.js',
    lennox:  '../../agents/spinup/infra-agent/src/index.js',
    kai:     '../../agents/spinup/vapi-agent/src/index.js',
    dakota:  '../../agents/spinup/qa-agent/src/index.js',
  };

  const path = agentPaths[name];
  if (!path) throw new Error(`No module path configured for agent: ${name}`);

  return import(path);
}
