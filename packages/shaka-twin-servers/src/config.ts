import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TwinServersConfig, ResolvedConfig } from './types';

const CONFIG_FILENAMES = ['twin-servers.config.ts', 'twin-servers.config.js'];

export function defineConfig(config: TwinServersConfig): TwinServersConfig {
  return config;
}

export function findConfigFile(cwd: string = process.cwd()): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const configPath = path.join(cwd, filename);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

export async function loadConfig(configPath: string): Promise<TwinServersConfig> {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const ext = path.extname(absolutePath);

  if (ext !== '.js' && ext !== '.ts') {
    throw new Error(`Unsupported config file extension: ${ext}. Use .js or .ts`);
  }

  try {
    let configModule;

    if (ext === '.ts') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tsImport } = require('tsx/esm/api');
      const tsModule = await tsImport(absolutePath, __filename);
      configModule = tsModule.default?.default ?? tsModule.default ?? tsModule;
    } else {
      configModule = await import(absolutePath);
    }

    const config = configModule.default || configModule;

    if (!config || typeof config !== 'object') {
      throw new Error(`Config file must export a configuration object`);
    }

    return config as TwinServersConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load config from ${absolutePath}: ${error.message}`);
    }
    throw error;
  }
}

function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function resolveConfig(config: TwinServersConfig, cwd: string = process.cwd()): ResolvedConfig {
  // Validate all required fields
  if (!config.projectDir) {
    throw new Error('projectDir is required in config');
  }
  if (!config.controlDir) {
    throw new Error('controlDir is required in config');
  }
  if (!config.dockerBuildDir) {
    throw new Error('dockerBuildDir is required in config');
  }
  if (!config.dockerBuildArgs) {
    throw new Error('dockerBuildArgs is required in config');
  }
  if (!config.composeFile) {
    throw new Error('composeFile is required in config');
  }
  if (!config.procfile) {
    throw new Error('procfile is required in config');
  }
  if (!config.stopSignals || Object.keys(config.stopSignals).length === 0) {
    throw new Error('stopSignals is required in config');
  }
  if (!config.images.control) {
    throw new Error('images.control is required in config');
  }
  if (!config.images.experiment) {
    throw new Error('images.experiment is required in config');
  }
  if (!config.volumes.control) {
    throw new Error('volumes.control is required in config');
  }
  if (!config.volumes.experiment) {
    throw new Error('volumes.experiment is required in config');
  }

  const projectDir = path.resolve(cwd, expandTilde(config.projectDir));
  const controlDir = path.resolve(cwd, expandTilde(config.controlDir));
  const dockerBuildDir = path.resolve(cwd, expandTilde(config.dockerBuildDir));

  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project directory not found: ${projectDir}`);
  }
  if (!fs.existsSync(controlDir)) {
    throw new Error(`Control directory not found: ${controlDir}`);
  }
  if (!fs.existsSync(dockerBuildDir)) {
    throw new Error(`Docker build root not found: ${dockerBuildDir}`);
  }

  return {
    projectDir,
    controlDir,
    dockerBuildDir,
    dockerBuildArgs: config.dockerBuildArgs,
    composeFile: path.resolve(projectDir, config.composeFile),
    procfile: path.resolve(projectDir, config.procfile),
    stopSignals: config.stopSignals,
    images: {
      control: config.images.control,
      experiment: config.images.experiment,
    },
    volumes: {
      control: expandTilde(config.volumes.control),
      experiment: expandTilde(config.volumes.experiment),
    },
  };
}
