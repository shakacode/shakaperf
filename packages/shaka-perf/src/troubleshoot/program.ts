/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { testRunsForType, type AbTestDefinition, type TestType } from 'shaka-shared';
import { withAbTestsConfigPath } from '../effective-config';
import { findAbTestsConfig, loadAbTestsConfig, loadTests } from '../config-loader';
import { buildAbTestsConfig, type AbTestsConfig } from '../config';
import { runPipeline } from '../pipeline/runner';
import { createTroubleshootPipeline } from './pipeline';
import { getCLIDefaultsFromConfig } from '../cli-defaults';
import { resolveUrl } from '../pipeline/unit-urls';
import {
  DEFAULT_CDP_BASE_PORT,
  allocateCdpPorts,
  describeCdpBrowsers,
  writeCdpSessionFile,
  type CdpSession,
  type CdpSlot,
} from './debug-session';
import {
  cmdSession,
  cmdEval,
  cmdHtml,
  cmdShot,
  cmdConsole,
} from './cdp-client';

/** Accessibility is left out: a window parked on a violation list shows nothing. */
const TROUBLESHOOT_CATEGORIES: readonly TestType[] = ['visreg', 'perf'];

/** Adds the `shaka-perf troubleshoot: ` prefix — pass a bare message. */
function fail(message: string): never {
  console.error(chalk.red(`shaka-perf troubleshoot: ${message}`));
  process.exit(1);
}

async function resolveSingleTest(
  filter: string,
  testPathPattern: string | undefined,
): Promise<AbTestDefinition> {
  let tests: AbTestDefinition[];
  try {
    tests = await loadTests({ filter, testPathPattern });
  } catch (err) {
    return fail((err as Error).message);
  }
  if (tests.length === 1) return tests[0];

  const shown = tests.slice(0, 20).map((t) => `  ${t.name}`);
  if (tests.length > shown.length) shown.push(`  … and ${tests.length - shown.length} more`);
  return fail([
    `--filter "${filter}" matched ${tests.length} tests; it must match exactly one. Matched:`,
    ...shown,
    'Narrow it with a stricter regex (nothing is anchored, so `^name$` pins one),',
    'or pass the path to a single .abtest.ts file.',
  ].join('\n'));
}

function resolveViewportLabel(config: AbTestsConfig, requested: string): string {
  const known = config.shared.viewportDefinitions.map((v) => v.label);
  if (known.includes(requested)) return requested;
  return fail(`unknown viewport "${requested}"; shared.viewportDefinitions defines ${known.join(', ')}.`);
}

function resolveCategories(raw: string): TestType[] {
  const requested = raw.split(',').map((c) => c.trim()).filter(Boolean);
  const unknown = requested.filter(
    (c) => !(TROUBLESHOOT_CATEGORIES as readonly string[]).includes(c),
  );
  if (unknown.length > 0) {
    fail(
      `unsupported category ${unknown.join(', ')}. This command runs ` +
      `${TROUBLESHOOT_CATEGORIES.join(' and ')} only — use \`shaka-perf compare\` for the rest.`,
    );
  }
  if (requested.length === 0) fail('--categories cannot be empty.');
  return requested as TestType[];
}

/** An empty runner result would read as "nothing was wrong". */
function assertTestRunsSomething(
  test: AbTestDefinition,
  categories: readonly TestType[],
): void {
  if (categories.some((c) => testRunsForType(test, c))) return;
  fail(
    `"${test.name}" does not run ${categories.join(' or ')} — ` +
    `its testTypes declare: ${test.testTypes?.join(', ') ?? 'every category'}.`,
  );
}

function cdpSlotsFor(categories: readonly TestType[]): CdpSlot[] {
  return [
    ...(categories.includes('visreg') ? (['visreg'] as const) : []),
    ...(categories.includes('perf') ? (['perf:control', 'perf:experiment'] as const) : []),
  ];
}

/** Anything but `false`/`0`/`no` is true, so a typo shows the browsers rather than hiding them. */
export function parseHeaded(value: string | boolean): boolean {
  return typeof value === 'boolean' ? value : !/^(false|0|no)$/i.test(value.trim());
}

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;

/**
 * Die on the FIRST signal. Playwright registers its own SIGINT/SIGTERM/SIGHUP
 * handlers, and in node a handler *replaces* the default terminate — so without
 * this, signal one ran only Playwright's cleanup and left the Chromes running.
 */
function exitOnSignal(): void {
  for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
    process.on(signal as NodeJS.Signals, () => process.exit(code));
  }
}

