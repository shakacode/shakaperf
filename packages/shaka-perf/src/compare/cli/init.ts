/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import chalk from 'chalk';

// Default filename shaka-shared's `findAbTestsConfig` looks for first — keeps
// `shaka-perf compare` working immediately after `init` without a -c flag.
const DEFAULT_DEST_FILENAME = 'abtests.config.ts';

// Bundled Claude Code skills shipped alongside the config so a fresh project
// gets both the runtime config and the agent tooling in one step:
//   - shaka-perf: map of the CLI commands; tells an agent to read each
//     command's --help before using it.
//   - shaka-perf-add-coverage: adds focused source-aware visual-regression tests.
//   - shaka-perf-coverage: estimates screenshot coverage from code + visibility maps.
//   - shaka-perf-dockerize: walks an agent through standing up the
//     twin-servers Docker A/B infrastructure (Dockerfile, Procfile, config).
//   - shaka-perf-find-bugs: drives twin-servers as a QA rig to reproduce
//     regressions a branch introduces and writes a paired-screenshot report.
const SKILL_NAMES = [
  'shaka-perf',
  'shaka-perf-add-coverage',
  'shaka-perf-coverage',
  'shaka-perf-dockerize',
  'shaka-perf-find-bugs',
];

// At runtime __dirname is dist/compare/cli/, so go up three levels to the
// package root. `templates/` and `dist/skills/` both ship with the npm tarball
// (templates listed in package.json `files`, dist/ is the build output).
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG_TEMPLATE_PATH = path.resolve(
  PACKAGE_ROOT,
  'templates',
  DEFAULT_DEST_FILENAME,
);
const skillTemplatePath = (name: string) =>
  path.resolve(PACKAGE_ROOT, 'dist', 'skills', name);

/**
 * Resolve the `shaka-shared` version as seen from `anchorFile`'s directory,
 * using the normal node_modules walk. Returns null when it can't be resolved.
 */
function shakaSharedVersionFrom(anchorFile: string): string | null {
  try {
    const pkgPath = createRequire(anchorFile).resolve('shaka-shared/package.json');
    const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * Compare the release portion (major.minor.patch) of two semver strings,
 * ignoring any prerelease suffix so `0.2.0-rc.1` isn't flagged older than
 * `0.2.0`. Returns <0 if a<b, 0 if equal, >0 if a>b.
 */
function compareReleaseVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.split('-', 1)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The generated `abtests.config.ts` imports `shaka-shared`, so the project must
 * have it installed and at least as new as the version this shaka-perf was
 * built against — an older shaka-shared may be missing APIs the config uses
 * (`assignPortsAutomatically`, viewport constants, …). Aborts with an
 * install/upgrade command otherwise. The required version is read from the
 * shaka-shared this shaka-perf itself resolves to (no network), and the
 * installed version from the project at `cwd`.
 */
function assertShakaSharedInstalled(cwd: string): void {
  const required = shakaSharedVersionFrom(__filename);
  const installed = shakaSharedVersionFrom(path.join(cwd, 'package.json'));
  const pin = required ? `@${required}` : '';

  if (!installed) {
    throw new Error(
      `shaka-shared is not installed in ${cwd}. The generated ` +
        `${DEFAULT_DEST_FILENAME} imports it, so install it first:\n` +
        `  yarn add --exact shaka-shared${pin}    (or: npm install --save-exact shaka-shared${pin})`,
    );
  }
  if (required && compareReleaseVersions(installed, required) < 0) {
    throw new Error(
      `installed shaka-shared ${installed} is older than ${required}, ` +
        `which this shaka-perf needs (the generated config uses newer shaka-shared APIs). ` +
        `Upgrade it:\n` +
        `  yarn add --exact shaka-shared${pin}    (or: npm install --save-exact shaka-shared${pin})`,
    );
  }
}

export function createInitCommand(): Command {
  return new Command('init')
    .description(
      `Copy the bundled ${DEFAULT_DEST_FILENAME} template and the ${SKILL_NAMES.join(', ')} Claude Code skills into the current directory. Refuses to overwrite an existing config or skill directory unless --force is passed.`,
    )
    .option(
      '-o, --out <path>',
      `Config destination path (default: ./${DEFAULT_DEST_FILENAME})`,
    )
    .option(
      '-f, --force',
      'Overwrite an existing config and recursively replace the skill directory (any user edits inside it will be lost)',
      false,
    )
    .action((opts: { out?: string; force?: boolean }) => {
      try {
        runInit(opts);
      } catch (error) {
        // init is a user-facing scaffolding command — a plain message
        // ("install shaka-shared", "refusing to overwrite") is far more useful
        // than a stack trace, so print only the message and exit non-zero.
        console.error(`shaka-perf init: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}

function runInit(opts: { out?: string; force?: boolean }): void {
  const cwd = process.cwd();

  // Pre-flight: the generated config can't load without a recent shaka-shared,
  // so fail fast with instructions rather than scaffolding a config that
  // immediately errors on import.
  assertShakaSharedInstalled(cwd);

  const configDest = path.resolve(cwd, opts.out ?? DEFAULT_DEST_FILENAME);
  const skillDests = SKILL_NAMES.map((name) => ({
    name,
    src: skillTemplatePath(name),
    dest: path.resolve(cwd, '.claude', 'skills', name),
  }));
  const force = opts.force === true;

  // Fail loud if any bundled source is missing — silently falling back to
  // inline strings would drift from the bundled assets over time.
  if (!fs.existsSync(CONFIG_TEMPLATE_PATH)) {
    throw new Error(
      `bundled template not found at ${CONFIG_TEMPLATE_PATH}. ` +
        'Re-install shaka-perf or file an issue — the package may be missing its templates/ folder.',
    );
  }
  for (const { src } of skillDests) {
    if (!fs.existsSync(src)) {
      throw new Error(
        `bundled skill not found at ${src}. ` +
          'Re-install shaka-perf, or run `yarn build` if you are running from a source checkout.',
      );
    }
  }

  if (fs.existsSync(configDest) && !force) {
    throw new Error(
      `refusing to overwrite ${configDest}. Pass --force to replace it.`,
    );
  }
  for (const { dest } of skillDests) {
    if (fs.existsSync(dest) && !force) {
      throw new Error(
        `refusing to replace ${dest}. Pass --force to recursively recopy ` +
          'the bundled skill (any local edits inside it will be lost).',
      );
    }
  }

  fs.mkdirSync(path.dirname(configDest), { recursive: true });
  fs.copyFileSync(CONFIG_TEMPLATE_PATH, configDest);
  console.log(`shaka-perf init: wrote ${configDest}`);

  // Wipe each skill dir before re-copying so files removed in newer skill
  // versions don't linger. cpSync overwrites/adds but never prunes.
  for (const { src, dest } of skillDests) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`shaka-perf init: wrote ${dest}`);
  }

  console.log('');
  console.log(chalk.gray('Next steps — In Claude code:'));
  console.log(`${chalk.green('/goal /shaka-perf-dockerize')}${chalk.gray(' use playwright mcp to verify control and experiment builds look good.')}`);
}
