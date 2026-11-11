/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ChipDescriptor } from '../types';
import { TooltipLabel } from '../../../src/pipeline/report-tooltip';

export function Pill({ chip }: { chip: ChipDescriptor }) {
  return (
    <span className={`pill pill--${chip.color}`}>
      <span className="pill__label">
        {chip.tooltip ? <TooltipLabel label={chip.text} explanation={chip.tooltip} /> : chip.text}
      </span>
    </span>
  );
}
