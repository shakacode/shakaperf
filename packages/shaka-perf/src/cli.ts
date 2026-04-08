#!/usr/bin/env node

import { Command } from 'commander';
import { createBenchProgram } from './bench/cli/program';
import { createVisregProgram } from './visreg/cli/program';
import { createTwinServersProgram } from './twin-servers/program';

const { version } = require('../package.json');

const program = new Command();
program
  .name('shaka-perf')
  .description('Frontend performance testing toolkit for web applications')
  .version(`shaka-perf v${version}`, '--version', 'Show version');

program.addCommand(createBenchProgram());
program.addCommand(createVisregProgram());
program.addCommand(createTwinServersProgram());

program.parse();
