import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import extendConfig from './extendConfig.js';
import type { RuntimeConfig } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

const NON_CONFIG_COMMANDS = ['init', 'version'];

function projectPath (_config: Partial<RuntimeConfig>) {
  return process.cwd();
}

function loadProjectConfig (command: string, options: Record<string, any> | undefined, config: Partial<RuntimeConfig>) {
  // TEST REPORT FILE NAME
  const customTestReportFileName = options && (options.testReportFileName || null);
  if (customTestReportFileName) {
    config.testReportFileName = options.testReportFileName || null;
  }

  // When using --testFile, the global config is loaded separately in
  // createComparisonBitmaps.  We still need configFileName set for path
  // derivation, but we skip loading scenarios from it.
  if (options && options.testFile) {
    let customConfigPath = options.configFilePath || options.configPath;
    if (typeof options.config === 'string') {
      customConfigPath = options.config;
    }
    if (customConfigPath) {
      config.configFileName = path.isAbsolute(customConfigPath)
        ? customConfigPath
        : path.join(config.projectPath!, customConfigPath);
    } else {
      config.configFileName = path.join(config.projectPath!, 'visreg.config.ts');
    }
    return {};
  }

  let customConfigPath = options && (options.configFilePath || options.configPath);
  if (options && typeof options.config === 'string' && !customConfigPath) {
    customConfigPath = options.config;
  }

  if (customConfigPath) {
    if (path.isAbsolute(customConfigPath)) {
      config.configFileName = customConfigPath;
    } else {
      config.configFileName = path.join(config.projectPath!, customConfigPath);
    }
  } else {
    config.configFileName = path.join(config.projectPath!, 'visreg.json');
  }

  let userConfig = {};
  const CMD_REQUIRES_CONFIG = !NON_CONFIG_COMMANDS.includes(command);
  if (CMD_REQUIRES_CONFIG) {
    if (options && typeof options.config === 'object' && options.config.scenarios) {
      console.log('Object-literal config detected.');
      if (options.config.debug) {
        console.log(JSON.stringify(options.config, null, 2));
      }
      userConfig = options.config;
    } else if (config.configFileName && existsSync(config.configFileName)) {
      // Remove from cache config content
      delete _require.cache[_require.resolve(config.configFileName)];
      console.log('Loading config: ', config.configFileName, '\n');
      userConfig = _require(config.configFileName);
    }
  }

  return userConfig;
}

function makeConfig (command: string, options?: Record<string, any>) {
  const config: Partial<RuntimeConfig> = {};

  config.args = options || {};

  config.visregRoot = path.join(__dirname, '../..');
  config.projectPath = projectPath(config);
  config.perf = {};

  const userConfig = Object.assign({}, loadProjectConfig(command, options, config));

  return extendConfig(config, userConfig);
}

export default makeConfig;
