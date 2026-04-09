#!/usr/bin/env node

import { Command } from 'commander';

const { version } = require('../package.json');

// Lazy-load each subcommand program so we don't pull in heavy native deps
// (e.g. lighthouse/chrome-launcher from bench) unless they're actually used.
// Loading them all together has been observed to crash v8's cppgc.
function loadProgram(name: 'bench' | 'visreg' | 'twin-servers'): Command {
  switch (name) {
    case 'bench':
      return require('./bench/cli/program').createBenchProgram();
    case 'visreg':
      return require('./visreg/cli/program').createVisregProgram();
    case 'twin-servers':
      return require('./twin-servers/program').createTwinServersProgram();
  }
}

const program = new Command();
program
  .name('shaka-perf')
  .description('Frontend performance testing toolkit for web applications')
  .version(`shaka-perf v${version}`, '--version', 'Show version');

const args = process.argv.slice(2);
const first = args.find((a) => !a.startsWith('-'));

if (first === 'bench' || first === 'visreg' || first === 'twin-servers') {
  program.addCommand(loadProgram(first));
} else {
  // For --help / --version / unknown commands, register stub commands so
  // help text shows all three subcommands without loading their modules.
  program.command('bench').description('Benchmarking tools for web applications');
  program.command('visreg').description('Visual regression testing for web applications');
  program.command('twin-servers').description('Twin server management for A/B performance testing');
}

program.parseAsync().catch((err) => {
  console.error(err && err.message);
  process.exit(1);
});
