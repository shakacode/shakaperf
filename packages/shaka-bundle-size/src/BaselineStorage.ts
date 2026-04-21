/**
 * Handles downloading baselines from S3 storage (finding merge-base with main)
 * and uploading baselines to S3 for the current commit.
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Reporter } from './Reporter';
import type { IReporter } from './types';

export interface BaselineStorageConfig {
  /** S3 bucket name */
  s3Bucket: string;
  /** S3 key prefix (e.g., 'bundle-size-baselines/') */
  s3Prefix: string;
  /** AWS region (optional, falls back to AWS_REGION env or 'auto'). Use 'auto' for R2. */
  awsRegion?: string;
  /** Custom endpoint URL for S3-compatible services like Cloudflare R2 (e.g., 'https://<account_id>.r2.cloudflarestorage.com'). Falls back to S3_ENDPOINT env var. */
  s3Endpoint?: string;
  /** AWS access key ID (optional, falls back to AWS_ACCESS_KEY_ID env var) */
  awsAccessKeyId?: string;
  /** AWS secret access key (optional, falls back to AWS_SECRET_ACCESS_KEY env var) */
  awsSecretAccessKey?: string;
  /** Working directory for current baseline */
  baselineDir: string;
  /** Number of main branch commits to search for baseline */
  mainCommitsToCheck: number;
  /** Reporter for logging operations */
  reporter?: IReporter;
}

export class BaselineStorage {
  private s3Client: S3Client;
  private bucket: string;
  private prefix: string;
  private baselineDir: string;
  private mainCommitsToCheck: number;
  private mainBranch: string;
  private reporter: IReporter;
  constructor(config: BaselineStorageConfig) {
    this.bucket = config.s3Bucket;
    this.prefix = config.s3Prefix.endsWith('/') ? config.s3Prefix : `${config.s3Prefix}/`;
    this.baselineDir = config.baselineDir;
    this.mainCommitsToCheck = config.mainCommitsToCheck;
    this.reporter = config.reporter || new Reporter();
    // Auto-detect main branch
    this.mainBranch = this.detectMainBranch();
    const endpoint = config.s3Endpoint || process.env.S3_ENDPOINT;
    const accessKeyId = config.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = config.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
    this.s3Client = new S3Client({
      region: config.awsRegion || process.env.AWS_REGION || 'auto',
      ...(endpoint && { endpoint }),
      ...(accessKeyId && secretAccessKey && {
        credentials: { accessKeyId, secretAccessKey },
      }),
    });
  }

  getMainBranch(): string {
    return this.mainBranch;
  }

