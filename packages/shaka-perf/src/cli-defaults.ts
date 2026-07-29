/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';
import { findAbTestsConfig, loadAbTestsConfig } from './config-loader';
import { buildAbTestsConfig, type AbTestsConfig } from './config';

/**
 * Pre-scan argv for `-c/--config` so we can load `abtests.config.ts` BEFORE
 * registering commander options on individual subcommands. This lets options
 * like `--controlURL` show their effective defaults (from the config) in
 * `--help` output. Unknown options are ignored here; the real parser runs later.
 *
 * Returns `undefined` if no config is found or the config fails to load/parse.
 * Callers should treat that as "no default" — TS guarantees the extracted
 * fields exist on a valid config, so there is no built-in fallback to apply.
 */
export async function getCLIDefaultsFromConfig<T>(
  argv: string[],
  extract: (config: AbTestsConfig) => T,
): Promise<T | undefined> {
  const pre = new Command()
    .option('-c, --config <path>')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .exitOverride();

  try {
    pre.parse(argv, { from: 'node' });
  } catch {
    return undefined;
  }

  const cliConfigPath = pre.opts().config as string | undefined;
  const configPath = cliConfigPath ?? findAbTestsConfig();
  if (!configPath) return undefined;

  try {
    const raw = await loadAbTestsConfig(configPath);
    return extract(buildAbTestsConfig(raw));
  } catch (err) {
    console.warn(
      `shaka-perf: failed to pre-load abtests.config for CLI defaults — running without defaults. (${(err as Error).message})`,
    );
    return undefined;
  }
}
