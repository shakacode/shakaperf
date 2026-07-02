/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ChipDescriptor } from '../types';

export interface ChipFilterOption {
  key: string;
  chip: ChipDescriptor;
  count: number;
}

interface Props {
  active: ReadonlySet<string>;
  filters: readonly ChipFilterOption[];
  onSelect: (key: string, additive: boolean) => void;
}

export function ChipFilter({ active, filters, onSelect }: Props) {
  return (
    <div className="filterbar-wrap">
      <div className="filterbar">
        {filters.map(({ key, chip, count }) => {
          const label = filterLabelFor(chip.tag, count);
          return (
            <button
              key={key}
              type="button"
              data-active={active.has(key) ? 'true' : 'false'}
              data-chip-color={chip.color}
              title={chip.tooltip}
              onClick={(event) => onSelect(key, event.ctrlKey || event.metaKey)}
            >
              {label} · {count}
            </button>
          );
        })}
      </div>
      <div className="filterbar__hint">click isolates a tag; ctrl/cmd-click toggles</div>
    </div>
  );
}

function filterLabelFor(tag: string, count: number): string {
  if (count === 1) return tag;
  if (tag === 'accessibility finding') return 'accessibility findings';
  if (tag === 'accessibility violation') return 'accessibility violations';
  return tag;
}
