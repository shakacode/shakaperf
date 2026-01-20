/**
 * BaselineStorage - Git-based baseline storage for CI workflows.
 *
 * Handles downloading baselines from storage (finding merge-base with main)
 * and uploading baselines to storage for the current commit.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration for BaselineStorage.
 */
export interface BaselineStorageConfig {
  /** Directory for commit-based baseline storage */
  storageDir: string;
  /** Working directory for current baseline */
  baselineDir: string;
  /** Number of main branch commits to search for baseline */
  mainCommitsToCheck: number;
}

/**
 * Manages baseline storage using git commit hashes.
 */
export class BaselineStorage {
  private storageDir: string;
  private baselineDir: string;
  private mainCommitsToCheck: number;

  constructor(config: BaselineStorageConfig) {
    this.storageDir = config.storageDir;
    this.baselineDir = config.baselineDir;
    this.mainCommitsToCheck = config.mainCommitsToCheck;
  }

  /**
   * Gets the merge base between HEAD and origin/main.
   */
  getGitMergeBase(): string {
    execSync('git fetch origin main', { stdio: 'pipe' });
    return execSync('git merge-base origin/main HEAD', { encoding: 'utf8' }).trim();
  }

  /**
   * Gets recent commits on main from merge base.
   */
  getRecentMainCommits(mergeBase: string): string[] {
    const output = execSync(
      `git log -${this.mainCommitsToCheck} --pretty=format:"%H" ${mergeBase}`,
      { encoding: 'utf8' }
    );
    return output.split('\n').filter(Boolean);
  }

  /**
   * Gets current HEAD commit.
   */
  getCurrentCommit(): string {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  }

  /**
   * Gets storage path for a commit.
   */
  getStoragePathForCommit(commit: string): string {
    return path.join(this.storageDir, commit);
  }

  /**
   * Checks if baseline exists for a commit.
   */
  baselineExistsForCommit(commit: string): boolean {
    return fs.existsSync(this.getStoragePathForCommit(commit));
  }

  /**
   * Downloads baseline from storage (finds merge-base with main).
   * Returns the commit hash that baseline was found for, or null if not found.
   */
  download(): string | null {
    const mergeBase = this.getGitMergeBase();
    const commits = this.getRecentMainCommits(mergeBase);

    for (const commit of commits) {
      if (this.baselineExistsForCommit(commit)) {
        const storagePath = this.getStoragePathForCommit(commit);
        this.copyDirectory(storagePath, this.baselineDir);
        return commit;
      }
    }

    return null;
  }

  /**
   * Downloads baseline for a specific commit.
   * Returns the commit hash if found, or null if not found.
   */
  downloadForCommit(commitSha: string): string | null {
    if (this.baselineExistsForCommit(commitSha)) {
      const storagePath = this.getStoragePathForCommit(commitSha);
      this.copyDirectory(storagePath, this.baselineDir);
      return commitSha;
    }
    return null;
  }

  /**
   * Uploads current baseline to storage for current commit.
   * Returns the commit hash.
   */
  upload(): string {
    if (!fs.existsSync(this.baselineDir)) {
      throw new Error(`No baseline found at ${this.baselineDir}. Generate stats first.`);
    }

    const commit = this.getCurrentCommit();
    const storagePath = this.getStoragePathForCommit(commit);

    fs.mkdirSync(this.storageDir, { recursive: true });
    this.copyDirectory(this.baselineDir, storagePath);

    return commit;
  }

  /**
   * Uploads current baseline to storage for a specific commit.
   * Use this when you want to associate the baseline with a specific main branch commit.
   */
  uploadForCommit(commitSha: string): string {
    if (!fs.existsSync(this.baselineDir)) {
      throw new Error(`No baseline found at ${this.baselineDir}. Generate stats first.`);
    }

    const storagePath = this.getStoragePathForCommit(commitSha);
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.copyDirectory(this.baselineDir, storagePath);

    return commitSha;
  }

  /**
   * Copies a directory recursively.
   */
  private copyDirectory(src: string, dest: string): void {
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true });
    }
    fs.cpSync(src, dest, { recursive: true });
  }
}
