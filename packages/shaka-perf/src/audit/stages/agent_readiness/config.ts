/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Config for the agent-readiness stage. Kept self-contained (not part of the
// Zod abtests.config schema) so the stage can ship without touching the shared
// config surface; the audit pipeline passes overrides through if it ever needs to.
export interface AgentReadinessEngineOptions {
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  args?: string[];
  // Per-navigation cap for goto / setContent. Defaults below.
  navTimeoutMs?: number;
  // Cap for the raw (no-JS) fetch of the server HTML.
  rawFetchTimeoutMs?: number;
}

export interface AgentReadinessStageConfig {
  skip?: boolean;
  engineOptions?: AgentReadinessEngineOptions;
}

export const DEFAULT_AGENT_READINESS_STAGE_CONFIG: Required<Omit<AgentReadinessStageConfig, 'skip'>> & { skip: boolean } = {
  skip: false,
  engineOptions: {
    browser: 'chromium',
    headless: true,
    args: ['--no-sandbox'],
    navTimeoutMs: 45_000,
    rawFetchTimeoutMs: 15_000,
  },
};

export function resolveAgentReadinessConfig(
  config: AgentReadinessStageConfig | undefined,
): Required<Omit<AgentReadinessStageConfig, 'skip'>> & { skip: boolean } {
  return {
    skip: config?.skip ?? DEFAULT_AGENT_READINESS_STAGE_CONFIG.skip,
    engineOptions: {
      ...DEFAULT_AGENT_READINESS_STAGE_CONFIG.engineOptions,
      ...config?.engineOptions,
    },
  };
}
