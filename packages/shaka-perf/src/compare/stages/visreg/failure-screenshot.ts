/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  findVisregSideFailure,
  type VisregSide,
} from '../../../visreg/core/side-failure';

export function findVisregFailureScreenshot(
  error: unknown,
  artifactsDir: string,
  sinceMs: number,
): string | undefined {
  const sideFailure = findVisregSideFailure(error);
  if (
    sideFailure?.screenshotPath &&
    fs.existsSync(sideFailure.screenshotPath)
  ) {
    return sideFailure.screenshotPath;
  }

  const sides: VisregSide[] = sideFailure
    ? [sideFailure.side]
    : ['experiment', 'control'];
  return newestPng(
    sides.map((side) => path.join(artifactsDir, `${side}_screenshots`)),
    sinceMs,
  );
}

function newestPng(roots: string[], sinceMs: number): string | undefined {
  let newest: { path: string; mtimeMs: number } | undefined;
  for (const root of roots) {
    walkPngs(root, (filePath, mtimeMs) => {
      if (mtimeMs < sinceMs) return;
      if (!newest || mtimeMs > newest.mtimeMs) {
        newest = { path: filePath, mtimeMs };
      }
    });
  }
  return newest?.path;
}

function walkPngs(
  root: string,
  visit: (filePath: string, mtimeMs: number) => void,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkPngs(absolutePath, visit);
    } else if (entry.isFile() && absolutePath.toLowerCase().endsWith('.png')) {
      try {
        visit(absolutePath, fs.statSync(absolutePath).mtimeMs);
      } catch {
        // Ignore files that disappear or become unreadable during the scan.
      }
    }
  }
}
