import * as fs from 'node:fs';
import * as path from 'node:path';
import { Command } from 'commander';

// Default filename shaka-shared's `findAbTestsConfig` looks for first — keeps
// `shaka-perf compare` working immediately after `init` without a -c flag.
const DEFAULT_DEST_FILENAME = 'abtests.config.ts';

// At runtime __dirname is dist/compare/cli/, so go up three levels to the
// package root and into the bundled templates/ folder (listed in
// package.json `files`, so it ships with the npm tarball).
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'templates',
  'abtests.config.ts',
);

export function createInitCommand(): Command {
  return new Command('init')
    .description(
      `Copy the bundled ${DEFAULT_DEST_FILENAME} template into the current directory.`,
    )
    .option('-f, --force', 'Overwrite an existing config instead of failing', false)
    .option(
      '-o, --out <path>',
      `Destination path (default: ./${DEFAULT_DEST_FILENAME})`,
    )
    .action((opts: { force: boolean; out?: string }) => {
      const destPath = path.resolve(process.cwd(), opts.out ?? DEFAULT_DEST_FILENAME);

      if (fs.existsSync(destPath) && !opts.force) {
        console.error(
          `shaka-perf init: ${destPath} already exists. Use --force to overwrite.`,
        );
        process.exitCode = 1;
        return;
      }

      if (!fs.existsSync(TEMPLATE_PATH)) {
        // Fail loud. Silent fallback to an inline string would drift from the
        // bundled template over time, and users would end up with a config
        // that no longer matches the docs.
        throw new Error(
          `shaka-perf init: bundled template not found at ${TEMPLATE_PATH}. ` +
            'Re-install shaka-perf or file an issue — the package may be missing its templates/ folder.',
        );
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(TEMPLATE_PATH, destPath);
      console.log(`shaka-perf init: wrote ${destPath}`);
    });
}
