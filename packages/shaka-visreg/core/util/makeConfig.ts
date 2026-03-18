import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfigFile } from 'shaka-shared';
import extendConfig from './extendConfig';
import { VISREG_DEFAULT_CONFIG } from '../types';
import type { RuntimeConfig, VisregGlobalConfig } from '../types';

function projectPath (_config: Partial<RuntimeConfig>) {
  return process.cwd();
}

async function loadProjectConfig (options: Record<string, any> | undefined, config: Partial<RuntimeConfig>) {
  const customTestReportFileName = options && (options.testReportFileName || null);
  if (customTestReportFileName) {
    config.testReportFileName = options.testReportFileName || null;
  }

  // Resolve config file path
  const customConfigPath = options && (options.configFilePath || options.configPath || options.config);
  const configPath = customConfigPath
    ? (path.isAbsolute(customConfigPath) ? customConfigPath : path.join(config.projectPath!, customConfigPath))
    : path.join(config.projectPath!, 'visreg.config.ts');

  config.configFileName = configPath;

  // Load visreg config (or use defaults) so that extendConfig receives
  // real values for paths, retries, viewports, etc.
  if (existsSync(configPath)) {
    const globalConfig = await loadConfigFile(configPath) as unknown as VisregGlobalConfig;
    const { scenarios: _scenarios, ...configWithoutScenarios } = globalConfig as any;
    if (options) options._loadedVisregConfig = configWithoutScenarios;
    return configWithoutScenarios;
  }
  const defaults = { ...VISREG_DEFAULT_CONFIG };
  if (options) options._loadedVisregConfig = defaults;
  return defaults;
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
