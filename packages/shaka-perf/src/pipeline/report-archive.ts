/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { FULL_REPORT_FILENAME, SELF_CONTAINED_REPORT_FILENAME } from './report';

/** Name of the bundle written into the results root. */
export const FULL_REPORT_ZIP_FILENAME = 'full-report.zip';

/**
 * Files in the results root that should NOT go into the bundle:
 *  - the zip itself (don't recurse into our own output);
 *  - the self-contained report — it inlines every artifact as base64, so it's
 *    both redundant inside the bundle and would roughly double its size. The
 *    bundle is the *other* way to ship the full report: `full-report.html` plus
 *    the artifact directories it references via relative paths.
 *  - persisted per-shard engine errors — internal `--report-only` assembly
 *    plumbing, not part of a viewable report.
 */
const IGNORE_GLOBS = [
  FULL_REPORT_ZIP_FILENAME,
  SELF_CONTAINED_REPORT_FILENAME,
  '.shaka-engine-errors-*.json',
];

export interface FullReportArchiveResult {
  zipPath: string;
  bytes: number;
}

/**
 * Bundle `full-report.html` and the artifact directories it references into
 * `<resultsRoot>/full-report.zip`, preserving the relative layout so the report
 * opens correctly once extracted. Returns the zip path and its size on success.
 *
 * Requires `full-report.html` to exist (i.e. a real run that wrote a report, not
 * `--skip-report`); throws otherwise so the caller can decide whether to surface
 * it. Any stale zip from a previous run is overwritten.
 */
export async function writeFullReportArchive(
  resultsRoot: string,
): Promise<FullReportArchiveResult> {
  const fullReportPath = path.join(resultsRoot, FULL_REPORT_FILENAME);
  if (!fs.existsSync(fullReportPath)) {
    throw new Error(`cannot archive: ${fullReportPath} does not exist`);
  }

  const zipPath = path.join(resultsRoot, FULL_REPORT_ZIP_FILENAME);
  // Remove any stale zip so it can't accidentally be re-archived into itself
  // and so a failed write doesn't leave a half-written bundle behind.
  fs.rmSync(zipPath, { force: true });

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    // `warning` fires for non-fatal issues (e.g. a file vanishing mid-archive);
    // treat it as fatal here so we never hand back a silently-incomplete bundle.
    archive.on('warning', reject);
    archive.on('error', reject);
  });

  archive.pipe(output);
  // Pack the whole results root (artifacts + full-report.html) at the archive
  // root, minus the ignored files, so relative paths inside the report resolve.
  archive.glob('**/*', { cwd: resultsRoot, dot: true, ignore: IGNORE_GLOBS });
  await archive.finalize();
  await done;

  return { zipPath, bytes: fs.statSync(zipPath).size };
}
