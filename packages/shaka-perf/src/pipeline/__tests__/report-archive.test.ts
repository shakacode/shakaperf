/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { writeFullReportArchive, FULL_REPORT_ZIP_FILENAME } from '../report-archive';
import { FULL_REPORT_FILENAME, SELF_CONTAINED_REPORT_FILENAME } from '../report';

// A zip stores each entry's *name* uncompressed (only the file body is
// deflated), so the entry names show up verbatim in the raw archive bytes.
// Reading them as latin1 lets us assert what was/wasn't included without
// pulling in an unzip dependency.
function entryNames(zipPath: string): string {
  return fs.readFileSync(zipPath).toString('latin1');
}

describe('writeFullReportArchive', () => {
  let resultsRoot: string;

  beforeEach(() => {
    resultsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-report-archive-'));
  });

  afterEach(() => {
    fs.rmSync(resultsRoot, { recursive: true, force: true });
  });

  function seedResultsRoot(): void {
    fs.writeFileSync(path.join(resultsRoot, FULL_REPORT_FILENAME), '<html>full</html>');
    fs.writeFileSync(path.join(resultsRoot, SELF_CONTAINED_REPORT_FILENAME), '<html>standalone</html>');
    fs.writeFileSync(path.join(resultsRoot, 'report.json'), '{"ok":true}');
    fs.writeFileSync(path.join(resultsRoot, '.shaka-engine-errors-abc.json'), '[]');
    const artifactDir = path.join(resultsRoot, 'home-desktop', 'artifacts');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, 'diff.png'), 'PNGDATA');
  }

  it('bundles the full report and its artifacts, excluding the standalone report and internals', async () => {
    seedResultsRoot();

    const { zipPath, bytes } = await writeFullReportArchive(resultsRoot);

    expect(zipPath).toBe(path.join(resultsRoot, FULL_REPORT_ZIP_FILENAME));
    expect(bytes).toBeGreaterThan(0);
    expect(fs.existsSync(zipPath)).toBe(true);

    const names = entryNames(zipPath);
    // Included: the full report, its artifacts (relative path preserved), and report.json.
    expect(names).toContain(FULL_REPORT_FILENAME);
    expect(names).toContain(path.join('home-desktop', 'artifacts', 'diff.png'));
    expect(names).toContain('report.json');
    // Excluded: the self-contained variant, persisted shard errors, and the zip itself.
    expect(names).not.toContain(SELF_CONTAINED_REPORT_FILENAME);
    expect(names).not.toContain('.shaka-engine-errors-abc.json');
    expect(names).not.toContain(FULL_REPORT_ZIP_FILENAME);
  });

  it('overwrites a stale zip from a previous run', async () => {
    seedResultsRoot();
    const zipPath = path.join(resultsRoot, FULL_REPORT_ZIP_FILENAME);
    fs.writeFileSync(zipPath, 'stale-not-a-zip');

    const { bytes } = await writeFullReportArchive(resultsRoot);

    expect(bytes).toBeGreaterThan(0);
    // A real zip starts with the local-file-header magic "PK\x03\x04".
    expect(fs.readFileSync(zipPath).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('throws when no full report exists (e.g. --skip-report)', async () => {
    // Only artifacts on disk, no full-report.html.
    fs.writeFileSync(path.join(resultsRoot, 'report.json'), '{}');

    await expect(writeFullReportArchive(resultsRoot)).rejects.toThrow(/does not exist/);
  });
});
