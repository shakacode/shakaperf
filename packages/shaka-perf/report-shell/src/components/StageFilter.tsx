/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useCallback, useRef, useState } from 'react';
import { useCloseOnOutsideInteraction } from '../../../src/pipeline/use-close-on-outside-interaction';

export interface StageFilterOption {
  stage: string;
  label: string;
  count: number;
  disabled: boolean;
}

export type StageFilterSelectionUpdate =
  | Set<string>
  | ((previous: ReadonlySet<string>) => Set<string>);

interface Props {
  options: readonly StageFilterOption[];
  selected: ReadonlySet<string>;
  onChange: (update: StageFilterSelectionUpdate) => void;
}

export function toggleStageInSelection(
  previous: ReadonlySet<string>,
  stage: string,
  checked: boolean,
): Set<string> {
  const next = new Set(previous);
  if (checked) next.add(stage);
  else next.delete(stage);
  return next;
}

export function StageFilter({ options, selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDetailsElement | null>(null);
  const close = useCallback(() => {
    rootRef.current?.removeAttribute('open');
    setOpen(false);
  }, []);
  useCloseOnOutsideInteraction({ onClose: close, open, rootRef });

  if (options.length === 0) return null;
  const enabledOptions = options.filter((option) => !option.disabled);
  const selectedCount = enabledOptions.filter((option) => selected.has(option.stage)).length;

  return (
    <details
      className="stage-filter"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      ref={rootRef}
    >
      <summary>
        report sections filter · {selectedCount}/{options.length}
      </summary>
      <div className="stage-filter__menu">
        <div className="stage-filter__actions">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onChange(new Set(enabledOptions.map((option) => option.stage)));
            }}
          >
            all
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onChange(new Set());
            }}
            disabled={enabledOptions.length === 0}
          >
            none
          </button>
        </div>
        {options.map((option) => (
          <label
            key={option.stage}
            className="stage-filter__row"
            data-disabled={option.disabled ? 'true' : undefined}
            title={option.disabled ? `${option.stage} is not present in this report` : option.stage}
          >
            <input
              type="checkbox"
              checked={!option.disabled && selected.has(option.stage)}
              disabled={option.disabled}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                onChange((previous) => toggleStageInSelection(previous, option.stage, checked));
              }}
            />
            <span className="stage-filter__label">{option.label}</span>
            <span className="stage-filter__count">{option.count}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
