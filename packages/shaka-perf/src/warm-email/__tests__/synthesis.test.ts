/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { synthesizeSite } from '../synthesis';
import type { AgentReadinessResult, PageSignals } from '../../audit/stages/agent_readiness/types';

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    title: 'Title',
    titlePresent: true,
    metaDescription: 'Description',
    metaDescriptionPresent: true,
    canonical: true,
    lang: 'en',
    robotsMeta: '',
    og: { title: true, description: true, image: true, type: true, siteName: true },
    twitterCard: true,
    structuredData: { blocks: 1, valid: 1, invalid: 0, types: ['organization'], microdataItems: 0 },
    headings: { h1Count: 1, total: 2, orderOk: true },
    landmarks: { main: true, nav: true, header: true, footer: true, article: false },
    links: { total: 2, nondescriptive: 0 },
    images: { total: 1, withAlt: 1 },
    textChars: 500,
    textWords: 80,
    ...overrides,
  };
}

function agentReadinessResult(): AgentReadinessResult {
  const rendered = signals();
  return {
    url: 'https://example.com/',
    viewportLabel: 'phone',
    viewport: { label: 'phone', width: 390, height: 844, formFactor: 'mobile', deviceScaleFactor: 3 },
    fetchedAt: '2026-07-01T00:00:00.000Z',
    raw: { ok: true, status: 200, likelyBlocked: false, signals: signals() },
    rendered,
  };
}

describe('synthesizeSite', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-synthesis-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mirrors optional machine report meta and accepts old PageSignals without textSample', () => {
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({
      meta: {
        experimentUrl: 'https://example.com',
        generatedAt: '2026-07-01T00:00:00.000Z',
        throttleProfile: 'Slow-4G',
        viewport: { width: 390, height: 844 },
      },
      tests: [{ id: 'home-phone', name: 'Home', startingPath: '/', viewport: { label: 'phone' } }],
    }));
    fs.mkdirSync(path.join(dir, 'home-phone'));
    fs.writeFileSync(path.join(dir, 'home-phone', 'agent-readiness.json'), JSON.stringify({
      kind: 'ok',
      stage: 'agent-readiness',
      measurement: agentReadinessResult(),
    }));

    const scorecard = synthesizeSite(dir);

    expect(scorecard.throttleProfile).toBe('Slow-4G');
    expect(scorecard.viewport).toEqual({ width: 390, height: 844 });
    expect(scorecard.pages[0]?.agentReady?.rendered.textSample).toBeUndefined();
  });
});
