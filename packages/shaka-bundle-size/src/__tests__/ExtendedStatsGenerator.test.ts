import * as fs from 'fs';
import * as path from 'path';
import { ExtendedStatsGenerator } from '../ExtendedStatsGenerator';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

describe('ExtendedStatsGenerator', () => {
  const tmpDir = path.join(__dirname, 'tmp-extended-stats');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  describe('getWebpackStatsPath', () => {
    it('returns default path without prefix', () => {
      const gen = new ExtendedStatsGenerator({ bundlesDir: '/bundles' });
      expect(gen.getWebpackStatsPath()).toBe(path.join('/bundles', 'webpack-stats.json'));
    });

    it('returns prefixed path with bundleNamePrefix', () => {
      const gen = new ExtendedStatsGenerator({ bundlesDir: '/bundles', bundleNamePrefix: 'consumer' });
      expect(gen.getWebpackStatsPath()).toBe(path.join('/bundles', 'consumer-webpack-stats.json'));
    });
  });

  describe('getExtendedStatsPath', () => {
    it('returns default path without prefix', () => {
      const gen = new ExtendedStatsGenerator({ bundlesDir: '/bundles' });
      expect(gen.getExtendedStatsPath()).toBe(path.join('/bundles', 'bundlesize-extended-stats.json'));
    });

    it('returns prefixed path with bundleNamePrefix', () => {
      const gen = new ExtendedStatsGenerator({ bundlesDir: '/bundles', bundleNamePrefix: 'consumer' });
      expect(gen.getExtendedStatsPath()).toBe(path.join('/bundles', 'consumer-bundlesize-extended-stats.json'));
    });
  });

  describe('generate', () => {
    it('returns stats-not-found error when webpack stats file does not exist', () => {
      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir });
      const result = gen.generate();
      expect(result).toEqual({
        error: 'stats-not-found',
        message: expect.stringContaining('Webpack stats not found'),
      });
    });

    it('returns path on success', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => '');

      // Create the webpack stats file
      fs.writeFileSync(path.join(tmpDir, 'webpack-stats.json'), '{}');

      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir });
      const result = gen.generate();
      expect(result).toEqual({ path: path.join(tmpDir, 'bundlesize-extended-stats.json') });
    });

    it('returns analyzer-failed error when execSync throws', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => { throw new Error('command failed'); });

      fs.writeFileSync(path.join(tmpDir, 'webpack-stats.json'), '{}');

      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir });
      const result = gen.generate();
      expect(result).toEqual({
        error: 'analyzer-failed',
        message: expect.stringContaining('webpack-bundle-analyzer failed'),
      });
    });

    it('uses correct command with bundleNamePrefix', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => '');

      fs.writeFileSync(path.join(tmpDir, 'consumer-webpack-stats.json'), '{}');

      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir, bundleNamePrefix: 'consumer' });
      gen.generate();

      const webpackStatsPath = path.join(tmpDir, 'consumer-webpack-stats.json');
      const extendedStatsPath = path.join(tmpDir, 'consumer-bundlesize-extended-stats.json');

      expect(execSync).toHaveBeenCalledWith(
        `yarn webpack-bundle-analyzer -m json -s gzip "${webpackStatsPath}" -r "${extendedStatsPath}"`,
        { stdio: 'pipe', timeout: 300000 }
      );
    });

    it('uses correct command without bundleNamePrefix', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => '');

      fs.writeFileSync(path.join(tmpDir, 'webpack-stats.json'), '{}');

      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir });
      gen.generate();

      const webpackStatsPath = path.join(tmpDir, 'webpack-stats.json');
      const extendedStatsPath = path.join(tmpDir, 'bundlesize-extended-stats.json');

      expect(execSync).toHaveBeenCalledWith(
        `yarn webpack-bundle-analyzer -m json -s gzip "${webpackStatsPath}" -r "${extendedStatsPath}"`,
        { stdio: 'pipe', timeout: 300000 }
      );
    });
  });
});
