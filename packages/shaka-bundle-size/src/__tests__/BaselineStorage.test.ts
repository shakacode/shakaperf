import * as path from 'path';
import { BaselineStorage } from '../BaselineStorage';
import { SilentReporter } from '../Reporter';

// Mock the AWS SDK and child_process
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn();
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    ListObjectsV2Command: jest.fn(),
    GetObjectCommand: jest.fn(),
    PutObjectCommand: jest.fn(),
    DeleteObjectsCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

jest.mock('child_process', () => ({
  execSync: jest.fn((cmd: string) => {
    if (cmd.includes('rev-parse --abbrev-ref origin/HEAD')) return 'origin/main';
    if (cmd.includes('fetch origin')) return '';
    if (cmd.includes('merge-base')) return 'abc123def456';
    if (cmd.includes('git log')) return 'commit1\ncommit2\ncommit3';
    if (cmd.includes('rev-parse HEAD')) return 'currentcommithash';
    return '';
  }),
}));

describe('BaselineStorage', () => {
  const defaultConfig = {
    s3Bucket: 'test-bucket',
    s3Prefix: 'bundle-size-baselines/',
    baselineDir: '/tmp/baseline',
    mainCommitsToCheck: 10,
    reporter: new SilentReporter(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates instance with valid config', () => {
      const storage = new BaselineStorage(defaultConfig);
      expect(storage).toBeDefined();
    });

    it('ensures prefix ends with slash', () => {
      const storage = new BaselineStorage({ ...defaultConfig, s3Prefix: 'no-trailing-slash' });
      expect(storage.getS3KeyForCommit('abc')).toBe('no-trailing-slash/abc/');
    });

    it('does not double-slash if prefix already ends with slash', () => {
      const storage = new BaselineStorage(defaultConfig);
      expect(storage.getS3KeyForCommit('abc')).toBe('bundle-size-baselines/abc/');
    });
  });

  describe('getMainBranch', () => {
    it('returns detected main branch', () => {
      const storage = new BaselineStorage(defaultConfig);
      expect(storage.getMainBranch()).toBe('main');
    });
  });

  describe('getS3KeyForCommit', () => {
    it('builds correct S3 key', () => {
      const storage = new BaselineStorage(defaultConfig);
      expect(storage.getS3KeyForCommit('abc123')).toBe('bundle-size-baselines/abc123/');
    });
  });

  describe('getGitMergeBase', () => {
    it('returns merge base commit', () => {
      const storage = new BaselineStorage(defaultConfig);
      expect(storage.getGitMergeBase()).toBe('abc123def456');
    });
  });

  describe('getRecentMainCommits', () => {
    it('returns array of commit hashes', () => {
      const storage = new BaselineStorage(defaultConfig);
      const commits = storage.getRecentMainCommits('abc123');
      expect(commits).toEqual(['commit1', 'commit2', 'commit3']);
    });
  });

  describe('getCurrentCommit', () => {
    it('returns current commit hash', () => {
      const storage = new BaselineStorage(defaultConfig);
      expect(storage.getCurrentCommit()).toBe('currentcommithash');
    });
  });

  describe('baselineExistsForCommit', () => {
    it('returns true when objects exist', async () => {
      const s3Module = require('@aws-sdk/client-s3');
      s3Module.__mockSend.mockResolvedValueOnce({
        Contents: [{ Key: 'bundle-size-baselines/abc/config.json' }],
      });

      const storage = new BaselineStorage(defaultConfig);
      const exists = await storage.baselineExistsForCommit('abc');
      expect(exists).toBe(true);
    });

    it('returns false when no objects exist', async () => {
      const s3Module = require('@aws-sdk/client-s3');
      s3Module.__mockSend.mockResolvedValueOnce({ Contents: [] });

      const storage = new BaselineStorage(defaultConfig);
      const exists = await storage.baselineExistsForCommit('abc');
      expect(exists).toBe(false);
    });

    it('returns false on S3 error', async () => {
      const s3Module = require('@aws-sdk/client-s3');
      s3Module.__mockSend.mockRejectedValueOnce(new Error('S3 error'));

      const storage = new BaselineStorage(defaultConfig);
      const exists = await storage.baselineExistsForCommit('abc');
      expect(exists).toBe(false);
    });
  });

  describe('S3Client configuration', () => {
    it('uses custom endpoint when provided', () => {
      const { S3Client } = require('@aws-sdk/client-s3');
      new BaselineStorage({
        ...defaultConfig,
        s3Endpoint: 'https://custom.r2.cloudflarestorage.com',
      });
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://custom.r2.cloudflarestorage.com',
        })
      );
    });

    it('uses custom credentials when provided', () => {
      const { S3Client } = require('@aws-sdk/client-s3');
      new BaselineStorage({
        ...defaultConfig,
        awsAccessKeyId: 'AKID',
        awsSecretAccessKey: 'SECRET',
      });
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
        })
      );
    });

    it('uses custom region when provided', () => {
      const { S3Client } = require('@aws-sdk/client-s3');
      new BaselineStorage({
        ...defaultConfig,
        awsRegion: 'eu-west-1',
      });
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          region: 'eu-west-1',
        })
      );
    });
  });
});
