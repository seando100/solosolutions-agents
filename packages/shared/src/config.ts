import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { VerticalConfig, VerticalId } from './types.js';

const configs = new Map<string, VerticalConfig>();

/**
 * Load a vertical's config from configs/{vertical}.yaml.
 * Resolves ${ENV_VAR} placeholders from process.env.
 */
export function loadVerticalConfig(vertical: VerticalId): VerticalConfig {
  if (configs.has(vertical)) {
    return configs.get(vertical)!;
  }

  const configPath = join(process.cwd(), 'configs', `${vertical}.yaml`);
  const raw = readFileSync(configPath, 'utf-8');

  // Resolve ${ENV_VAR} placeholders
  const resolved = raw.replace(/\$\{(\w+)\}/g, (_, envVar) => {
    const value = process.env[envVar];
    if (!value) {
      throw new Error(`Missing env var ${envVar} referenced in ${configPath}`);
    }
    return value;
  });

  const config = parse(resolved) as VerticalConfig;
  configs.set(vertical, config);
  return config;
}

/**
 * Get all configured verticals by scanning the configs/ directory.
 */
export function getActiveVerticals(): VerticalId[] {
  // For now, return the verticals we know about.
  // Later this can scan the configs/ directory dynamically.
  const all: VerticalId[] = ['sololawyer', 'solovet', 'solorealtor', 'solotherapist', 'soloaccountant'];
  return all.filter(v => {
    try {
      loadVerticalConfig(v);
      return true;
    } catch {
      return false;
    }
  });
}
