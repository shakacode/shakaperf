/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementSettingsModel } from './measurement-settings-model';

const NETWORK_UNITS: Record<string, string> = {
  rttMs: 'ms RTT',
  requestLatencyMs: 'ms latency',
  throughputKbps: 'kbps',
  downloadThroughputKbps: 'kbps down',
  uploadThroughputKbps: 'kbps up',
};

/** Present a resolved snapshot of measured settings. */
export function MeasurementSettings({ settings: model }: { settings: MeasurementSettingsModel }) {
  const { counts, throttling: setting, sampleCount } = model;
  const sample = sampleCount === 1 ? '1 sample below' : null;

  if (counts.length === 0 && !setting && sampleCount !== 1) return null;
  return <><dl className="ui-dialog__meta measurement-settings">
    {counts.map(({ count, perSide }) => <div key={`count-${count}-${perSide}`}>
      <dt>number of measurements</dt>
      <dd>{count}{perSide ? ' per side' : ''}{sample ? <span className="measurement-settings__sample"> ({sample})</span> : null}</dd>
    </div>)}
    {setting ? <div>
      <dt>throttling</dt>
      <dd>{[
        setting.engine,
        setting.method,
        ...(setting.cpuSlowdownMultiplier === undefined ? [] : [`${setting.cpuSlowdownMultiplier}× CPU`]),
        ...(Object.keys(setting.network).length === 0 ? ['No network emulation'] : Object.entries(setting.network).map(([key, amount]) =>
          `${amount.toLocaleString('en-US')} ${NETWORK_UNITS[key] ?? key}`)),
      ].join(' · ')}</dd>
    </div> : null}
  </dl>{counts.length === 0 && sample ? <p className="measurement-settings__sample">{sample}</p> : null}</>;
}
