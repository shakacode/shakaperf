import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedConfig } from '../types';

const tmpDir = path.join(__dirname, '__tmp_compare_test__');

// Mock shaka-bundle-size
const mockUpdateBaseline = jest.fn();
const mockCheck = jest.fn();
const mockGenerateCurrentStatsTo = jest.fn();
const mockGenerateHtmlDiffs = jest.fn();

const MockBundleSizeChecker = jest.fn().mockImplementation(() => ({
  updateBaseline: mockUpdateBaseline,
  check: mockCheck,
  generateCurrentStatsTo: mockGenerateCurrentStatsTo,
  generateHtmlDiffs: mockGenerateHtmlDiffs,
}));

const MockReporter = jest.fn();
const MockSilentReporter = jest.fn();
const mockFindConfigFile = jest.fn();
const mockLoadConfig = jest.fn();
const mockResolveConfig = jest.fn();

jest.mock('shaka-bundle-size', () => ({
  BundleSizeChecker: MockBundleSizeChecker,
  Reporter: MockReporter,
  SilentReporter: MockSilentReporter,
  findConfigFile: (...args: unknown[]) => mockFindConfigFile(...args),
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  resolveConfig: (...args: unknown[]) => mockResolveConfig(...args),
}));

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

import { compareTwinServers } from '../commands/compare-twin-servers';

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    projectDir: tmpDir,
    controlDir: '/tmp/control-dir',
    dockerBuildDir: tmpDir,
    dockerfile: 'Dockerfile',
    dockerBuildArgs: {},
    composeFile: 'docker-compose.yml',
    procfile: 'Procfile',
    images: { control: 'img-control', experiment: 'img-experiment' },
    volumes: {
      control: path.join(tmpDir, 'vol-control'),
      experiment: path.join(tmpDir, 'vol-experiment'),
    },
    setupCommands: [],
    ...overrides,
  };
}

const defaultBundleConfig = {
  statsFile: 'public/packs/loadable-stats.json',
  baselineDir: 'tmp/bundle_size',
  baselineFile: 'config.json',
  bundleNamePrefix: undefined,
  thresholds: { default: 10, keyComponents: [], keyComponentThreshold: 1, minComponentSizeKb: 1 },
  ignoredBundles: [],
  generateSourceMaps: true,
  htmlDiffs: { enabled: true, outputDir: 'bundle-size-diffs', currentDir: 'tmp/bundle_size_current' },
  storage: { s3Bucket: 'test-bucket', s3Prefix: 'baselines/', awsRegion: 'us-east-1', s3Endpoint: '', awsAccessKeyId: '', awsSecretAccessKey: '', mainCommitsToCheck: 10 },
  regressionPolicy: () => ({ shouldFail: false }),
};

