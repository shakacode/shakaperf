import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { harvestVisreg } from '../../src/compare/harvest/visreg';

function writeReport(dir: string, data: unknown) {
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(data));
}

function withTempReportDir(cb: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-harvest-'));
  try {
    cb(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('harvestVisreg', function () {
  it('marks a pair as visual_change when the engine wrote a diff image, even if misMatch% is 0', function () {
    // Dimension-only fail: resemble writes a `failed_diff_*.png` because
    // requireSameDimensions was violated, but the pixel-level
    // misMatchPercentage is still 0. The per-row chip in VisregSlot keys off
    // `diffImage !== null`, so the test-level `visual_change` status must
    // agree — otherwise the chip shows on a row whose test pill says "no
    // diff" (the inversion users reported).
    withTempReportDir((dir) => {
      writeReport(dir, {
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
      const out = harvestVisreg(dir);
      const result = out.get('Homepage');
      assert.ok(result, 'Homepage result present');
      assert.strictEqual(result!.status, 'visual_change');
      assert.strictEqual(result!.visreg![0].diffImage !== null, true);
    });
  });

  it('marks a pair as no_difference when neither a diff image nor an error is present', function () {
    withTempReportDir((dir) => {
      writeReport(dir, {
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
      const out = harvestVisreg(dir);
      const result = out.get('Homepage');
      assert.ok(result);
      assert.strictEqual(result!.status, 'no_difference');
      assert.strictEqual(result!.visreg![0].diffImage, null);
    });
  });

  it('surfaces pair-level engine errors via category.error (not as visual_change) when no diff image was written', function () {
    // Regression test for the "VISUAL CHANGE pill but every row shows NO DIFF"
    // screenshot. A pair that errored (selector not found, reference missing,
    // engine crash on one viewport) used to bubble `hasError` into the
    // `changed` predicate, so the test-level status jumped to `visual_change`
    // even though the pair has no diffImage — the UI then showed an orange
    // VISUAL CHANGE pill sitting above rows that all render as NoDiffCards
    // with green NO DIFF badges. The error itself is now surfaced via
    // `category.error` (error banner + error pill) instead.
    withTempReportDir((dir) => {
      writeReport(dir, {
        testSuite: 'visreg',
        tests: [
          {
            pair: {
              label: 'Homepage',
              viewportLabel: 'desktop',
              selector: 'document',
              misMatchThreshold: 0.01,
              diff: { misMatchPercentage: '0.00', isSameDimensions: true },
              engineErrorMsg: 'browser crashed',
            },
            status: 'fail',
          },
          {
            pair: {
              label: 'Homepage',
              viewportLabel: 'tablet',
              selector: 'document',
              misMatchThreshold: 0.01,
              diff: { misMatchPercentage: '0.00', isSameDimensions: true },
            },
            status: 'pass',
          },
        ],
      });
      const out = harvestVisreg(dir);
      const result = out.get('Homepage');
      assert.ok(result);
      assert.strictEqual(result!.status, 'no_difference');
      assert.ok(result!.error, 'pair error is surfaced via category.error');
      assert.match(result!.error!, /browser crashed/);
      assert.match(result!.error!, /desktop/);
    });
  });

  it('aggregates multiple pair errors into one category.error summary', function () {
    withTempReportDir((dir) => {
      writeReport(dir, {
        testSuite: 'visreg',
        tests: [
          {
            pair: {
              label: 'Homepage',
              viewportLabel: 'desktop',
              selector: 'document',
              misMatchThreshold: 0.01,
              diff: { misMatchPercentage: '0.00', isSameDimensions: true },
              engineErrorMsg: 'selector not found',
            },
            status: 'fail',
          },
          {
            pair: {
              label: 'Homepage',
              viewportLabel: 'tablet',
              selector: 'document',
              misMatchThreshold: 0.01,
              diff: { misMatchPercentage: '0.00', isSameDimensions: true },
              error: 'reference file missing',
            },
            status: 'fail',
          },
        ],
      });
      const out = harvestVisreg(dir);
      const result = out.get('Homepage');
      assert.ok(result);
      assert.ok(result!.error);
      assert.match(result!.error!, /2 pair\(s\) errored/);
      assert.match(result!.error!, /selector not found/);
      assert.match(result!.error!, /reference file missing/);
    });
  });
});
