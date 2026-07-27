/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Viewport } from 'shaka-shared';
import { ArtifactScope } from '../../src/pipeline/artifact-store';
import { readVisregArtifacts } from '../../src/compare/stages/visreg/artifacts';
import { hasVisualChange, visualChangeCount } from '../../src/compare/stages/visreg/selectors';

const DESKTOP: Viewport = {
  label: 'desktop',
  width: 1280,
  height: 800,
  formFactor: 'desktop',
  deviceScaleFactor: 1,
};

async function withTempResultsRoot(cb: (resultsRoot: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-visreg-artifacts-'));
  try {
    await cb(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writePerTestReport(
  resultsRoot: string,
  slug: string,
  data: unknown,
) {
  const dir = path.join(resultsRoot, slug, 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(data));
}

describe('readVisregArtifacts', function () {
  it('marks a visual change when the engine wrote a diff image, even if misMatch% is 0', async function () {
    await withTempResultsRoot(async (resultsRoot) => {
      writePerTestReport(resultsRoot, 'homepage__desktop', {
        testSuite: 'visreg',
        tests: [{
          pair: {
            label: 'Homepage',
            viewportLabel: 'desktop',
            selector: 'document',
            mismatchThreshold: 0.01,
            diff: { misMatchPercentage: '0.00', isSameDimensions: false },
            diffImage: 'failed_diff_homepage_desktop.txt',
          },
          status: 'fail',
        }],
      });
      fs.writeFileSync(
        path.join(resultsRoot, 'homepage__desktop', 'artifacts', 'failed_diff_homepage_desktop.txt'),
        'dimension-only diff marker',
      );

      const artifactsDir = path.join(resultsRoot, 'homepage__desktop', 'artifacts');
      const artifactSet = await readVisregArtifacts({
        artifacts: new ArtifactScope(artifactsDir, resultsRoot),
        viewport: DESKTOP,
      });

      assert.ok(artifactSet);
      assert.strictEqual(
        artifactSet.artifacts[0].diffImage,
        'homepage__desktop/artifacts/failed_diff_homepage_desktop.txt',
      );
      assert.strictEqual(hasVisualChange(artifactSet.artifacts), true);
      assert.strictEqual(visualChangeCount(artifactSet.artifacts), 1);
    });
  });

  it('marks no visual change when neither a diff image nor a pixelmatch diff is present', async function () {
    await withTempResultsRoot(async (resultsRoot) => {
      writePerTestReport(resultsRoot, 'homepage__desktop', {
        testSuite: 'visreg',
        tests: [{
          pair: {
            label: 'Homepage',
            viewportLabel: 'desktop',
            selector: 'document',
            mismatchThreshold: 0.01,
            diff: { misMatchPercentage: '0.00', isSameDimensions: true },
          },
          status: 'pass',
        }],
      });

      const artifactsDir = path.join(resultsRoot, 'homepage__desktop', 'artifacts');
      const artifactSet = await readVisregArtifacts({
        artifacts: new ArtifactScope(artifactsDir, resultsRoot),
        viewport: DESKTOP,
      });

      assert.ok(artifactSet);
      assert.strictEqual(artifactSet.artifacts[0].diffImage, null);
      assert.strictEqual(hasVisualChange(artifactSet.artifacts), false);
      assert.strictEqual(visualChangeCount(artifactSet.artifacts), 0);
    });
  });
});
