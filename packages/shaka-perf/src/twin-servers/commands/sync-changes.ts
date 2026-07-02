/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedConfig } from '../types';
import { getChangedFiles, getGitRootDirectory } from '../helpers/git';
import { printBanner, printSuccess, printError, printWarning, printInfo } from '../helpers/ui';
import { dockerBuildDirForSide } from '../helpers/project-paths';

export interface SyncChangesOptions {
  verbose?: boolean;
}

export type SyncTarget = 'control' | 'experiment';

/**
 * Syncs git-changed files to the specified volume directory.
 *
 * Usage:
 *   shaka-perf servers sync-changes experiment
 *   shaka-perf servers sync-changes control
 */
export async function syncChanges(
  config: ResolvedConfig,
  target: SyncTarget,
  options: SyncChangesOptions = {}
): Promise<void> {
  const { verbose } = options;

  printBanner(`Syncing Changes to ${target}`);

  // Get target volume path from config
  const targetDir = target === 'control'
    ? config.volumes.control
    : config.volumes.experiment;

  // Get git root to ensure file paths are correct
  const sideBuildDir = dockerBuildDirForSide(config, target);
  const gitRoot = getGitRootDirectory(sideBuildDir);
  const sourceDir = gitRoot || sideBuildDir;

  if (verbose) {
    console.log(`Target directory: ${targetDir}`);
    console.log(`Source directory: ${sourceDir}`);
  }

  // Ensure target directory exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`Created target directory: ${targetDir}`);
  }

  // Get git changed files from the source repo
  const changedFiles = getChangedFiles(sourceDir);

  if (changedFiles.length === 0) {
    printInfo('No git changes to sync');
    return;
  }

  console.log(`Found ${changedFiles.length} changed files`);
  console.log('');

  let copiedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const relativeFilePath of changedFiles) {
    const sourcePath = path.join(sourceDir, relativeFilePath);
    const destPath = path.join(targetDir, relativeFilePath);

    // Skip if source file doesn't exist (deleted file)
    if (!fs.existsSync(sourcePath)) {
      if (verbose) {
        console.log(`  Skipped (deleted): ${relativeFilePath}`);
      }
      skippedCount++;
      continue;
    }

    try {
      // Ensure destination directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Copy the file
      fs.copyFileSync(sourcePath, destPath);

      if (verbose) {
        console.log(`  Copied: ${relativeFilePath}`);
      }
      copiedCount++;
    } catch (error) {
      printError(`Failed to copy ${relativeFilePath}: ${(error as Error).message}`);
      errorCount++;
    }
  }

  console.log('');
  console.log(`Summary:`);
  console.log(`  Copied: ${copiedCount} files`);
  if (skippedCount > 0) {
    console.log(`  Skipped (deleted): ${skippedCount} files`);
  }
  if (errorCount > 0) {
    printWarning(`Errors: ${errorCount} files`);
  }
  console.log('');

  if (errorCount === 0) {
    printSuccess(`Successfully synced changes to ${target}`);
  } else {
    printWarning(`Synced with ${errorCount} errors`);
  }

  console.log(`Files synced to: ${targetDir}`);
}
