/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import { useRef, useState } from 'react';
import type { ReportOutcome } from '../types';
import { Dialog } from '../../../src/pipeline/stage-report-components';
import type { LoadedRunMetadata } from '../../../src/pipeline/run-metadata';

export function savedRunDetails(outcomes: readonly ReportOutcome[]) {
  const groups = new Map<string, Entry[]>();
  for (const outcome of outcomes) {
    if (!outcome.runMetadata) continue;
    const label = outcome.viewport.label;
    const entries = groups.get(label) ?? [];
    entries.push({ stage: outcome.stage, metadata: outcome.runMetadata, recoveredAfterRetries: outcome.recoveredAfterRetries });
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

type Entry = { stage: string; metadata: LoadedRunMetadata; recoveredAfterRetries?: boolean };

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
  return <span className="run-details__scope">{scopes.map(({ value: [runId, stage], items }) =>
    `${runs.length > 1 ? `Run ${runs.indexOf(runId!) + 1} / ` : ''}${stage} · ${unique(items.map((item) => item.metadata.viewport.label)).join(', ')}`,
  ).join(' / ')}</span>;
}

function CommitDetails({ commit }: { commit: Pick<NonNullable<LoadedRunMetadata['targets'][number]['commit']>, 'sha' | 'message'> }) {
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
  const runs = unique(entries.map(({ metadata }) => metadata.runId));
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

const NETWORK_LABELS: Record<string, string> = {
  rttMs: 'ms RTT', requestLatencyMs: 'ms latency', throughputKbps: 'kbps',
  downloadThroughputKbps: 'kbps down', uploadThroughputKbps: 'kbps up',
};

export function RunDetailsContent({ outcomes }: { outcomes: readonly ReportOutcome[] }) {
  const entries = savedRunDetails(outcomes).flatMap(([, items]) => items);
  const runs = unique(entries.map(({ metadata }) => metadata.runId));
  const targets = entries.flatMap((entry) => entry.metadata.targets.map((target) => ({ entry, target })));
  const sampling = groupValues(entries.filter(({ stage, metadata }) => stage === 'perf' && metadata.numberOfMeasurements !== undefined), ({ metadata }) => ({
    count: metadata.numberOfMeasurements!, perSide: metadata.targets.length > 1,
  }));
  const settings = groupValues(entries.flatMap((entry) => (entry.metadata.throttling ?? []).filter((setting) => setting.engine === 'Lighthouse').map((setting) => ({ entry, setting }))), ({ setting }) => ({
    engine: setting.engine, method: setting.method, cpu: setting.method === 'provided' ? undefined : setting.cpuSlowdownMultiplier,
    network: Object.entries(setting.network).sort(([a], [b]) => a.localeCompare(b)),
  }));
  const scope = (items: Entry[]) => <Scope items={items} entries={entries} runs={runs} />;
  return <div className="run-details">
    {sampling.length ? <section className="run-details__section">
      <h3>Sampling</h3>
      <div className="run-details__settings">
        {sampling.map(({ value, items }) => <div className="run-details__setting" key={`samples-${value.count}-${value.perSide}`}>
          <strong>{value.count} LH {value.count === 1 ? 'sample' : 'samples'}{value.perSide ? ' per side' : ''}</strong>
          {scope(items)}
        </div>)}
      </div>
    </section> : null}
    {settings.length ? <section className="run-details__section">
      <h3>Throttling</h3>
      <div className="run-details__settings">{settings.map(({ value, items }, index) => <div className="run-details__setting" key={index}>
        <div className="run-details__setting-head"><strong>{value.engine}</strong>{unique(items.map(({ setting }) => setting.side ?? '')).filter(Boolean).length === 1 && unique(targets.map(({ target }) => target.side)).length > 1 ? <span>{items[0]!.setting.side}</span> : null}{value.cpu !== undefined ? <span>{value.cpu}× CPU</span> : null}<span>{value.method}</span></div>
        <div className="run-details__network">{value.network.length ? value.network.map(([key, amount]) => <span key={key}>{amount.toLocaleString('en-US')} {NETWORK_LABELS[key] ?? key}</span>) : <span>No network emulation</span>}</div>
        {scope(items.map(({ entry }) => entry))}
      </div>)}</div>
    </section> : null}
    <section className="run-details__section">
      <h3>{runs.length === 1 ? 'Run' : 'Runs'}</h3>
      {runs.map((runId, index) => {
        const items = entries.filter(({ metadata }) => metadata.runId === runId);
        const rows = groupValues(items, ({ stage, metadata }) => ({
          stage, measured: timestamp(metadata.measuredAt), command: metadata.command, categories: [...metadata.categories].sort(),
          targets: metadata.targets, throttling: metadata.throttling,
          numberOfMeasurements: metadata.numberOfMeasurements, compareRetries: metadata.compareRetries,
          compareAttempts: metadata.compareAttempts,
          taskRetries: metadata.taskRetries, taskRetryLimit: metadata.taskRetryLimit,
        }));
        const showTime = rows.some(({ value }) => value.measured !== timestamp(runId));
        return <details className="run-details__run" key={runId}>
          <summary><span>{runs.length > 1 ? `Run ${index + 1}` : `${items.length} ${items.length === 1 ? 'Result' : 'Results'}`}</span><time title={runId}>{timestamp(runId)}</time></summary>
          <div className="run-details__table-wrap"><table><thead><tr><th>Result</th><th>Viewport</th>{showTime ? <th>Measured</th> : null}</tr></thead><tbody>
            {rows.map(({ value, items }, rowIndex) => <tr key={rowIndex}><td>{value.stage}</td><td>{items.map(({ metadata }) => <span key={metadata.viewport.label} title={metadata.measuredAt}>{metadata.viewport.label} </span>)}</td>{showTime ? <td title={items.map(({ metadata }) => metadata.measuredAt).join(' / ')}>{value.measured === timestamp(runId) ? '—' : value.measured}</td> : null}</tr>)}
          </tbody></table></div>
        </details>;
      })}
    </section>
  </div>;
}

export function RunDetails({ outcomes }: { outcomes: readonly ReportOutcome[] }) {
  const [open, setOpen] = useState(false);
  if (!outcomes.some((outcome) => outcome.runMetadata)) return null;
  return <>
    <button type="button" className="card__run-details-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>Metadata details</button>
    {open ? <Dialog open variant="compact" onClose={() => setOpen(false)} title={<span className="ui-dialog__title-text">Metadata details</span>}>
      <RunDetailsContent outcomes={outcomes} />
    </Dialog> : null}
  </>;
}
