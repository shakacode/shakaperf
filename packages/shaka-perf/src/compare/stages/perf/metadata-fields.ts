/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementThrottling, RunMetadata } from '../../../pipeline/run-metadata';

const NETWORK_UNITS: Record<string, string> = {
  rttMs: 'ms RTT',
  requestLatencyMs: 'ms latency',
  throughputKbps: 'kbps',
  downloadThroughputKbps: 'kbps down',
  uploadThroughputKbps: 'kbps up',
};

function formatThrottling(setting: MeasurementThrottling): string {
  const parts = [setting.engine, setting.method];
  const emulatesCpu = setting.method !== 'provided';
  if (emulatesCpu && setting.cpuSlowdownMultiplier !== undefined) {
    parts.push(`${setting.cpuSlowdownMultiplier}× CPU`);
  }

  const networkSettings = Object.entries(setting.network);
  networkSettings.sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
  if (networkSettings.length === 0) {
    parts.push('No network emulation');
  } else {
    for (const [key, amount] of networkSettings) {
      const value = amount.toLocaleString('en-US');
      const unit = NETWORK_UNITS[key] ?? key;
      parts.push(`${value} ${unit}`);
    }
  }
  return parts.join(' · ');
}

/** Performance chooses domain values; shared components render the strings. */
export function performanceMetadataFields(
  settings?: Pick<RunMetadata, 'numberOfMeasurements' | 'throttling'> & { perSide?: boolean },
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!settings) return fields;

  const sampling = settings;
  if (sampling.numberOfMeasurements !== undefined) {
    let countLabel = String(sampling.numberOfMeasurements);
    if (sampling.perSide) {
      countLabel += ' per side';
    }
    fields['number of measurements'] = countLabel;
  }

  const descriptions = new Set<string>();
  for (const setting of settings.throttling ?? []) {
    if (setting.engine === 'Lighthouse') {
      descriptions.add(formatThrottling(setting));
    }
  }
  if (descriptions.size > 0) {
    fields.throttling = [...descriptions].join('; ');
  }
  return fields;
}
