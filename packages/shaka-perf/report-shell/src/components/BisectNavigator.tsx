/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useCallback, useState } from 'react';
import { Dialog } from '../../../src/pipeline/stage-report-components';
import type {
  BisectReportCommit,
  BisectReportCounts,
  BisectReportModel,
} from '../types';
import type { BisectSelection } from '../bisect-selection';
import { MergeInvestigationDialog } from './MergeInvestigationDialog';

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

function hasRegressions(commit: BisectReportCommit): boolean {
  return Object.values(commit.counts).some((count) => count > 0);
}

const mergeInvestigationLabels: Record<
  NonNullable<BisectReportCommit['mergeInvestigationStatus']>,
  string
> = {
  'merge-uninvestigated': 'not started',
  running: 'running',
  complete: 'complete',
  'octopus-unsupported': 'unsupported',
  failed: 'failed',
};

type CommitTimelineItem =
  | { kind: 'clean-run'; commits: BisectReportCommit[] }
  | { kind: 'regression'; commit: BisectReportCommit };

function buildCommitTimeline(commits: readonly BisectReportCommit[]): CommitTimelineItem[] {
  const items: CommitTimelineItem[] = [];
  for (const commit of commits) {
    const previous = items.at(-1);
    if (!hasRegressions(commit)) {
      if (previous?.kind === 'clean-run') previous.commits.push(commit);
      else items.push({ kind: 'clean-run', commits: [commit] });
    } else {
      items.push({ kind: 'regression', commit });
    }
  }
  return items;
}

function CleanCommitGroup({
  commits,
  model,
  runIndex,
}: {
  commits: readonly BisectReportCommit[];
  model: BisectReportModel;
  runIndex: number;
}) {
  const [open, setOpen] = useState(false);
  const measuredCount = commits.filter((commit) => commit.measured).length;
  const commitLabel = `${commits.length} commit${commits.length === 1 ? '' : 's'}`;
  const firstCommit = commits[0];
  const lastCommit = commits.at(-1);

  return (
    <li className="bisect-tree__item bisect-tree__item--clean-run">
      <button
        type="button"
        className="bisect-clean-run"
        data-bisect-clean-run={runIndex}
        aria-haspopup="dialog"
        aria-label={`${commitLabel} with no first-bad regressions`}
        onClick={() => setOpen(true)}
      >
        <strong>[{commitLabel}]</strong>
        <span>no first-bad regressions</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        variant="compact"
        title={<span className="ui-dialog__title-text">{commitLabel} with no first-bad regressions</span>}
        meta={(
          <dl className="ui-dialog__meta">
            <div>
              <dt>range</dt>
              <dd>{firstCommit?.sha.slice(0, 7)} → {lastCommit?.sha.slice(0, 7)}</dd>
            </div>
            <div>
              <dt>measurement</dt>
              <dd>{measuredCount} measured · {commits.length - measuredCount} not measured</dd>
            </div>
          </dl>
        )}
      >
        <div className="bisect-clean-run-dialog" data-bisect-clean-run-dialog={runIndex}>
          <ol className="bisect-clean-run-dialog__list">
          {commits.map((commit) => {
            const endpoint = endpointLabel(commit, model);
            return (
              <li key={commit.sha} className="bisect-clean-run-dialog__commit">
                <code>{commit.sha.slice(0, 7)}</code>
                <span>{commit.subject}</span>
                <span className="bisect-clean-run-dialog__meta">
                  {endpoint ? `${endpoint} · ` : ''}
                  {commit.measured ? 'measured' : 'not measured'}
                </span>
              </li>
            );
          })}
        </ol>
        </div>
      </Dialog>
    </li>
  );
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
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const handleClick = useCallback(
    () => {
      onSelect({ kind: 'commit', sha: commit.sha });
      if (commit.isMerge) setMergeDialogOpen(true);
    },
    [commit.isMerge, commit.sha, onSelect],
  );
  const handleMergeDialogClose = useCallback(() => setMergeDialogOpen(false), []);
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
        aria-haspopup={commit.isMerge ? 'dialog' : undefined}
        onClick={handleClick}
      >
        <span className="bisect-node__meta">
          {endpoint ? <span className="bisect-node__endpoint">{endpoint}</span> : null}
          {commit.isMerge ? <span className="bisect-node__merge">merge</span> : null}
          {commit.isMerge && commit.mergeInvestigationStatus ? (
            <span
              className="bisect-node__investigation"
              data-merge-investigation-status={commit.mergeInvestigationStatus}
            >
              investigation: {mergeInvestigationLabels[commit.mergeInvestigationStatus]}
            </span>
          ) : null}
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
      {commit.isMerge ? (
        <MergeInvestigationDialog
          commit={commit}
          targetsById={model.targetsById}
          open={mergeDialogOpen}
          onClose={handleMergeDialogClose}
        />
      ) : null}
    </li>
  );
}

export function BisectNavigator({ model, selection, onSelect }: Props) {
  const foundCount = model.targets.filter((target) => target.status === 'found').length;
  const unresolvedCount = model.views.unresolved.targetIds.length;
  const invalidCount = model.views.invalid.targetIds.length;
  const commitTimeline = buildCommitTimeline(model.commits);
  let cleanRunIndex = -1;

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
          label="Regression tests"
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
          {commitTimeline.map((item) => {
            if (item.kind === 'clean-run') {
              cleanRunIndex += 1;
              return (
                <CleanCommitGroup
                  key={`clean-${item.commits[0]?.sha}`}
                  commits={item.commits}
                  model={model}
                  runIndex={cleanRunIndex}
                />
              );
            }
            const { commit } = item;
            return (
              <CommitNode
                key={commit.sha}
                commit={commit}
                model={model}
                selected={selection.kind === 'commit' && selection.sha === commit.sha}
                onSelect={onSelect}
              />
            );
          })}
        </ol>
      </nav>
    </section>
  );
}
