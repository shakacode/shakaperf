/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PlaywrightOptions } from '../../../config';

export interface AgentReadinessStageConfig {
  /**
   * File-level default for whether agent-readiness runs at all. Off by default —
   * it's an opt-in AI-legibility scan. A per-test `config.agentReadiness.enabled`
   * overrides this in the stage's `applies`.
   */
  enabled: boolean;
  /**
   * Effective launch options for this stage — `resolvePlaywrightOptions(config,
   * 'audit')`, handed in by the pipeline builder. Passed through to
   * `launchStageBrowser` whole, so extra launch keys behave the same as on
   * every other stage. Agent-readiness is fully file-level: it models an
   * anonymous crawler and runs no per-test hook or test body, so there is
   * nothing to re-resolve per-test.
   */
  playwrightOptions: PlaywrightOptions;
}

// The launch + timeout bundle the engine threads through its scans. Launch
// options come from the resolved `shared.playwrightOptions`; the navigation
// cap is its `waitTimeout` (the one wait cap every Playwright engine respects); only the
// raw-fetch cap is stage-internal (it is an HTTP fetch, not a browser wait).
export interface AgentReadinessEngineOptions {
  playwrightOptions: PlaywrightOptions;
  // Per-navigation cap for goto / setContent — `playwrightOptions.waitTimeout`.
  navTimeoutMs: number;
  // Cap for the raw (no-JS) fetch of the server HTML.
  rawFetchTimeoutMs: number;
}

const RAW_FETCH_TIMEOUT_MS = 15_000;

export function resolveAgentReadinessConfig(
  config: AgentReadinessStageConfig,
): { engineOptions: AgentReadinessEngineOptions } {
  return {
    engineOptions: {
      playwrightOptions: config.playwrightOptions,
      navTimeoutMs: config.playwrightOptions.waitTimeout,
      rawFetchTimeoutMs: RAW_FETCH_TIMEOUT_MS,
    },
  };
}
