import { createRequire } from 'node:module';
import makeSpaces from '../core/util/makeSpaces.js';

const _require = createRequire(import.meta.url);
const packageJson = _require('../package.json');
const { version } = packageJson;

const commandsDescription = {
  init: 'Generate boilerplate config files in your CWD.',
  liveCompare: 'Open reference and test URLs simultaneously, compare side-by-side with retry logic.',
  openReport: 'View the last test report in your browser.'
};

const optionsDescription = {
  '--config': 'Path to config file name',
  '--filter': 'A RegEx string used to filter scenarios by label',
  '-h, --help': 'Display usage',
  '-v, --version': 'Display version'
};

function makeDescription (descriptions) {
  return Object.keys(descriptions)
    .map(function (commandName) {
      return makeSpaces(4) + commandName + spacesBetweenCommandAndDescription(commandName) + descriptions[commandName];
    })
    .join('\n');
}

// Number of spaces to echo before writing description
const leftPaddingOfDescription = Object.keys(commandsDescription)
  .concat(Object.keys(optionsDescription))
  .map(function (string) {
    return string.length;
  })
  .reduce(function maxReducer (max, length) {
    return Math.max(max, length);
  }, 0);

function spacesBetweenCommandAndDescription (commandName) {
  return makeSpaces(2 + leftPaddingOfDescription - commandName.length);
}

const usage = '\
Welcome to shaka-visreg ' + version + ' CLI\n\
\n\
Commands:\n\
' + makeDescription(commandsDescription) + '\n\
\n\
Options:\n\
' + makeDescription(optionsDescription) + '\n\
\n';

export default usage;