// One test, one viewport, every browser left open however the run ends. Never
// finishes by design, and yields no perf numbers. See README-troubleshoot.md.
export async function createTroubleshootCommand(): Promise<Command> {
  const defaults = await getCLIDefaultsFromConfig(process.argv, (c) => ({
    controlURL: c.shared.controlURL,
    experimentURL: c.shared.experimentURL,
  }));
  const command = new Command('troubleshoot')
    .description(
      'Debug one test at one viewport: run visreg + perf and leave every browser ' +
      'open — however the run ends — so you (or an agent) can inspect the live page. ' +
      'Bare `troubleshoot` launches the session; the subcommands attach to it over CDP. ' +
      'Kill it when done — it holds the measurement lock, so any other shaka-perf ' +
      'command queues behind it instead of failing.',
    )
    // Not `.requiredOption`: that check fires for subcommands too, so the launch
    // action enforces these itself (only it needs them).
    .option('--filter <value>', 'Regex/substring, or a path to a single .abtest.ts/.abtest.js file. Must resolve to exactly ONE test.')
    .option('--viewport <label>', 'The ONE viewport to run at — a shared.viewportDefinitions label (e.g. desktop, phone). Overrides any per-test viewport.')
    .option(
      '--categories <list>',
      `Comma-separated subset of ${TROUBLESHOOT_CATEGORIES.join(', ')} to run`,
      TROUBLESHOOT_CATEGORIES.join(','),
    )
    // Spelled `--headed` so it reads the same as it does on `compare`, but
    // defaulting ON, since showing you the page is the whole command. It takes
    // an optional value rather than pairing with a `--no-headed`, so one flag
    // covers both directions.
    .option(
      '--headed [bool]',
      'Show the browser windows (default). `--headed=false` runs them with no windows — still alive and attachable over CDP, so an agent can debug in the background.',
      parseHeaded,
      true,
    )
    .option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)')
    .option('--testPathPattern <regex>', 'Regex narrowing discovered .abtest.ts/.abtest.js files before --filter runs (like Jest)')
    .option('--controlURL <url>', 'Control server URL', defaults?.controlURL)
    .option('--experimentURL <url>', 'Experiment server URL', defaults?.experimentURL)
    .action(async function (this: Command) {
      const opts = this.opts();
      // `.error` (not `.requiredOption`, whose check would also fire for the
      // subcommands) prints + exits 1 in the CLI and throws under exitOverride.
      if (!opts.filter) this.error('--filter is required and must resolve to exactly one test.');
      if (!opts.viewport) this.error('--viewport is required (a shared.viewportDefinitions label, e.g. phone).');
      const configPath = opts.config ?? findAbTestsConfig();
      if (!configPath) {
        throw new Error(
          'No abtests.config.ts found — it is required. ' +
          'Run `shaka-perf init` to create one, or pass --config <path>.',
        );
      }
      await withAbTestsConfigPath(configPath, async () => {
        const config = buildAbTestsConfig(await loadAbTestsConfig(configPath));
        const categories = resolveCategories(opts.categories);
        const viewportLabel = resolveViewportLabel(config, opts.viewport);
        const test = await resolveSingleTest(opts.filter, opts.testPathPattern);
        assertTestRunsSomething(test, categories);

        const pipeline = createTroubleshootPipeline(config);
        const headless = opts.headed === false;
        // Only the categories this test actually runs get an endpoint —
        // publishing one for a browser that never opens is worse than silence.
        const runnable = categories.filter((c) => testRunsForType(test, c));
        const cdpPorts = await allocateCdpPorts(
          cdpSlotsFor(runnable),
          DEFAULT_CDP_BASE_PORT,
        );
        console.log(chalk.bold(
          `\ntroubleshooting "${test.name}" at ${viewportLabel} — ` +
          `${categories.join(' + ')}, ${headless ? 'headless' : 'headed'}, browsers stay open.`,
        ));

        // Derived as the runner derives it, so the manifest lands where the run
        // writes — its own `troubleshoot-results/`, out of reach of `compare`.
        const expectedResultsRoot = path.resolve(
          process.cwd(),
          pipeline.artifactRoot ?? '.',
          `${pipeline.name}-results`,
        );

        const controlURL = opts.controlURL ?? config.shared.controlURL;
        const experimentURL = opts.experimentURL ?? config.shared.experimentURL;

        // Written BEFORE the run so an agent can poll while it starts. Nothing
        // deletes it — `pid` is what marks a leftover as stale. The URLs let a
        // driving command match the visreg browser's two tabs to a side.
        const session: CdpSession = {
          pid: process.pid,
          test: test.name,
          viewport: viewportLabel,
          headless,
          controlURL: resolveUrl(
            test.startingPath,
            test.config?.shared?.controlURL ?? controlURL,
          ),
          experimentURL: resolveUrl(
            test.experimentPathOverride ?? test.startingPath,
            test.config?.shared?.experimentURL ?? experimentURL,
          ),
          browsers: describeCdpBrowsers(cdpPorts),
        };
        const sessionFile = writeCdpSessionFile(expectedResultsRoot, session);
        console.log(chalk.dim(`Session manifest: ${sessionFile}`));

        // BEFORE the run: every stage freezes, so there is no "after". Skipping
        // `runPipeline`'s finally is safe — the measurement lock is a PID file.
        exitOnSignal();

        try {
          await runPipeline(pipeline, {
            config,
            tests: [test],
            controlURL,
            experimentURL,
            testPathPattern: opts.testPathPattern,
            categories: categories.join(','),
            // Filtered by the runner; a test's own `viewports` is dropped, not rewritten.
            viewportsFilter: [viewportLabel],
            headed: opts.headed,
            keepBrowserOpen: true,
            cdpPorts,
            // A retry would build a second set of windows that also never close.
            retries: 0,
            retryDelay: config.shared.retryDelay,
            // No timeout: it would abort the deliberate freezes and let the run
            // finish, taking the browsers with it.
            timeoutMs: 0,
          });
        } catch (err) {
          // Reached only if every stage failed BEFORE its freeze.
          console.error(chalk.bold.red(`\nRun failed: ${(err as Error).message ?? String(err)}`));
          process.exitCode = 1;
        }
      });
    });

  // Driving subcommands: attach to a running session's frozen browsers over CDP.
  const guard = async (run: () => Promise<void> | void): Promise<void> => {
    try {
      await run();
    } catch (err) {
      fail((err as Error).message);
    }
  };

  const targetHelp =
    '<target> is a side: visreg:control, visreg:experiment, perf:control, perf:experiment (or a raw port).';

  command
    .command('session')
    .description('Print the running session: pid and each side’s target + CDP endpoint.')
    .option('--pid', 'Print only the pid, for `kill "$(shaka-perf troubleshoot session --pid)"`.')
    .action((opts: { pid?: boolean }) => guard(() => cmdSession(opts.pid === true)));

  command
    .command('eval <target> <expression>')
    .description(`Run a JS expression in the page; prints the value (objects/arrays as JSON). ${targetHelp}`)
    .action((target: string, expression: string) => guard(() => cmdEval(target, expression)));

  command
    .command('html <target>')
    .description(`Print the page DOM (documentElement.outerHTML). ${targetHelp}`)
    .action((target: string) => guard(() => cmdHtml(target)));

  command
    .command('shot <target> <out>')
    .description(`Screenshot the page to <out> (PNG). ${targetHelp}`)
    .option('--full', 'Capture the full page beyond the viewport.')
    .action((target: string, out: string, opts: { full?: boolean }) =>
      guard(() => cmdShot(target, out, opts.full === true)));

  command
    .command('console <target>')
    .description(`Print all buffered console messages, page errors, and log entries. Non-destructive — never resets the buffer. ${targetHelp}`)
    .action((target: string) => guard(() => cmdConsole(target)));

  command.addHelpText('after', `
# Examples:

## For humans
  # just run the command and have fun in the browsers:
  shaka-perf troubleshoot --filter 'The name of the failing test' --viewport phone

## AI debug loop (attach to the frozen browsers, no MCP needed):

  # launch a test and redirect the logs. It's important to run it in the background:
  shaka-perf troubleshoot --filter 'The name of the failing test' --viewport phone --headed=false > troubleshoot.log 2>&1 &
  tail -f troubleshoot.log        # logs from all the 4 sides;

  # see each side's target and CDP port:
  shaka-perf troubleshoot session

  # drive a side — <target> picks the browser AND the tab for you:
  shaka-perf troubleshoot console visreg:experiment
  shaka-perf troubleshoot html visreg:control
  shaka-perf troubleshoot eval perf:control 'document.title'
  shaka-perf troubleshoot shot perf:experiment exp.png

  # kill it when done — it holds its ports and the measurement lock:
  kill "$(shaka-perf troubleshoot session --pid)"

Commands wait for the browser to come up, so no manual polling. Debug ports bind to
127.0.0.1 and are unauthenticated — never expose them or run troubleshoot in CI.`);

  return command;
}