  private detectMainBranch(): string {
    try {
      // Get the default branch from origin/HEAD
      const result = execSync('git rev-parse --abbrev-ref origin/HEAD', {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();

      // origin/HEAD format is "origin/main" or "origin/master"
      if (result && result.startsWith('origin/')) {
        const branch = result.substring(7); // Remove "origin/" prefix
        this.reporter.verbose(`Detected main branch: ${branch}`);
        return branch;
      }
    } catch (error) {
      throw new Error(
        'Could not detect main branch. Please run: git remote set-head origin --auto'
      );
    }

    throw new Error('Could not detect main branch from origin/HEAD');
  }

  getGitMergeBase(): string {
    this.reporter.verbose(`Fetching origin/${this.mainBranch}...`);
    execSync(`git fetch origin ${this.mainBranch}`, { stdio: 'pipe' });
    const mergeBase = execSync(`git merge-base origin/${this.mainBranch} HEAD`, { encoding: 'utf8' }).trim();
    this.reporter.verbose(`Merge-base with origin/${this.mainBranch}: ${mergeBase.substring(0, 7)}`);
    return mergeBase;
  }

  getRecentMainCommits(mergeBase: string): string[] {
    this.reporter.verbose(`Checking last ${this.mainCommitsToCheck} commits from ${mergeBase.substring(0, 7)}`);
    const output = execSync(
      `git log -${this.mainCommitsToCheck} --first-parent --pretty=format:"%H" ${mergeBase}`,
      { encoding: 'utf8' }
    );
    const commits = output.split('\n').filter(Boolean);
    this.reporter.verbose(`Found ${commits.length} candidate commits`);
    return commits;
  }

  getCurrentCommit(): string {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  }

  getS3KeyForCommit(commit: string): string {
    return `${this.prefix}${commit}/`;
  }

  async baselineExistsForCommit(commit: string): Promise<boolean> {
    const prefix = this.getS3KeyForCommit(commit);

    try {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 1,
        })
      );

      return (response.Contents?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** Returns the commit hash that baseline was found for, or null if not found. */
  async download(): Promise<string | null> {
    this.reporter.info('Looking for baseline starting from merge-base...');
    const mergeBase = this.getGitMergeBase();
    const commits = this.getRecentMainCommits(mergeBase);

    for (const commit of commits) {
      this.reporter.verbose(`Checking commit ${commit.substring(0, 7)} for baseline...`);
      if (await this.baselineExistsForCommit(commit)) {
        this.reporter.info(`Found baseline at commit ${commit.substring(0, 7)}`);
        await this.downloadFromS3(commit);
        return commit;
      }
    }

    this.reporter.verbose(`No baseline found in ${commits.length} commits checked`);
    return null;
  }

  async downloadForCommit(commitSha: string): Promise<string | null> {
    this.reporter.info(`Downloading baseline for commit ${commitSha.substring(0, 7)}...`);
    if (await this.baselineExistsForCommit(commitSha)) {
      await this.downloadFromS3(commitSha);
      return commitSha;
    }
    return null;
  }

  async upload(sourceDir?: string): Promise<string> {
    const uploadDir = sourceDir || this.baselineDir;
    if (!fs.existsSync(uploadDir)) {
      throw new Error(`No baseline found at ${uploadDir}. Run 'shaka-bundle-size generate-stats' first.`);
    }

    const commit = this.getCurrentCommit();
    this.reporter.verbose(`Upload source directory: ${uploadDir}`);
    this.reporter.info(`Uploading baseline for commit ${commit.substring(0, 7)}...`);
    await this.uploadToS3(commit, uploadDir);
    return commit;
  }

  /** Use this when you want to associate the baseline with a specific main branch commit. */
  async uploadForCommit(commitSha: string, sourceDir?: string): Promise<string> {
    const uploadDir = sourceDir || this.baselineDir;
    if (!fs.existsSync(uploadDir)) {
      throw new Error(`No baseline found at ${uploadDir}. Run 'shaka-bundle-size generate-stats' first.`);
    }

    this.reporter.verbose(`Upload source directory: ${uploadDir}`);
    this.reporter.info(`Uploading baseline for commit ${commitSha.substring(0, 7)}...`);
    await this.uploadToS3(commitSha, uploadDir);
    return commitSha;
  }

  private async downloadFromS3(commit: string): Promise<void> {
    const prefix = this.getS3KeyForCommit(commit);
    this.reporter.verbose(`Downloading from s3://${this.bucket}/${prefix}`);

    const listResponse = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      })
    );

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      throw new Error(`No files found for commit ${commit}`);
    }

    this.reporter.verbose(`Downloading ${listResponse.Contents.length} file(s) to ${this.baselineDir}`);

    // Clear and recreate local baselineDir
    if (fs.existsSync(this.baselineDir)) {
      fs.rmSync(this.baselineDir, { recursive: true });
    }
    fs.mkdirSync(this.baselineDir, { recursive: true });

    // Download each file
    for (const object of listResponse.Contents) {
      if (!object.Key) continue;

      // Extract relative path (remove prefix)
      const relativePath = object.Key.slice(prefix.length);
      if (!relativePath) continue; // Skip the "directory" itself

      const localPath = path.join(this.baselineDir, relativePath);
      this.reporter.verbose(`  ${relativePath}`);

      // Ensure parent directory exists
      const parentDir = path.dirname(localPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Download the file
      const getResponse = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: object.Key,
        })
      );

      if (getResponse.Body) {
        const writeStream = fs.createWriteStream(localPath);
        await pipeline(getResponse.Body as Readable, writeStream);
      }
    }
  }

  private async uploadToS3(commit: string, sourceDir?: string): Promise<void> {
    const uploadDir = sourceDir || this.baselineDir;
    const prefix = this.getS3KeyForCommit(commit);
    this.reporter.verbose(`Uploading to s3://${this.bucket}/${prefix}`);

    // Delete existing objects for this commit (if any)
    await this.deleteS3Prefix(prefix);

    // Upload all files from source directory
    const files = this.getAllFiles(uploadDir);
    this.reporter.verbose(`Uploading ${files.length} file(s) from ${uploadDir}`);

    for (const filePath of files) {
      const relativePath = path.relative(uploadDir, filePath);
      const s3Key = `${prefix}${relativePath}`;
      this.reporter.verbose(`  ${relativePath} -> ${s3Key}`);

      const fileContent = fs.readFileSync(filePath);

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: fileContent,
          ContentType: this.getContentType(filePath),
        })
      );
    }
  }

  private async deleteS3Prefix(prefix: string): Promise<void> {
    const listResponse = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      })
    );

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return;
    }

    const objectsToDelete: { Key: string }[] = [];
    for (const obj of listResponse.Contents) {
      if (obj.Key) {
        objectsToDelete.push({ Key: obj.Key });
      }
    }

    if (objectsToDelete.length > 0) {
      this.reporter.verbose(`Cleaning ${objectsToDelete.length} existing object(s) at ${prefix}`);
      await this.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: objectsToDelete },
        })
      );
    }
  }

  private getAllFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.html': 'text/html',
      '.txt': 'text/plain',
    };
    return contentTypes[ext] || 'application/octet-stream';
  }
}
