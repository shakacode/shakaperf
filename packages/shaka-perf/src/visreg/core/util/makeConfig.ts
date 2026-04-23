import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfigFile } from 'shaka-shared';
import extendConfig from './extendConfig';
import type { RuntimeConfig, VisregEngineInputConfig } from '../types';

function projectPath (_config: Partial<RuntimeConfig>) {
  return process.cwd();
}

/**
 * Resolve and load the engine-input config the compare runner wrote to
 * a temp file. No legacy `visreg.config.ts` fallback — `abtests.config.ts`
 * is the only user-facing visreg config now, and the compare runner
 * always hands this path through.
 */
async function loadProjectConfig (options: Record<string, any> | undefined, config: Partial<RuntimeConfig>) {
  const customTestReportFileName = options && (options.testReportFileName || null);
  if (customTestReportFileName) {
    config.testReportFileName = options.testReportFileName || null;
  }

  const customConfigPath = options && (options.configFilePath || options.configPath || options.config);
  if (!customConfigPath) {
    throw new Error(
      'visreg engine: no config path provided. The unified compare runner ' +
      '(shaka-perf compare) writes a temp config and passes its path via ' +
      '--config — call the engine through that entry point.',
    );
  }
  const configPath = path.isAbsolute(customConfigPath)
    ? customConfigPath
    : path.join(config.projectPath!, customConfigPath);

  if (!existsSync(configPath)) {
    throw new Error(`visreg engine: config not found at ${configPath}`);
  }

  config.configFileName = configPath;

  const loaded = await loadConfigFile(configPath) as unknown as VisregEngineInputConfig;
  const { scenarios: _scenarios, ...configWithoutScenarios } = loaded as any;
  if (options) options._loadedVisregConfig = configWithoutScenarios;
  return configWithoutScenarios;
}

async function makeConfig (_command: string, options?: Record<string, any>) {
  const config: Partial<RuntimeConfig> = {};

  config.args = options || {};

  config.visregRoot = path.join(__dirname, '../..');
  config.projectPath = projectPath(config);
  config.perf = {};

  const userConfig = Object.assign({}, await loadProjectConfig(options, config));

  return extendConfig(config, userConfig);
}

export default makeConfig;
