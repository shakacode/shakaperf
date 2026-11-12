/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportOutcome } from '../types';
import type { ExecutionDetails } from '../../../src/pipeline/outcome';
import type { RunMetadata } from '../../../src/pipeline/run-metadata';

type Entry = {
  stage: string;
  metadata: RunMetadata;
  executionDetails: ExecutionDetails;
};
type Commit = Pick<NonNullable<RunMetadata['targets'][number]['commit']>, 'sha' | 'message'>;

function groupValues<T, V>(items: readonly T[], select: (item: T) => V) {
  const groups = new Map<string, { value: V; items: T[] }>();
  for (const item of items) {
    const value = select(item);
    const key = JSON.stringify(value);
    const group = groups.get(key) ?? { value, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function Scope({ items, entries, runs }: { items: Entry[]; entries: Entry[]; runs: string[] }) {
  if (new Set(items).size === entries.length) return null;
  const scopes = groupValues(items, ({ stage, executionDetails }) => ({
    runId: executionDetails.runId,
    stage,
  }));
  const labels = scopes.map(({ value: { runId, stage }, items }) => {
    const runLabel = runs.length > 1 ? `Run ${runs.indexOf(runId) + 1} / ` : '';
    const viewportLabels = unique(items.map(item => item.executionDetails.viewport.label));
    return `${runLabel}${stage} · ${viewportLabels.join(', ')}`;
  });
  return <span className="target-commit__scope">{labels.join(' / ')}</span>;
}

function CommitDetails({ commit }: { commit: Commit }) {
  const [subject = '', ...bodyLines] = commit.message.split('\n');
  const body = bodyLines.join('\n');
  const hasBody = body.trim().length > 0;
  const title = subject || (hasBody ? 'Commit message' : 'Empty commit message');
  const heading = <>
    <code title={commit.sha}>{commit.sha.slice(0, 8)}</code>
    <span>{title}</span>
  </>;

  if (!hasBody) {
    return <div className="target-commit">
      <div className="target-commit__heading">{heading}</div>
    </div>;
  }
  return <details className="target-commit">
    <summary>{heading}</summary>
    <div className="target-commit__body"><pre>{body}</pre></div>
  </details>;
}

export function TargetCommits({ outcomes, side }: {
  outcomes: readonly ReportOutcome[];
  side?: 'control' | 'experiment';
}) {
  const entries: Entry[] = [];
  for (const outcome of outcomes) {
    if (!outcome.runMetadata) continue;
    entries.push({
      stage: outcome.stage,
      metadata: outcome.runMetadata,
      executionDetails: outcome.executionDetails,
    });
  }
  const runs = unique(entries.map(entry => entry.executionDetails.runId));
  const targets = entries.flatMap(entry => entry.metadata.targets.map(target => ({ entry, target })));
  const selectedTargets = targets.filter(({ target }) => !side || target.side === side);
  const commits = groupValues(selectedTargets, ({ target }) => {
    if (!target.commit) return null;
    return { sha: target.commit.sha, message: target.commit.message };
  });

  return <div className={side ? 'card__target-commits' : 'target-commits'}>
    {commits.map(({ value: commit, items }, index) => (
      <div key={index}>
        {!side ? <div className="metadata-label">
          {unique(items.map(({ target }) => target.side)).join(' / ')}
        </div> : null}
        {commit ? <CommitDetails commit={commit} /> : <p className="target-commit__unavailable">Commit unavailable</p>}
        <Scope items={items.map(({ entry }) => entry)} entries={entries} runs={runs} />
      </div>
    ))}
  </div>;
}
