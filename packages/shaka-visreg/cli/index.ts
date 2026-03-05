#!/usr/bin/env node

import parseArgs from 'minimist';
import { createRequire } from 'node:module';
import usage from './usage.js';
import runner from '../core/runner.js';

const _require = createRequire(import.meta.url);
const packageJson = _require('../package.json');
const { version } = packageJson;

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
  process.on('unhandledRejection', function (error: Error | undefined) {
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

    process.on('uncaughtException', function (err: Error) {
      console.log('Uncaught exception:', err.message, err.stack);
      throw err;
    });
  }
}
