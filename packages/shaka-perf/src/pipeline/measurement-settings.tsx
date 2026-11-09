/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Outcome } from './outcome';
import type { MeasurementThrottling } from './run-metadata';

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

function groupThrottling(settings: readonly MeasurementThrottling[]) {
  const groups = new Map<string, { setting: MeasurementThrottling; sides: Set<string> }>();
  for (const saved of settings) {
    if (saved.engine !== 'Lighthouse') continue;
    const setting = {
      engine: saved.engine,
      method: saved.method,
      cpuSlowdownMultiplier: saved.method === 'provided' ? undefined : saved.cpuSlowdownMultiplier,
      network: Object.fromEntries(Object.entries(saved.network).sort(([a], [b]) => a.localeCompare(b))),
    };
    const key = JSON.stringify(setting);
    const group = groups.get(key) ?? { setting, sides: new Set<string>() };
    if (saved.side) group.sides.add(saved.side);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Display measured settings, never values inferred from today's report config. */
export function MeasurementSettings({ outcomes, countOutcomes = outcomes, sampleCount }: {
  outcomes: readonly Outcome[];
  countOutcomes?: readonly Outcome[];
  sampleCount?: number;
}) {
  const metadata = outcomes.flatMap((outcome) => outcome.runMetadata ? [outcome.runMetadata] : []);
  const countMetadata = countOutcomes.flatMap((outcome) => outcome.runMetadata ? [outcome.runMetadata] : []);
  const counts = distinct(countMetadata.flatMap((saved) => saved.numberOfMeasurements === undefined ? [] : [{
    count: saved.numberOfMeasurements,
    perSide: saved.targets.length > 1,
  }]));
  const settings = groupThrottling(metadata.flatMap((saved) => saved.throttling ?? []));

  if (counts.length === 0 && settings.length === 0 && sampleCount !== 1) return null;
  return <><dl className="ui-dialog__meta measurement-settings">
    {counts.map(({ count, perSide }) => <div key={`count-${count}-${perSide}`}>
      <dt>number of measurements</dt>
      <dd>{count}{perSide ? ' per side' : ''}</dd>
    </div>)}
    {settings.map(({ setting, sides }) => <div key={JSON.stringify(setting)}>
      <dt>throttling{settings.length > 1 && sides.size > 0 ? ` · ${[...sides].join(' / ')}` : ''}</dt>
      <dd>{[
        setting.engine,
        setting.method,
        ...(setting.cpuSlowdownMultiplier === undefined ? [] : [`${setting.cpuSlowdownMultiplier}× CPU`]),
        ...(Object.keys(setting.network).length === 0 ? ['No network emulation'] : Object.entries(setting.network).map(([key, amount]) =>
          `${amount.toLocaleString('en-US')} ${NETWORK_UNITS[key] ?? key}`)),
      ].join(' · ')}</dd>
    </div>)}
  </dl>{sampleCount === 1 ? <p className="measurement-settings__sample">1 sample shown here</p> : null}</>;
}
