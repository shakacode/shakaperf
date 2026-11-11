/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import type { ReportMeta, TestResult } from '../types';
import { MeasurementCommand } from './RunDetails';

export function MissingArtifactsToggle({ count, expanded, onToggle, controlsId }: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  controlsId: string;
}) {
  if (count === 0) return null;
  return <button type="button" className="missing-artifacts__toggle" aria-expanded={expanded} aria-controls={controlsId} onClick={onToggle}>
    <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {count} {count === 1 ? 'test' : 'tests'} missing
  </button>;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
    .replace(/,/g, '\\x2c').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function shellArgument(value: string): string {
  return /^[\w./:@=-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

export function MissingArtifactsDetails({ meta, tests, expanded, id }: {
  meta: ReportMeta;
  tests: TestResult[];
  expanded: boolean;
  id: string;
}) {
  if (tests.length === 0) return null;
  const groups = new Map<string, TestResult[]>();
  for (const test of tests) {
    const group = groups.get(test.filePath) ?? [];
    group.push(test);
    groups.set(test.filePath, group);
  }
  const pipeline = meta.pipelineName ?? 'compare';
  const names = [...new Set(tests.map((test) => test.name))].map(escapeRegex).join('|');
  const command = `shaka-perf ${shellArgument(pipeline)} --filter ${shellArgument(`^(?:${names})$`)} --keep-old-results`;
  return <section id={id} className="missing-artifacts" aria-label="Tests without saved results" hidden={!expanded}>
    {expanded ? <>
      <h3 className="missing-artifacts__title">no artifacts yet</h3>
      <p className="missing-artifacts__summary">
        {tests.length} test{tests.length === 1 ? '' : 's'} missing on-disk measurements — re-run{' '}
        <code>shaka-perf {pipeline}</code> (or ship the shard that measures them)
      </p>
      {[...groups].map(([filePath, group]) => <div className="missing-artifacts__file-group" key={filePath}>
        <div className="missing-artifacts__path">{filePath}</div>
        <ul className="missing-artifacts__names">
          {group.map((test) => <li key={test.id}>{test.name}</li>)}
        </ul>
      </div>)}
      <MeasurementCommand command={command} autoSize label="Recovery command" />
    </> : null}
  </section>;
}
