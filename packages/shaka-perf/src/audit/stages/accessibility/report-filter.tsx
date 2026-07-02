/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useCloseOnOutsideInteraction } from '../../../pipeline/use-close-on-outside-interaction';
import { ACCESSIBILITY_FILTER_CSS } from './report-styles';
import {
  defaultAccessibilityFilterSelection,
  hasAccessibilityFilterOptions,
  type AccessibilityFilterOptions,
  type AccessibilityFilterSelection,
  type FilterOption,
} from './report-utils';

export interface AccessibilityFilterState {
  options: AccessibilityFilterOptions;
  selection: AccessibilityFilterSelection;
  setSelection: (selection: AccessibilityFilterSelection) => void;
}

const AccessibilityFilterContext = createContext<AccessibilityFilterState | null>(null);

export function AccessibilityReportFilterProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AccessibilityFilterState | null;
}) {
  return (
    <AccessibilityFilterContext.Provider value={value}>
      {children}
    </AccessibilityFilterContext.Provider>
  );
}

export function AccessibilityGlobalFilter({ state }: { state: AccessibilityFilterState | null }) {
  if (!state || !hasAccessibilityFilterOptions(state.options)) return null;
  return (
    <>
      <style>{ACCESSIBILITY_FILTER_CSS}</style>
      <AccessibilityFilter
        options={state.options}
        selection={state.selection}
        setSelection={state.setSelection}
        title="accessibility filters"
        variant="popover"
      />
    </>
  );
}

export function useAccessibilityFilterState(): AccessibilityFilterState | null {
  return useContext(AccessibilityFilterContext);
}

export function AccessibilityFilter({
  defaultOpen = false,
  extraActions,
  options,
  selection,
  setSelection,
  title,
  variant,
}: {
  defaultOpen?: boolean;
  extraActions?: ReactNode;
  options: AccessibilityFilterOptions;
  selection: AccessibilityFilterSelection;
  setSelection: (selection: AccessibilityFilterSelection) => void;
  title: string;
  variant: 'panel' | 'popover';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const totalCount = options.rules.length + options.tags.length;
  const selectedCount =
    options.rules.filter((option) => selection.rules.has(option.value)).length +
    options.tags.filter((option) => selection.tags.has(option.value)).length;
  const muted = selectedCount < totalCount;

  useCloseOnOutsideInteraction({ onClose: close, open, rootRef });

  return (
    <div className="a11y-filter" data-variant={variant} ref={rootRef}>
      <button
        type="button"
        className="a11y-filter__button"
        data-muted={muted ? 'true' : 'false'}
        data-open={open ? 'true' : 'false'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {title} · {selectedCount}/{totalCount}
      </button>
      {open ? (
        <div className="a11y-filter__menu">
          <div className="a11y-filter__actions">
            <button
              type="button"
              onClick={() => setSelection(defaultAccessibilityFilterSelection(options))}
            >
              all
            </button>
            <button
              type="button"
              onClick={() => setSelection({ rules: new Set(), tags: new Set() })}
            >
              none
            </button>
            {extraActions}
            <button
              type="button"
              className="a11y-filter__close"
              aria-label="close accessibility filters"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {options.rules.length > 0 ? (
            <FilterSection
              kind="rule"
              options={options.rules}
              selected={selection.rules}
              setSelected={(rules) => setSelection({ ...selection, rules })}
              title="Included rules"
            />
          ) : null}
          {options.tags.length > 0 ? (
            <FilterSection
              kind="tag"
              options={options.tags}
              selected={selection.tags}
              setSelected={(tags) => setSelection({ ...selection, tags })}
              title="Configured tags"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FilterSection({
  kind,
  options,
  selected,
  setSelected,
  title,
}: {
  kind: 'rule' | 'tag';
  options: readonly FilterOption[];
  selected: ReadonlySet<string>;
  setSelected: (values: Set<string>) => void;
  title: string;
}) {
  return (
    <div className="a11y-filter__section">
      <div className="a11y-filter__section-title">{title}</div>
      <div className="a11y-filter__rows">
      {options.map((option) => (
        <label key={`${kind}:${option.value}`} className="a11y-filter__row" title={option.value}>
          <input
            type="checkbox"
            checked={selected.has(option.value)}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.currentTarget.checked) next.add(option.value);
              else next.delete(option.value);
              setSelected(next);
            }}
          />
          <span className="a11y-filter__label">{option.value}</span>
          <span className="a11y-filter__count">
            {option.count}
          </span>
        </label>
      ))}
      </div>
    </div>
  );
}

export function FilteredEmptyState({ totalViolationCount }: { totalViolationCount: number }) {
  return (
    <div className="a11y-filtered-empty">
      {totalViolationCount} accessibility finding{totalViolationCount === 1 ? '' : 's'} hidden by the current accessibility filter.
    </div>
  );
}
