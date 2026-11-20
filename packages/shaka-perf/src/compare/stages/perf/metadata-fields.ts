/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementThrottling, MeasurementMetadata } from '../../../pipeline/run-metadata';

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
  metadata?: Pick<MeasurementMetadata,
    'numberOfMeasurements' | 'throttling' | 'targets'>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!metadata) return fields;

  if (metadata.numberOfMeasurements !== undefined) {
    let countLabel = String(metadata.numberOfMeasurements);
    if (metadata.targets.length > 1) {
      countLabel += ' per side';
    }
    if (metadata.numberOfMeasurements === 1) {
      countLabel += ' (1 sample below)';
    }
    fields['number of measurements'] = countLabel;
  }

  const lighthouseSettings = metadata.throttling;
  if (lighthouseSettings?.engine === 'Lighthouse') {
    fields.throttling = formatThrottling(lighthouseSettings);
  }
  return fields;
}
