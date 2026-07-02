/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ChipDescriptor } from '../types';

export type SortDirection = 'worst' | 'best';

export interface SortChipOption {
  tag: string;
  label: string;
  color?: ChipDescriptor['color'];
}

interface Props {
  options: readonly SortChipOption[];
  active: { tag: string; dir: SortDirection } | null;
  onSelect: (tag: string) => void;
}

/**
 * A "Sort by" row that sits on its own line under the filter chips and is
 * right-aligned to match them (reuses the `.filterbar` styling). Clicking a
 * dimension cycles off → worst-first → best-first → off. The direction arrow
 * (▼ worst-first, ▲ best-first) lives in a fixed-width slot so toggling never
 * changes a chip's size or reflows the row.
 */
export function SortChips({ options, active, onSelect }: Props) {
  if (options.length === 0) return null;
  return (
    <div className="filterbar-wrap">
      <div className="filterbar">
        <span className="filterbar__label">
          sort by:
        </span>
        {options.map(({ tag, label, color }) => {
          const isActive = active?.tag === tag;
          const arrow = isActive ? (active.dir === 'worst' ? '▼' : '▲') : '';
          const title = isActive
            ? `sorting by ${label}, ${active.dir === 'worst' ? 'worst first' : 'best first'} — ` +
              `click to ${active.dir === 'worst' ? 'flip to best first' : 'turn off'}`
            : `sort by ${label} (worst first)`;
          return (
            <button
              key={tag}
              type="button"
              data-active={isActive ? 'true' : 'false'}
              data-chip-color={color ?? 'gray'}
              title={title}
              onClick={() => onSelect(tag)}
            >
              {label}
              {/* Fixed-width slot: the arrow toggling on click must not resize
                  the chip or reflow the row. */}
              <span className="sort-chip__arrow">
                {arrow}
              </span>
            </button>
          );
        })}
      </div>
      <div className="filterbar__hint">click cycles worst-first → best-first → off</div>
    </div>
  );
}
