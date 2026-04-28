#!/usr/bin/env node

import { Command } from 'commander';
import { createTwinServersCommands } from './twin-servers/program';
import { createCompareCommand } from './compare/cli/program';
import { createInitCommand } from './compare/cli/init';
import { resolveAbTestsConfig } from './compare/config';

const { version } = require('../package.json');

interface ResolvedDefaults {
  controlURL: string;
  experimentURL: string;
}

/**
 * Pre-scan argv for `-c/--config` so we can load `abtests.config.ts` BEFORE
 * registering commander options. This lets `--controlURL` / `--experimentURL`
 * show their effective defaults (config value or bundled template) in
 * `--help` output. Unknown options are ignored here; the real parser runs later.
 *
 * Soft-fallback to the bundled template via `resolveAbTestsConfig`'s
 * `fallbackOnError` so a broken user config doesn't block `--help`.
 */
async function resolveCompareDefaults(argv: string[]): Promise<ResolvedDefaults> {
  const pre = new Command()
    .option('-c, --config <path>')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .exitOverride();

  let cliConfigPath: string | undefined;
  try {
    pre.parse(argv, { from: 'node' });
    cliConfigPath = pre.opts().config as string | undefined;
  } catch {
    // Bad argv — leave cliConfigPath undefined; resolveAbTestsConfig will
    // then fall back to the bundled template.
  }

  const { config } = await resolveAbTestsConfig({
    configPath: cliConfigPath,
    fallbackOnError: true,
  });
  return {
    controlURL: config.shared.controlURL,
    experimentURL: config.shared.experimentURL,
  };
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
