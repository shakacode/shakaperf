/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import chalk from 'chalk';
import _ from 'lodash';
import { colorizedLogPrefix } from './testContext';

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
  console.log(colorizedLogPrefix(subject) + typeToColor[colorKey](string));
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
