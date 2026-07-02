/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import executeCommand from './command/index';
import makeConfig from './util/makeConfig';
import type { RuntimeConfig } from './types';

export default async function (command: string, options?: Record<string, unknown>) {
  const config = await makeConfig(command, options) as RuntimeConfig;
  return executeCommand(command, config);
}
