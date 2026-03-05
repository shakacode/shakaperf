import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TwinServersConfigSchema, type TwinServersConfig, type ResolvedConfig } from './types';

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
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { tsImport } = require('tsx/esm/api');
        const tsModule = await tsImport(absolutePath, __filename);
        configModule = tsModule.default?.default ?? tsModule.default ?? tsModule;
      } catch (esmError) {
        // Fallback to CJS API (e.g. Node 18 CommonJS context)
        console.log(`tsx ESM import failed, falling back to CJS API...`);
        console.log(esmError instanceof Error ? esmError.stack : esmError);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tsx = require('tsx/cjs/api');
        const tsModule = tsx.require(absolutePath, __filename);
        configModule = tsModule.default ?? tsModule;
      }
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
    composeFile: path.resolve(projectDir, validConfig.composeFile),
    procfile: path.resolve(projectDir, validConfig.procfile),
    images: validConfig.images,
    volumes: {
      control: expandTilde(validConfig.volumes.control),
      experiment: expandTilde(validConfig.volumes.experiment),
    },
    setupCommands: validConfig.setupCommands ?? [],
  };
}
