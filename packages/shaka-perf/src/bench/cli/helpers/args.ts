/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export const harpath = {
  name: "harpath",
  required: true,
  description: "The path to the HTTP Archive File (HAR)",
};

export const resultsFile = {
  name: "resultsFile",
  required: true,
  description: `The "tracerbench compare" command json output file`,
};
