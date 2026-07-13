/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useCallback } from 'react';
import type {
  BisectReportCommit,
  BisectReportCounts,
  BisectReportModel,
} from '../types';
import type { BisectSelection } from '../bisect-selection';

interface Props {
  model: BisectReportModel;
  selection: BisectSelection;
  onSelect: (selection: BisectSelection) => void;
}

interface SelectionButtonProps {
  kind: 'all' | 'unresolved' | 'invalid';
  label: string;
  count: number;
  selected: boolean;
  onSelect: (selection: BisectSelection) => void;
}

function pluralizeTargets(count: number): string {
  return `${count} target${count === 1 ? '' : 's'}`;
}

function SelectionButton({
  kind,
  label,
  count,
  selected,
  onSelect,
}: SelectionButtonProps) {
  const handleClick = useCallback(() => onSelect({ kind }), [kind, onSelect]);

  return (
    <button
      type="button"
      className="bisect-view-button"
      data-bisect-selection={kind}
      aria-pressed={selected}
      onClick={handleClick}
    >
      <span className="bisect-view-button__label">{label}</span>
      <span className="bisect-view-button__count">{pluralizeTargets(count)}</span>
    </button>
  );
}

function Counter({
  category,
  count,
  label,
}: {
  category: keyof BisectReportCounts;
  count: number;
  label: string;
}) {
  return (
    <span
      className={`bisect-counter bisect-counter--${category}`}
      data-category={category}
    >
      <span className="bisect-counter__label">{label}</span>
      <strong>{count}</strong>
    </span>
  );
}

function endpointLabel(commit: BisectReportCommit, model: BisectReportModel): string | null {
  const isGood = commit.sha === model.goodSha;
  const isBad = commit.sha === model.badSha;
  if (isGood && isBad) return 'good + bad endpoint';
  if (isGood) return 'good endpoint';
  if (isBad) return 'bad endpoint';
  return null;
}

function CommitNode({
  commit,
  model,
  selected,
  onSelect,
}: {
  commit: BisectReportCommit;
  model: BisectReportModel;
  selected: boolean;
  onSelect: (selection: BisectSelection) => void;
}) {
  const handleClick = useCallback(
    () => onSelect({ kind: 'commit', sha: commit.sha }),
    [commit.sha, onSelect],
  );
  const endpoint = endpointLabel(commit, model);

  return (
    <li
      className="bisect-tree__item"
      data-empty={commit.targetIds.length === 0 ? 'true' : undefined}
      data-endpoint={endpoint ?? undefined}
    >
      <button
        type="button"
        className="bisect-node"
        data-bisect-selection="commit"
        data-bisect-sha={commit.sha}
        data-measured={commit.measured ? 'true' : 'false'}
        aria-pressed={selected}
        onClick={handleClick}
      >
        <span className="bisect-node__meta">
          {endpoint ? <span className="bisect-node__endpoint">{endpoint}</span> : null}
          <span className="bisect-node__measurement">
            {commit.measured ? 'measured' : 'not measured'}
          </span>
        </span>
        <code className="bisect-node__sha">{commit.sha.slice(0, 7)}</code>
        <span className="bisect-node__subject">{commit.subject}</span>
        <span className="bisect-node__counters">
          <Counter category="visreg" count={commit.counts.visreg} label="visual" />
          <Counter category="perf" count={commit.counts.perf} label="performance" />
          <Counter
            category="accessibility"
            count={commit.counts.accessibility}
            label="accessibility"
          />
        </span>
      </button>
    </li>
  );
}

export function BisectNavigator({ model, selection, onSelect }: Props) {
  const foundCount = model.targets.filter((target) => target.status === 'found').length;
  const unresolvedCount = model.views.unresolved.targetIds.length;
  const invalidCount = model.views.invalid.targetIds.length;

  return (
    <section className="bisect-navigator" aria-labelledby="bisect-navigator-title">
      <header className="bisect-navigator__header">
        <div>
          <p className="bisect-navigator__eyebrow">first-bad commit search</p>
          <h2 id="bisect-navigator-title">bisect navigator</h2>
        </div>
        <dl className="bisect-navigator__stats">
          <div>
            <dt>range</dt>
            <dd>
              <code>{model.goodSha.slice(0, 7)}</code>
              <span aria-hidden="true"> → </span>
              <code>{model.badSha.slice(0, 7)}</code>
            </dd>
          </div>
          <div>
            <dt>session</dt>
            <dd>{model.status}</dd>
          </div>
          <div>
            <dt>found</dt>
            <dd>{foundCount}</dd>
          </div>
        </dl>
      </header>

      <nav className="bisect-view-buttons" aria-label="Bisect report views">
        <SelectionButton
          kind="all"
          label="All regressions"
          count={foundCount}
          selected={selection.kind === 'all'}
          onSelect={onSelect}
        />
        <SelectionButton
          kind="unresolved"
          label="Unresolved"
          count={unresolvedCount}
          selected={selection.kind === 'unresolved'}
          onSelect={onSelect}
        />
        <SelectionButton
          kind="invalid"
          label="Invalid"
          count={invalidCount}
          selected={selection.kind === 'invalid'}
          onSelect={onSelect}
        />
      </nav>

      <nav className="bisect-tree" aria-label="Bisect commit range">
        <ol className="bisect-tree__list">
          {model.commits.map((commit) => (
            <CommitNode
              key={commit.sha}
              commit={commit}
              model={model}
              selected={selection.kind === 'commit' && selection.sha === commit.sha}
              onSelect={onSelect}
            />
          ))}
        </ol>
      </nav>
    </section>
  );
}
