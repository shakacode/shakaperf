import * as path from 'path';
import { findConfigFile } from './find-config-file';
import { loadConfigFile } from './load-config-file';

export const ABTESTS_CONFIG_FILENAMES = ['abtests.config.ts', 'abtests.config.js'];

export function findAbTestsConfig(cwd?: string): string | null {
  return findConfigFile(ABTESTS_CONFIG_FILENAMES, cwd);
}

export async function loadAbTestsConfig(
  configPath: string,
): Promise<Record<string, unknown>> {
  const absolute = path.resolve(configPath);
  return loadConfigFile(absolute);
}
