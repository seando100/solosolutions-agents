import pino from 'pino';
import type { AgentName } from './types.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger for a specific agent.
 * Every log line includes the agent name and run ID for traceability.
 *
 * Usage:
 *   const log = agentLogger('riley', runId);
 *   log.info({ emailCount: 3 }, 'Processing new emails');
 */
export function agentLogger(agent: AgentName, runId: string) {
  return logger.child({ agent, runId });
}
