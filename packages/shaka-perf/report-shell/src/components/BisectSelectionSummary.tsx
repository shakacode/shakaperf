/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { selectionTargetIds, type BisectSelection } from '../bisect-selection';
import type { BisectReportModel, BisectReportTarget } from '../types';

interface Props {
  model: BisectReportModel;
  selection: BisectSelection;
}

function selectionTitle(selection: BisectSelection): string {
  if (selection.kind === 'all') return 'All regressions';
  if (selection.kind === 'commit') return `Commit ${selection.sha.slice(0, 7)}`;
  if (selection.kind === 'unresolved') return 'Unresolved targets';
  return 'Invalid targets';
}

function emptyMessage(selection: BisectSelection): string {
  if (selection.kind === 'commit') return 'No regressions begin at this commit.';
  if (selection.kind === 'unresolved') return 'No unresolved regression targets.';
  if (selection.kind === 'invalid') return 'No invalid regression targets.';
  return 'No regression targets were discovered.';
}

function categoryLabel(target: BisectReportTarget): string {
  if (target.category === 'visreg') return 'visual';
  if (target.category === 'perf') return 'performance';
  return 'accessibility';
}

function formatValue(value: string | number | boolean | null): string {
  return value == null ? 'null' : String(value);
}

function TargetRow({ target }: { target: BisectReportTarget }) {
  const values = Object.entries(target.badRefObservation?.values ?? {});

  return (
    <li className="bisect-target" data-category={target.category} data-target-id={target.id}>
      <article>
        <header className="bisect-target__header">
          <span className={`bisect-target__category bisect-target__category--${target.category}`}>
            {categoryLabel(target)}
          </span>
          <h3 className="bisect-target__subject">{target.subject}</h3>
        </header>
        <dl className="bisect-target__details">
          <div>
            <dt>test</dt>
            <dd>
              <span>{target.testName}</span>
              <code>{target.testFile}</code>
            </dd>
          </div>
          <div>
            <dt>viewport</dt>
            <dd>{target.viewport}</dd>
          </div>
          <div>
            <dt>card</dt>
            <dd>{target.testId ?? 'not mapped'}</dd>
          </div>
          {target.invalidReason ? (
            <div className="bisect-target__invalid-reason">
              <dt>invalid reason</dt>
              <dd>{target.invalidReason}</dd>
            </div>
          ) : null}
        </dl>
        {values.length > 0 ? (
          <dl className="bisect-target__values" aria-label="Bad reference values">
            {values.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </article>
    </li>
  );
}

export function BisectSelectionSummary({ model, selection }: Props) {
  const targetIds = selectionTargetIds(model, selection);
  const targets = [...targetIds]
    .map((targetId) => model.targetsById[targetId])
    .filter((target): target is BisectReportTarget => target != null);

  return (
    <section
      className="bisect-selection-summary"
      data-selection-kind={selection.kind}
      aria-labelledby="bisect-selection-title"
    >
      <header className="bisect-selection-summary__header">
        <h2 id="bisect-selection-title">{selectionTitle(selection)}</h2>
        <span
          className="bisect-selection-summary__status"
          aria-live="polite"
          aria-atomic="true"
        >
          {targets.length} selected {targets.length === 1 ? 'target' : 'targets'}
        </span>
      </header>
      {targets.length === 0 ? (
        <p className="bisect-selection-summary__empty">{emptyMessage(selection)}</p>
      ) : (
        <ul className="bisect-target-list">
          {targets.map((target) => <TargetRow key={target.id} target={target} />)}
        </ul>
      )}
    </section>
  );
}
