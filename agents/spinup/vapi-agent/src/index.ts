import {
  agentLogger,
  getOpsClient,
} from '@solo/shared';
import type { AgentRunResult, VerticalId } from '@solo/shared';

/**
 * ═══════════════════════════════════════════
 * KAI — Voice Systems Engineer
 * ═══════════════════════════════════════════
 *
 * "I create the Vapi voice assistant, configure the persona,
 *  set up the webhook, and provision the phone number."
 *
 * Team: Spinup
 * Trigger: Invoked after Lennox completes infrastructure setup
 *
 * Inputs:
 *   - vertical: VerticalId (e.g., 'solovet')
 *   - Vertical config (profession name, webhook URL, persona details)
 *   - Intake schema from Skyler (questions the voice assistant asks)
 *   - Safety detection rules from Skyler
 *
 * Outputs:
 *   - Vapi assistant created with:
 *     - Profession-appropriate persona (name, voice, personality)
 *     - System prompt adapted for the vertical
 *     - Intake questions from Skyler's schema
 *     - Safety detection (crisis routing, hotline numbers)
 *     - Webhook configured to vertical's edge function endpoint
 *   - Phone number provisioned and assigned to assistant
 *   - Vapi assistant ID + phone number logged to vertical config
 *   - VAPI_SERVER_SECRET set in Supabase secrets
 *
 * Flow:
 *   1. Load vertical config and intake schema
 *   2. Design voice persona via Claude (name, tone, speaking style)
 *   3. Build system prompt adapted from SoloLawyerAI's Vapi prompt
 *   4. Create Vapi assistant via API
 *   5. Configure webhook URL (vertical's vapi-webhook edge function)
 *   6. Provision phone number via Vapi
 *   7. Set VAPI_SERVER_SECRET in Supabase
 *   8. Test: make a test call, verify webhook fires, verify transcript
 *   9. Log assistant ID + phone number
 *
 * Key principles:
 *   - Voice persona must be warm, professional, and profession-appropriate
 *   - Safety detection is CRITICAL — must be adapted per profession
 *     (animal abuse for vet, self-harm for therapist, DV for lawyer, etc.)
 *   - Phone number must be US-based with a relevant area code if possible
 *   - Webhook URL must match the deployed edge function exactly
 *   - Test call is mandatory before handing off
 * ═══════════════════════════════════════════
 */
export async function run(runId: string, vertical: VerticalId): Promise<AgentRunResult> {
  const log = agentLogger('kai', runId);
  log.info({ vertical }, 'Starting voice system setup...');

  // TODO: Implement Vapi setup pipeline
  // 1. Load config + schema
  // 2. Design persona
  // 3. Build system prompt
  // 4. Create Vapi assistant
  // 5. Provision phone number
  // 6. Configure webhook
  // 7. Test call

  return { summary: `Voice system setup for ${vertical} — not yet implemented` };
}
