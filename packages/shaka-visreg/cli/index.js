#!/usr/bin/env node

import parseArgs from 'minimist';
import usage from './usage.js';
import { createRequire } from 'node:module';
import runner from '../core/runner.js';

const _require = createRequire(import.meta.url);
const { version } = _require('../package.json');

main();

function main () {
  const argsOptions = parseArgs(process.argv.slice(2), {
    boolean: ['h', 'help', 'v', 'version', 'i', 'docker'],
    string: ['config'],
    default: {
      config: 'backstop.json'
    }
  });

  // Catch errors from failing promises
  process.on('unhandledRejection', function (error) {
    console.error(error && error.stack);
  });

  if (argsOptions.h || argsOptions.help) {
    console.log(usage);
    return;
  }

  if (argsOptions.v || argsOptions.version) {
    console.log('BackstopJS v' + version);
    return;
  }

  const commandName = argsOptions._[0];

  if (!commandName) {
    console.log(usage);
  } else {
    console.log('BackstopJS v' + version);
    runner(commandName, argsOptions).catch(function () {
      process.exitCode = 1;
    });

    process.on('uncaughtException', function (err) {
      console.log('Uncaught exception:', err.message, err.stack);
      throw err;
    });
  }
}