describe('compareTwinServers', () => {
  beforeEach(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    jest.clearAllMocks();
    mockExit.mockClear();
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    mockExit.mockRestore();
  });

  it('discovers bundle-size config in projectDir', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    // Create stats files
    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    mockUpdateBaseline.mockReturnValue({ configPath: 'tmp/bundle_size/config.json' });
    mockCheck.mockReturnValue({ passed: true, regressions: [], warnings: [] });

    await compareTwinServers(config, {});

    expect(mockFindConfigFile).toHaveBeenCalledWith(tmpDir);
    expect(mockLoadConfig).toHaveBeenCalledWith('/path/to/bundle-size.config.js');
  });

  it('uses explicit bundle config path when provided', async () => {
    const config = makeConfig();
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    mockUpdateBaseline.mockReturnValue({ configPath: 'tmp/bundle_size/config.json' });
    mockCheck.mockReturnValue({ passed: true, regressions: [], warnings: [] });

    await compareTwinServers(config, { bundleConfigPath: '/custom/bundle-size.config.js' });

    expect(mockFindConfigFile).not.toHaveBeenCalled();
    expect(mockLoadConfig).toHaveBeenCalledWith('/custom/bundle-size.config.js');
  });

  it('throws when bundle-size config not found', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue(null);

    await expect(compareTwinServers(config, {})).rejects.toThrow(
      /No bundle-size config found/
    );
  });

  it('throws when control stats file is missing', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    // Only create experiment stats, not control
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    await expect(compareTwinServers(config, {})).rejects.toThrow(
      /Control stats file not found/
    );
  });

  it('throws when experiment stats file is missing', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    // Only create control stats, not experiment
    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');

    await expect(compareTwinServers(config, {})).rejects.toThrow(
      /Experiment stats file not found/
    );
  });

  it('generates baseline from control and compares experiment', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    mockUpdateBaseline.mockReturnValue({ configPath: 'tmp/bundle_size/config.json' });
    mockCheck.mockReturnValue({ passed: true, regressions: [], warnings: [] });

    await compareTwinServers(config, {});

    // BundleSizeChecker is created twice: once for control, once for experiment
    expect(MockBundleSizeChecker).toHaveBeenCalledTimes(2);

    // Control checker uses control volume path
    const controlConfig = MockBundleSizeChecker.mock.calls[0][0];
    expect(controlConfig.statsFile).toContain('vol-control');

    // Experiment checker uses experiment volume path
    const experimentConfig = MockBundleSizeChecker.mock.calls[1][0];
    expect(experimentConfig.statsFile).toContain('vol-experiment');

    expect(mockUpdateBaseline).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('exits with code 1 when regressions detected', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    mockUpdateBaseline.mockReturnValue({ configPath: 'tmp/bundle_size/config.json' });
    mockCheck.mockReturnValue({ passed: false, regressions: [{ name: 'test' }], warnings: [] });

    await compareTwinServers(config, {});

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('does not exit with code 1 when check passes', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    mockUpdateBaseline.mockReturnValue({ configPath: 'tmp/bundle_size/config.json' });
    mockCheck.mockReturnValue({ passed: true, regressions: [], warnings: [] });

    await compareTwinServers(config, {});

    expect(mockExit).not.toHaveBeenCalled();
  });

  it('generates HTML diffs when enabled', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    mockUpdateBaseline.mockReturnValue({ configPath: 'tmp/bundle_size/config.json' });
    mockCheck.mockReturnValue({ passed: true, regressions: [], warnings: [] });

    await compareTwinServers(config, {});

    expect(mockGenerateCurrentStatsTo).toHaveBeenCalledWith('tmp/bundle_size_current');
    expect(mockGenerateHtmlDiffs).toHaveBeenCalledWith({
      controlDir: 'tmp/bundle_size',
      currentDir: 'tmp/bundle_size_current',
      outputDir: 'bundle-size-diffs',
    });
  });

  it('skips HTML diffs when noHtmlDiffs is true', async () => {
    const config = makeConfig();
    mockFindConfigFile.mockReturnValue('/path/to/bundle-size.config.js');
    mockLoadConfig.mockResolvedValue({});
    mockResolveConfig.mockReturnValue(defaultBundleConfig);

    const controlStatsDir = path.join(config.volumes.control, 'public/packs');
    const experimentStatsDir = path.join(config.volumes.experiment, 'public/packs');
    fs.mkdirSync(controlStatsDir, { recursive: true });
    fs.mkdirSync(experimentStatsDir, { recursive: true });
    fs.writeFileSync(path.join(controlStatsDir, 'loadable-stats.json'), '{}');
    fs.writeFileSync(path.join(experimentStatsDir, 'loadable-stats.json'), '{}');

    mockUpdateBaseline.mockReturnValue({ configPath: 'tmp/bundle_size/config.json' });
    mockCheck.mockReturnValue({ passed: true, regressions: [], warnings: [] });

    await compareTwinServers(config, { noHtmlDiffs: true });

    expect(mockGenerateCurrentStatsTo).not.toHaveBeenCalled();
    expect(mockGenerateHtmlDiffs).not.toHaveBeenCalled();
  });
});
