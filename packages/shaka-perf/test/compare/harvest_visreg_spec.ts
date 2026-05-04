import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { harvestVisreg, visregCategoryDef } from '../../src/compare/harvest/visreg';
import type { HarvestContext } from '../../src/compare/category-def';
import type { Viewport } from 'shaka-shared';

const DESKTOP: Viewport = {
  label: 'desktop', width: 1280, height: 800, formFactor: 'desktop', deviceScaleFactor: 1,
};
const TABLET: Viewport = {
  label: 'tablet', width: 768, height: 1024, formFactor: 'mobile', deviceScaleFactor: 3,
};

async function withTempResultsRoot(cb: (resultsRoot: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-harvest-'));
  try {
    await cb(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writePerTestReport(
  resultsRoot: string,
  slug: string,
  viewportLabel: string,
  data: unknown,
) {
  const dir = path.join(resultsRoot, `visreg-${viewportLabel}`, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(data));
}

function writeTinyPng(absPath: string) {
  const onePxPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2pX8kAAAAASUVORK5CYII=',
    'base64',
  );
  fs.writeFileSync(absPath, onePxPng);
}

function harvestCategory(resultsRoot: string, slug: string, viewports: Viewport[]) {
  const ctx = { slug, viewports, resultsRoot } as unknown as HarvestContext;
  return visregCategoryDef.harvest(ctx);
}

describe('harvestVisreg', function () {
  it('marks a viewport as changed when the engine wrote a diff image, even if misMatch% is 0', async function () {
    // Dimension-only fail: the engine writes a `failed_diff_*.png` because
    // requireSameDimensions was violated, but the pixel-level
    // misMatchPercentage is still 0. The per-row chip in VisregSlot keys off
    // `diffImage !== null`, so the test-level `visual_change` status must
    // agree — otherwise the chip shows on a row whose test pill says "no
    // diff" (the inversion users reported).
    await withTempResultsRoot(async (resultsRoot) => {
      writePerTestReport(resultsRoot, 'homepage', 'desktop', {
        testSuite: 'visreg',
        tests: [{
          pair: {
            label: 'Homepage',
            viewportLabel: 'desktop',
            selector: 'document',
            misMatchThreshold: 0.01,
            diff: { misMatchPercentage: '0.00', isSameDimensions: false },
            diffImage: 'failed_diff_homepage_desktop.png',
          },
          status: 'fail',
        }],
      });
      writeTinyPng(
        path.join(
          resultsRoot,
          'visreg-desktop',
          'homepage',
          'failed_diff_homepage_desktop.png',
        ),
      );

      const harvested = await harvestVisreg({ resultsRoot, slug: 'homepage', viewport: DESKTOP });
      assert.ok(harvested);
      assert.strictEqual(harvested!.hasChange, true);
      assert.strictEqual(harvested!.artifacts[0].diffImage !== null, true);

      const result = await harvestCategory(resultsRoot, 'homepage', [DESKTOP]);
      assert.ok(result);
      assert.strictEqual(result!.status, 'visual_change');
    });
  });

  it('marks a category as no_difference when neither a diff image nor an error is present', async function () {
    await withTempResultsRoot(async (resultsRoot) => {
      writePerTestReport(resultsRoot, 'homepage', 'desktop', {
        testSuite: 'visreg',
        tests: [{
          pair: {
            label: 'Homepage',
            viewportLabel: 'desktop',
            selector: 'document',
            misMatchThreshold: 0.01,
            diff: { misMatchPercentage: '0.00', isSameDimensions: true },
          },
          status: 'pass',
        }],
      });

      const harvested = await harvestVisreg({ resultsRoot, slug: 'homepage', viewport: DESKTOP });
      assert.ok(harvested);
      assert.strictEqual(harvested!.hasChange, false);
      assert.strictEqual(harvested!.engineError, null);
      assert.strictEqual(harvested!.artifacts[0].diffImage, null);

      const result = await harvestCategory(resultsRoot, 'homepage', [DESKTOP]);
      assert.ok(result);
      assert.strictEqual(result!.status, 'no_difference');
      assert.strictEqual(result!.error, undefined);
    });
  });

  it('surfaces the unified engineError via category.error (not as visual_change) when no diff image was written', async function () {
    // Regression test for the "VISUAL CHANGE pill but every row shows NO DIFF"
    // screenshot. Pair-level errors used to bubble into `changed`, so the
    // test-level status jumped to `visual_change` on a pair with no diffImage —
    // the UI then showed an orange VISUAL CHANGE pill above rows that all
    // rendered as NoDiffCards with green NO DIFF badges. Per-pair errors are
    // now folded into the unified top-level `engineError` payload by the
    // engine writer, harvested into `engineError`, and surfaced via
    // `CategoryResult.error` (error banner + error pill) instead.
    await withTempResultsRoot(async (resultsRoot) => {
      writePerTestReport(resultsRoot, 'homepage', 'desktop', {
        testSuite: 'visreg',
        engineError: 'browser crashed',
        engineOutput: '── document ──\nbrowser crashed',
        tests: [{
          pair: {
            label: 'Homepage',
            viewportLabel: 'desktop',
            selector: 'document',
            misMatchThreshold: 0.01,
            diff: { misMatchPercentage: '0.00', isSameDimensions: true },
          },
          status: 'fail',
        }],
      });

      const harvested = await harvestVisreg({ resultsRoot, slug: 'homepage', viewport: DESKTOP });
      assert.ok(harvested);
      assert.strictEqual(harvested!.hasChange, false);
      assert.strictEqual(harvested!.engineError, 'browser crashed');

      const result = await harvestCategory(resultsRoot, 'homepage', [DESKTOP]);
      assert.ok(result);
      assert.strictEqual(result!.status, 'no_difference');
      assert.ok(result!.error, 'pair error is surfaced via category.error');
      assert.match(result!.error!, /browser crashed/);
      assert.match(result!.error!, /desktop/);
    });
  });

  it('aggregates engineErrors across viewports into one category.error summary', async function () {
    await withTempResultsRoot(async (resultsRoot) => {
      writePerTestReport(resultsRoot, 'homepage', 'desktop', {
        testSuite: 'visreg',
        engineError: 'selector not found',
        engineOutput: '── document ──\nselector not found',
        tests: [{
          pair: {
            label: 'Homepage',
            viewportLabel: 'desktop',
            selector: 'document',
            misMatchThreshold: 0.01,
            diff: { misMatchPercentage: '0.00', isSameDimensions: true },
          },
          status: 'fail',
        }],
      });
      writePerTestReport(resultsRoot, 'homepage', 'tablet', {
        testSuite: 'visreg',
        engineError: 'reference file missing',
        engineOutput: '── document ──\nreference file missing',
        tests: [{
          pair: {
            label: 'Homepage',
            viewportLabel: 'tablet',
            selector: 'document',
            misMatchThreshold: 0.01,
            diff: { misMatchPercentage: '0.00', isSameDimensions: true },
          },
          status: 'fail',
        }],
      });

      const result = await harvestCategory(resultsRoot, 'homepage', [DESKTOP, TABLET]);
      assert.ok(result);
      assert.ok(result!.error);
      assert.match(result!.error!, /2 viewport\(s\) errored/);
      assert.match(result!.error!, /selector not found/);
      assert.match(result!.error!, /reference file missing/);
    });
  });
});
