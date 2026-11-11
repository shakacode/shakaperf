/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementThrottling } from '../../../pipeline/run-metadata';
import type { ExecutionDetails } from '../../../pipeline/outcome';

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
  executionDetails?: Pick<ExecutionDetails,
    'numberOfMeasurements' | 'throttling' | 'measurementSideCount'>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!executionDetails) return fields;

  const sampling = executionDetails;
  if (sampling.numberOfMeasurements !== undefined) {
    let countLabel = String(sampling.numberOfMeasurements);
    if (sampling.measurementSideCount !== undefined && sampling.measurementSideCount > 1) {
      countLabel += ' per side';
    }
    if (executionDetails.numberOfMeasurements === 1) {
      countLabel += ' (1 sample below)';
    }
    fields['number of measurements'] = countLabel;
  }

  // The runner validates that both measured sides use identical settings.
  const lighthouseSettings = executionDetails.throttling?.find(setting => setting.engine === 'Lighthouse');
  if (lighthouseSettings) {
    fields.throttling = formatThrottling(lighthouseSettings);
  }
  return fields;
}
