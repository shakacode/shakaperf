import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfigFile } from './shared/load-config-file';
import { findConfigFile as sharedFindConfigFile } from './shared/find-config-file';
import { TwinServersConfigSchema, type TwinServersConfig, type TwinServersConfigInput, type ResolvedConfig } from './types';

const CONFIG_FILENAMES = ['twin-servers.config.ts', 'twin-servers.config.js'];

const DEFAULT_COMPOSE_FILE = path.resolve(__dirname, '..', 'templates', 'docker-compose.yml');

export function defineConfig(config: TwinServersConfigInput): TwinServersConfigInput {
  return config;
}

export function findConfigFile(cwd?: string): string | null {
  return sharedFindConfigFile(CONFIG_FILENAMES, cwd);
}

export async function loadConfig(configPath: string): Promise<TwinServersConfig> {
  return loadConfigFile(configPath) as Promise<TwinServersConfig>;
}

function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function resolveConfig(config: unknown, cwd: string = process.cwd()): ResolvedConfig {
  // Validate schema with Zod
  const parseResult = TwinServersConfigSchema.safeParse(config);
  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0];
    const fieldPath = firstError.path.join('.');
    throw new Error(fieldPath ? `${fieldPath}: ${firstError.message}` : firstError.message);
  }
  const validConfig = parseResult.data;

  // Resolve paths and validate existence
  const projectDir = path.resolve(cwd, expandTilde(validConfig.projectDir));
  const controlDir = path.resolve(cwd, expandTilde(validConfig.controlDir));
  const dockerBuildDir = path.resolve(cwd, expandTilde(validConfig.dockerBuildDir));

  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project directory not found: ${projectDir}`);
  }
  // Note: controlDir is only validated when building control target (in build.ts)
  if (!fs.existsSync(dockerBuildDir)) {
    throw new Error(`Docker build root not found: ${dockerBuildDir}`);
  }

  return {
    projectDir,
    controlDir,
    dockerBuildDir,
    dockerfile: validConfig.dockerfile,
    dockerBuildArgs: validConfig.dockerBuildArgs,
    composeFile: validConfig.composeFile
      ? path.resolve(projectDir, validConfig.composeFile)
      : DEFAULT_COMPOSE_FILE,
    procfile: path.resolve(projectDir, validConfig.procfile),
    images: validConfig.images,
    volumes: {
      control: expandTilde(validConfig.volumes.control),
      experiment: expandTilde(validConfig.volumes.experiment),
    },
    setupCommands: validConfig.setupCommands ?? [],
  };
}
