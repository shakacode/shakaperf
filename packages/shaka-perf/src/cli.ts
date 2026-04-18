#!/usr/bin/env node

import { Command } from 'commander';
import { createBenchCommands } from './bench/cli/program';
import { createVisregCommands } from './visreg/cli/program';
import { createTwinServersCommands } from './twin-servers/program';
import { createCompareCommand } from './compare/cli/program';

const { version } = require('../package.json');

const program = new Command();
program
  .name('shaka-perf')
  .description('Frontend performance testing toolkit for web applications')
  .version(`shaka-perf v${version}`, '--version', 'Show version');

for (const cmd of [
  createCompareCommand(),
  ...createBenchCommands(),
  ...createVisregCommands(),
  ...createTwinServersCommands(),
]) {
  program.addCommand(cmd);
}

program.parse();
