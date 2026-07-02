/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ChipDescriptor } from '../types';

export function Pill({ chip }: { chip: ChipDescriptor }) {
  return (
    <span
      className={`pill pill--${chip.color}`}
      title={chip.tooltip ?? chip.text}
    >
      <span className="pill__label">{chip.text}</span>
    </span>
  );
}
