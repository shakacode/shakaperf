import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadConfigFile,
  findConfigFile as sharedFindConfigFile,
  findAbTestsConfig,
  loadAbTestsConfig,
} from 'shaka-shared';
import { TwinServersConfigSchema, type TwinServersConfig, type TwinServersConfigInput, type ResolvedConfig } from './types';

const LEGACY_CONFIG_FILENAMES = ['twin-servers.config.ts', 'twin-servers.config.js'];

// At runtime __dirname is dist/twin-servers/, so go up two levels to package root
const DEFAULT_COMPOSE_FILE = path.resolve(__dirname, '..', '..', 'templates', 'docker-compose.yml');

export function defineConfig(config: TwinServersConfigInput): TwinServersConfigInput {
  return config;
}

export function findConfigFile(cwd?: string): string | null {
  return findAbTestsConfig(cwd) ?? sharedFindConfigFile(LEGACY_CONFIG_FILENAMES, cwd);
}

export async function loadConfig(configPath: string): Promise<TwinServersConfig> {
  const basename = path.basename(configPath);
  if (basename.startsWith('abtests.config.')) {
    const raw = await loadAbTestsConfig(configPath);
    const slice = (raw as { twinServers?: unknown }).twinServers;
    if (!slice) {
      throw new Error(
        `${configPath} has no \`twinServers\` section. Add one or use a legacy twin-servers.config.ts.`,
      );
    }
    return slice as TwinServersConfig;
  }
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
    ports: validConfig.ports,
    setupCommands: validConfig.setupCommands ?? [],
  };
}
