import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

/**
 * Shared Anthropic client — singleton so all agents reuse one instance.
 * Reads ANTHROPIC_API_KEY from environment.
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/** Default model for all agents. Upgrade individual agents only if quality issues emerge. */
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
