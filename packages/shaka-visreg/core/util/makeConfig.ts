import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import extendConfig from './extendConfig.js';
import { VISREG_DEFAULT_CONFIG } from '../types.js';
import type { RuntimeConfig, VisregGlobalConfig } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function projectPath (_config: Partial<RuntimeConfig>) {
  return process.cwd();
}

export async function loadGlobalVisregConfig (configPath: string): Promise<VisregGlobalConfig> {
  const absolutePath = path.resolve(configPath);
  const ext = path.extname(absolutePath);

  let mod;
  if (ext === '.ts') {
    const { tsImport } = await import('tsx/esm/api');
    const tsModule = await tsImport(absolutePath, import.meta.url);
    mod = tsModule.default?.default ?? tsModule.default ?? tsModule;
  } else {
    const jsModule = await import(pathToFileURL(absolutePath).href);
    mod = jsModule.default ?? jsModule;
  }

  return mod as VisregGlobalConfig;
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
    const globalConfig = await loadGlobalVisregConfig(configPath);
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
