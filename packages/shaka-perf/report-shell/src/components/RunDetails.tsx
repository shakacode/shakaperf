/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useRef, useState } from 'react';
import type { ReportOutcome } from '../types';
import { Dialog } from '../../../src/pipeline/stage-report-components';
import type { RunMetadata } from '../../../src/pipeline/run-metadata';

export function savedRunDetails(outcomes: readonly ReportOutcome[]) {
  const groups = new Map<string, { stage: string; metadata: RunMetadata }[]>();
  for (const outcome of outcomes) {
    if (!outcome.runMetadata) continue;
    const label = outcome.viewport.label;
    const entries = groups.get(label) ?? [];
    entries.push({ stage: outcome.stage, metadata: outcome.runMetadata });
    groups.set(label, entries);
  }
  return [...groups];
}

function MeasurementCommand({ command }: { command: string }) {
  const [status, setStatus] = useState('Copy command');
  const field = useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus('Copied');
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus('Command selected — copy manually');
    }
  }
  return (
    <div className="run-details__command">
      <textarea aria-label="Measurement command" ref={field} value={command} readOnly rows={2} />
      <button type="button" onClick={copy}>{status}</button>
    </div>
  );
}

type Entry = { stage: string; metadata: RunMetadata };

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

function Scope({ items, entries, runs }: { items: Entry[]; entries: Entry[]; runs: string[] }) {
  if (new Set(items).size === entries.length) return null;
  const scopes = groupValues(items, ({ stage, metadata }) => [metadata.runId, stage]);
  return <span className="run-details__scope">{scopes.map(({ value: [runId, stage], items }) =>
    `${runs.length > 1 ? `Run ${runs.indexOf(runId!) + 1} / ` : ''}${stage} · ${unique(items.map((item) => item.metadata.viewport.label)).join(', ')}`,
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

const NETWORK_LABELS: Record<string, string> = {
  rttMs: 'ms RTT', requestLatencyMs: 'ms latency', throughputKbps: 'kbps',
  downloadThroughputKbps: 'kbps down', uploadThroughputKbps: 'kbps up',
};

export function RunDetailsContent({ outcomes }: { outcomes: readonly ReportOutcome[] }) {
  const entries = savedRunDetails(outcomes).flatMap(([, items]) => items);
  const runs = unique(entries.map(({ metadata }) => metadata.runId));
  const targets = entries.flatMap((entry) => entry.metadata.targets.map((target) => ({ entry, target })));
  const commits = groupValues(targets, ({ target }) => target.commit ? { sha: target.commit.sha, message: target.commit.message } : null);
  const commands = groupValues(entries, ({ metadata }) => metadata.command);
  const categories = groupValues(entries, ({ metadata }) => [...metadata.categories].sort());
  const viewports = groupValues(entries, ({ metadata }) => metadata.viewport);
  const settings = groupValues(entries.flatMap((entry) => (entry.metadata.throttling ?? []).filter((setting) => setting.engine === 'Lighthouse').map((setting) => ({ entry, setting }))), ({ setting }) => ({
    engine: setting.engine, method: setting.method, cpu: setting.method === 'provided' ? undefined : setting.cpuSlowdownMultiplier,
    network: Object.entries(setting.network).sort(([a], [b]) => a.localeCompare(b)),
  }));
  const scope = (items: Entry[]) => <Scope items={items} entries={entries} runs={runs} />;
  return <div className="run-details">
    <section className="run-details__section">
      <h3>Applications</h3>
      <div className="run-details__applications">
        {groupValues(targets, ({ target }) => target.url).map(({ value: url, items }) => <div className="run-details__application" key={url}>
          <h4>{unique(items.map(({ target }) => target.side)).join(' / ')}</h4>
          <div className="run-details__url">{url}</div>
          {scope(items.map(({ entry }) => entry))}
        </div>)}
      </div>
      <div className="run-details__commits">
        {commits.map(({ value: commit, items }, index) => <div key={index}>
          {commits.length > 1 ? <div className="run-details__label">{unique(items.map(({ target }) => target.side)).join(' / ')}</div> : null}
          {commit ? <CommitDetails commit={commit} /> : <p className="run-details__unavailable">Commit unavailable</p>}
          {scope(items.map(({ entry }) => entry))}
        </div>)}
      </div>
    </section>
    <section className="run-details__section">
      <h3>Measurement command</h3>
      {commands.map(({ value, items }) => commands.length === 1 ? <MeasurementCommand key={value} command={value} /> : <details className="run-details__command-variant" key={value}><summary>{scope(items)}</summary><MeasurementCommand command={value} /></details>)}
    </section>
    <section className="run-details__section run-details__overview">
      <div><h3>Categories</h3>{categories.map(({ value, items }) => <div key={value.join(',')}><div className="run-details__tags">{value.map((category) => <span key={category}>{category}</span>)}</div>{categories.length > 1 ? scope(items) : null}</div>)}</div>
      <div><h3>Viewports</h3><div className="run-details__viewports">{viewports.map(({ value, items }, index) => <div className="run-details__viewport" key={index}>
        <strong>{value.label}</strong><span>{value.width} × {value.height} · {value.deviceScaleFactor}× · {value.formFactor}</span>{viewports.filter((group) => group.value.label === value.label).length > 1 ? scope(items) : null}
      </div>)}</div></div>
    </section>
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
        }));
        const showTime = rows.some(({ value }) => value.measured !== timestamp(runId));
        return <details className="run-details__run" key={runId}>
          <summary><span>{runs.length > 1 ? `Run ${index + 1}` : `${items.length} measurements`}</span><time title={runId}>{timestamp(runId)}</time></summary>
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
    <button type="button" className="card__run-details-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>Run details</button>
    {open ? <Dialog open variant="compact" onClose={() => setOpen(false)} title={<span className="ui-dialog__title-text">Run details</span>}>
      <RunDetailsContent outcomes={outcomes} />
    </Dialog> : null}
  </>;
}
