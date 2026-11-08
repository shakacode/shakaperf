/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportOutcome } from '../types';
import type { LoadedRunMetadata } from '../../../src/pipeline/run-metadata';

type Entry = { stage: string; metadata: LoadedRunMetadata };

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

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function unique(values: string[]) { return [...new Set(values)]; }

function Scope({ items, entries, runs, always = false }: { items: Entry[]; entries: Entry[]; runs: string[]; always?: boolean }) {
  if (!always && new Set(items).size === entries.length) return null;
  const scopes = groupValues(items, ({ stage, metadata }) => [metadata.runId, stage]);
  return <span className="target-commit__scope">{scopes.map(({ value: [runId, stage], items }) =>
    `${runs.length > 1 ? `Run ${runs.indexOf(runId!) + 1} / ` : ''}${stage} · ${unique(items.map((item) => item.metadata.viewport.label)).join(', ')}`,
  ).join(' / ')}</span>;
}

function CommitDetails({ commit }: { commit: Pick<NonNullable<LoadedRunMetadata['targets'][number]['commit']>, 'sha' | 'message'> }) {
  const [subject = '', ...body] = commit.message.split('\n');
  const heading = <><code title={commit.sha}>{commit.sha.slice(0, 8)}</code><span>{subject || (body.join('\n').trim() ? 'Commit message' : 'Empty commit message')}</span></>;
  if (!body.join('\n').trim()) return <div className="target-commit"><div className="target-commit__heading">{heading}</div></div>;
  return <details className="target-commit">
    <summary>{heading}</summary>
    <div className="target-commit__body">
      <pre>{body.join('\n')}</pre>
    </div>
  </details>;
}

export function TargetCommits({ outcomes, side }: { outcomes: readonly ReportOutcome[]; side?: 'control' | 'experiment' }) {
  const entries = outcomes.flatMap((outcome) => outcome.runMetadata
    ? [{ stage: outcome.stage, metadata: outcome.runMetadata }] : []);
  const runs = unique(entries.map(({ metadata }) => metadata.runId));
  const targets = entries.flatMap((entry) => entry.metadata.targets.map((target) => ({ entry, target })));
  const commits = groupValues(targets, ({ target }) => ({
    commit: target.commit ? { sha: target.commit.sha, message: target.commit.message } : null,
    side: side ? target.side : null,
  }));
  const rows = commits.filter(({ value }) => !side || value.side === side).map(({ value: { commit }, items }, index) => {
    const content = <>
      {commit ? <CommitDetails commit={commit} /> : <p className="target-commit__unavailable">Commit unavailable</p>}
      <Scope items={items.map(({ entry }) => entry)} entries={entries} runs={runs} />
    </>;
    return <div key={index}>
      {side ? null : <div className="metadata-label">{unique(items.map(({ target }) => target.side)).join(' / ')}</div>}
      {content}
    </div>;
  });
  return <div className={side ? 'card__target-commits' : 'target-commits'}>{rows}</div>;
}

