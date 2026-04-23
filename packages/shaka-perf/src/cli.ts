#!/usr/bin/env node

import { Command } from 'commander';
import {
  DEFAULT_CONTROL_URL,
  DEFAULT_EXPERIMENT_URL,
  findAbTestsConfig,
  loadAbTestsConfig,
} from 'shaka-shared';
import { createTwinServersCommands } from './twin-servers/program';
import { createCompareCommand } from './compare/cli/program';
import { createInitCommand } from './compare/cli/init';
import { parseAbTestsConfig } from './compare/config';

const { version } = require('../package.json');

interface ResolvedDefaults {
  controlURL: string;
  experimentURL: string;
}

/**
 * Pre-scan argv for `-c/--config` so we can load `abtests.config.ts` BEFORE
 * registering commander options. This lets `--controlURL` / `--experimentURL`
 * show their effective defaults (config value or built-in fallback) in
 * `--help` output. Unknown options are ignored here; the real parser runs later.
 *
 * On any load/parse failure we fall back to the built-in defaults and warn,
 * so `--help` still works on a broken config.
 */
async function resolveCompareDefaults(argv: string[]): Promise<ResolvedDefaults> {
  const fallback: ResolvedDefaults = {
    controlURL: DEFAULT_CONTROL_URL,
    experimentURL: DEFAULT_EXPERIMENT_URL,
  };

  const pre = new Command()
    .option('-c, --config <path>')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .exitOverride();

  try {
    pre.parse(argv, { from: 'node' });
  } catch {
    return fallback;
  }

  const cliConfigPath = pre.opts().config as string | undefined;
  const configPath = cliConfigPath ?? findAbTestsConfig();
  if (!configPath) return fallback;

  try {
    const raw = await loadAbTestsConfig(configPath);
    const parsed = parseAbTestsConfig(raw);
    return {
      controlURL: parsed.shared.controlURL ?? DEFAULT_CONTROL_URL,
      experimentURL: parsed.shared.experimentURL ?? DEFAULT_EXPERIMENT_URL,
    };
  } catch (err) {
    console.warn(
      `shaka-perf: failed to pre-load abtests.config for CLI defaults — falling back to built-ins. (${(err as Error).message})`,
    );
    return fallback;
  }
}

async function main(): Promise<void> {
  const defaults = await resolveCompareDefaults(process.argv);

  const program = new Command();
  program
    .name('shaka-perf')
    .description('Frontend performance testing toolkit for web applications')
    .version(`shaka-perf v${version}`, '--version', 'Show version');

  const compareCmd = createCompareCommand({
    controlURLDefault: defaults.controlURL,
    experimentURLDefault: defaults.experimentURL,
  });

  for (const cmd of [createInitCommand(), compareCmd, ...createTwinServersCommands()]) {
    program.addCommand(cmd);
  }

  await program.parseAsync();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
