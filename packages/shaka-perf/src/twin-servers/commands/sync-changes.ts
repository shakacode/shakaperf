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
import { readBuildManifest } from '../helpers/rebuild-check';

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

  // Git reports paths from the repository root, while the bind mount and
  // build manifest are relative to the Docker build context.
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
  let deletedCount = 0;
  let skippedDeletionCount = 0;
  let skippedOutsideBuildContextCount = 0;
  let errorCount = 0;
  const buildManifest = readBuildManifest(targetDir);
  const imageFiles = buildManifest ? new Set(buildManifest.files) : null;

  for (const relativeFilePath of changedFiles) {
    const sourcePath = path.resolve(sourceDir, relativeFilePath);
    const relativeBuildPath = path.relative(sideBuildDir, sourcePath);
    if (
      relativeBuildPath === '..' ||
      relativeBuildPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeBuildPath)
    ) {
      if (verbose) {
        console.log(`  Skipped (outside build context): ${relativeFilePath}`);
      }
      skippedOutsideBuildContextCount++;
      continue;
    }
    const destPath = path.join(targetDir, relativeBuildPath);

    // Apply deletions to the bind mount so the container matches the source.
    if (!fs.existsSync(sourcePath)) {
      const posixPath = relativeBuildPath.split(path.sep).join('/');
      if (!imageFiles || !imageFiles.has(posixPath)) {
        if (verbose) {
          console.log(`  Skipped (not in build manifest): ${relativeFilePath}`);
        }
        skippedDeletionCount++;
        continue;
      }
      try {
        fs.rmSync(destPath, { force: true });
        if (verbose) {
          console.log(`  Deleted: ${relativeFilePath}`);
        }
        deletedCount++;
      } catch (error) {
        printError(`Failed to delete ${relativeFilePath}: ${(error as Error).message}`);
        errorCount++;
      }
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
  if (deletedCount > 0) {
    console.log(`  Deleted: ${deletedCount} files`);
  }
  if (skippedDeletionCount > 0) {
    console.log(`  Skipped (not in build manifest): ${skippedDeletionCount} files`);
  }
  if (skippedOutsideBuildContextCount > 0) {
    console.log(`  Skipped (outside build context): ${skippedOutsideBuildContextCount} files`);
  }
  if (errorCount > 0) {
    printWarning(`Errors: ${errorCount} files`);
  }
  console.log('');

  const skippedCount = skippedDeletionCount + skippedOutsideBuildContextCount;
  if (errorCount === 0 && skippedCount === 0) {
    printSuccess(`Successfully synced changes to ${target}`);
  } else if (errorCount === 0) {
    printWarning(`Synced with ${skippedCount} skipped change${skippedCount === 1 ? '' : 's'}`);
  } else {
    printWarning(`Synced with ${errorCount} errors`);
  }

  console.log(`Files synced to: ${targetDir}`);
}
