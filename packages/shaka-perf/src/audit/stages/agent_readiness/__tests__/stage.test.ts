/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { DESKTOP_VIEWPORT, type AbTestDefinition } from 'shaka-shared';
import { AgentReadinessStage } from '../stage';
import type { AgentReadinessStageConfig } from '../config';

const stageConfig = (enabled: boolean): AgentReadinessStageConfig => ({
  enabled,
  playwrightOptions: { browser: 'chromium', waitTimeout: 60_000 },
});

// Only `config.agentReadiness.enabled` is read by applies(); the rest of the
// definition is irrelevant, so a minimal cast keeps the test focused.
const testWith = (perTestEnabled: boolean | undefined): AbTestDefinition =>
  ({
    config: perTestEnabled === undefined
      ? undefined
      : { agentReadiness: { enabled: perTestEnabled } },
  }) as unknown as AbTestDefinition;

const applies = (fileEnabled: boolean, perTestEnabled: boolean | undefined): boolean =>
  new AgentReadinessStage(stageConfig(fileEnabled))
    .applies(testWith(perTestEnabled), DESKTOP_VIEWPORT);

describe('AgentReadinessStage.applies', () => {
  it('is off when neither the file nor the test enables it (opt-in default)', () => {
    expect(applies(false, undefined)).toBe(false);
  });

  it('runs when a per-test override enables it over a disabled file default', () => {
    expect(applies(false, true)).toBe(true);
  });

  it('a per-test override wins even when the file enabled it globally', () => {
    expect(applies(true, false)).toBe(false);
  });

  it('falls back to the file-level enable when the test does not override', () => {
    expect(applies(true, undefined)).toBe(true);
  });
});
