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
    it('returns null when webpack stats file does not exist', () => {
      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir });
      const result = gen.generate();
      expect(result).toBeNull();
    });

    it('returns extended stats path on success', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => '');

      // Create the webpack stats file
      fs.writeFileSync(path.join(tmpDir, 'webpack-stats.json'), '{}');

      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir });
      const result = gen.generate();
      expect(result).toBe(path.join(tmpDir, 'bundlesize-extended-stats.json'));
    });

    it('returns null when execSync throws', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => { throw new Error('command failed'); });

      fs.writeFileSync(path.join(tmpDir, 'webpack-stats.json'), '{}');

      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir });
      const result = gen.generate();
      expect(result).toBeNull();
    });

    it('uses correct command with bundleNamePrefix', () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => '');

      fs.writeFileSync(path.join(tmpDir, 'consumer-webpack-stats.json'), '{}');

      const gen = new ExtendedStatsGenerator({ bundlesDir: tmpDir, bundleNamePrefix: 'consumer' });
      gen.generate();

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('consumer-webpack-stats.json'),
        expect.any(Object)
      );
    });
  });
});
