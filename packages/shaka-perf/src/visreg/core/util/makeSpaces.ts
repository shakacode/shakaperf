/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export default function makeSpaces (length: number) {
  let i = 0;
  let result = '';
  while (i < length) {
    result += ' ';
    i++;
  }
  return result;
}
