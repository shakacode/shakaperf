import chalk from 'chalk';
import _ from 'lodash';
import { formatLogPrefix } from './testContext';

function identity (string: string) { return string; }

const typeToColor = {
  error: identity,
  warn: identity,
  log: identity,
  info: identity,
  debug: identity,
  success: identity
};

function message (type: string, subject: string, string: string) {
  if (!_.has(typeToColor, type)) {
    type = 'info';
    console.log(typeToColor.warn('Type ' + type + ' is not defined as logging type'));
  }

  const colorKey = type as keyof typeof typeToColor;
  console.log(formatLogPrefix(subject) + typeToColor[colorKey](string));
}

export default function createLogger (subject: string) {
  return {
    error: message.bind(null, 'error', subject),
    warn: message.bind(null, 'warn', subject),
    log: message.bind(null, 'log', subject),
    info: message.bind(null, 'info', subject),
    debug: message.bind(null, 'debug', subject),
    success: message.bind(null, 'success', subject)
  };
}
