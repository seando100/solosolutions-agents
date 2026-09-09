// @solo/shared — shared utilities for the SoloSolutionsAI agent workforce

export { getAnthropicClient, DEFAULT_MODEL } from './anthropic.js';
export { getOpsClient, getPlatformClient, getVerticalClient } from './supabase.js';
export { logger, agentLogger } from './logger.js';
export { loadVerticalConfig, getActiveVerticals } from './config.js';
export { TEAM_ROSTER, getAgent, getTeam } from './types.js';
export { fetchNewEmails, getLabelId, sendReply, markAsRead, fetchThreadMessageIds, fetchMessageById } from './gmail.js';
export type { InboundEmail } from './gmail.js';
export type * from './types.js';
