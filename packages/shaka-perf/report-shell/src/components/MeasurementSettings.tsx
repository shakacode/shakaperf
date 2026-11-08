/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportOutcome } from '../types';

const NETWORK_UNITS: Record<string, string> = {
  rttMs: 'ms RTT',
  requestLatencyMs: 'ms latency',
  throughputKbps: 'kbps',
  downloadThroughputKbps: 'kbps down',
  uploadThroughputKbps: 'kbps up',
};

function distinct<T>(values: T[]): T[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

/** Display measured settings, never values inferred from today's report config. */
export function MeasurementSettings({ outcomes }: { outcomes: readonly ReportOutcome[] }) {
  const metadata = outcomes.flatMap((outcome) => outcome.runMetadata ? [outcome.runMetadata] : []);
  const counts = distinct(metadata.flatMap((saved) => saved.numberOfMeasurements === undefined ? [] : [{
    count: saved.numberOfMeasurements,
    perSide: saved.targets.length > 1,
  }]));
  const settings = distinct(metadata.flatMap((saved) => (saved.throttling ?? [])
    .filter((setting) => setting.engine === 'Lighthouse')
    .map((setting) => ({
      engine: setting.engine,
      method: setting.method,
      cpu: setting.method === 'provided' ? undefined : setting.cpuSlowdownMultiplier,
      network: Object.entries(setting.network).sort(([a], [b]) => a.localeCompare(b)),
    }))));

  if (counts.length === 0 && settings.length === 0) return null;
  return <dl className="ui-dialog__meta measurement-settings">
    {counts.map(({ count, perSide }) => <div key={`count-${count}-${perSide}`}>
      <dt>number of measurements</dt>
      <dd>{count}{perSide ? ' per side' : ''}</dd>
    </div>)}
    {settings.map((setting) => <div key={JSON.stringify(setting)}>
      <dt>throttling</dt>
      <dd>{[
        setting.engine,
        setting.method,
        ...(setting.cpu === undefined ? [] : [`${setting.cpu}× CPU`]),
        ...(setting.network.length === 0 ? ['No network emulation'] : setting.network.map(([key, amount]) =>
          `${amount.toLocaleString('en-US')} ${NETWORK_UNITS[key] ?? key}`)),
      ].join(' · ')}</dd>
    </div>)}
  </dl>;
}
