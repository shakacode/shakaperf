/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useRef, useState } from 'react';
import type { ReportOutcome } from '../types';
import type { ExecutionDetails } from '../../../src/pipeline/outcome';
import type { RunMetadata } from '../../../src/pipeline/run-metadata';

export function savedRunDetails(outcomes: readonly ReportOutcome[]) {
  const groups = new Map<string, Entry[]>();
  for (const outcome of outcomes) {
    if (!outcome.runMetadata) continue;
    const label = outcome.executionDetails.viewport.label;
    const entries = groups.get(label) ?? [];
    entries.push({ stage: outcome.stage, metadata: outcome.runMetadata, executionDetails: outcome.executionDetails });
    groups.set(label, entries);
  }
  return [...groups];
}

export function MeasurementCommand({ command, compact = false, autoSize = false, label }: {
  command: string;
  compact?: boolean;
  autoSize?: boolean;
  label?: string;
}) {
  const [status, setStatus] = useState('Copy command');
  const field = useRef<HTMLTextAreaElement>(null);
  const code = useRef<HTMLPreElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus('Copied');
    } catch {
      if (code.current) {
        code.current.focus();
        const range = document.createRange();
        range.selectNodeContents(code.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        field.current?.focus();
        field.current?.select();
      }
      setStatus('Command selected — copy manually');
    }
  }
  return (
    <div className={`run-details__command${compact ? ' run-details__command--compact' : ''}${autoSize ? ' run-details__command--auto-size' : ''}`}>
      {autoSize
        ? <pre aria-label={label ?? 'Measurement command'} ref={code} tabIndex={0}><code>{command}</code></pre>
        : <textarea aria-label={label ?? (compact ? 'Latest command' : 'Measurement command')} ref={field} value={command} readOnly rows={compact ? 1 : 2} />}
      <button type="button" onClick={copy} aria-label="Copy command" title={status}>{compact ? 'Copy' : status}</button>
      {compact || autoSize ? <span className="run-details__copy-status" role="status">{status === 'Copy command' ? '' : status}</span> : null}
    </div>
  );
}

type Entry = { stage: string; metadata: RunMetadata; executionDetails: ExecutionDetails };

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

function unique(values: string[]) { return [...new Set(values)]; }

function Scope({ items, entries, runs, always = false }: { items: Entry[]; entries: Entry[]; runs: string[]; always?: boolean }) {
  if (!always && new Set(items).size === entries.length) return null;
  const scopes = groupValues(items, ({ stage, executionDetails }) => [executionDetails.runId, stage]);
  return <span className="run-details__scope">{scopes.map(({ value: [runId, stage], items }) =>
    `${runs.length > 1 ? `Run ${runs.indexOf(runId!) + 1} / ` : ''}${stage} · ${unique(items.map((item) => item.executionDetails.viewport.label)).join(', ')}`,
  ).join(' / ')}</span>;
}

function CommitDetails({ commit }: { commit: Pick<NonNullable<RunMetadata['targets'][number]['commit']>, 'sha' | 'message'> }) {
  const [subject = '', ...body] = commit.message.split('\n');
  const heading = <><code title={commit.sha}>{commit.sha.slice(0, 8)}</code><span>{subject || (body.join('\n').trim() ? 'Commit message' : 'Empty commit message')}</span></>;
  if (!body.join('\n').trim()) return <div className="run-details__commit"><div className="run-details__commit-heading">{heading}</div></div>;
  return <details className="run-details__commit">
    <summary>{heading}</summary>
    <div className="run-details__commit-body">
      <pre>{body.join('\n')}</pre>
    </div>
  </details>;
}

export function RunCommits({ outcomes, side }: { outcomes: readonly ReportOutcome[]; side?: 'control' | 'experiment' }) {
  const entries = savedRunDetails(outcomes).flatMap(([, items]) => items);
  const runs = unique(entries.map(({ executionDetails }) => executionDetails.runId));
  const targets = entries.flatMap((entry) => entry.metadata.targets.map((target) => ({ entry, target })));
  const commits = groupValues(targets, ({ target }) => ({
    commit: target.commit ? { sha: target.commit.sha, message: target.commit.message } : null,
    side: side ? target.side : null,
  }));
  const rows = commits.filter(({ value }) => !side || value.side === side).map(({ value: { commit }, items }, index) => {
    const content = <>
      {commit ? <CommitDetails commit={commit} /> : <p className="run-details__unavailable">Commit unavailable</p>}
      <Scope items={items.map(({ entry }) => entry)} entries={entries} runs={runs} />
    </>;
    return <div key={index}>
      {side ? null : <div className="run-details__label">{unique(items.map(({ target }) => target.side)).join(' / ')}</div>}
      {content}
    </div>;
  });
  return <div className={side ? 'card__target-commits' : 'run-details__commits'}>{rows}</div>;
}
