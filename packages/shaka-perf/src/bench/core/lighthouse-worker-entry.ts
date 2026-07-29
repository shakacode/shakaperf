/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { installWorkerLogForwarder } from './worker-log';

// Keep this file as the fork entrypoint. Install logging before loading the
// real worker so import-time console/process stdio output is forwarded too.
installWorkerLogForwarder();

require('./lighthouse-worker');
