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
    fields['number of measurements'] = countLabel;
  }
  if (executionDetails.numberOfMeasurements === 1) {
    fields['artifact samples'] = '1 sample below';
  }

  const sidesByDescription = new Map<string, Set<string>>();
  for (const setting of executionDetails.throttling ?? []) {
    if (setting.engine !== 'Lighthouse') continue;
    const description = formatThrottling(setting);
    const sides = sidesByDescription.get(description) ?? new Set<string>();
    if (setting.side) sides.add(setting.side);
    sidesByDescription.set(description, sides);
  }

  for (const [description, sides] of sidesByDescription) {
    let label = 'throttling';
    if (sidesByDescription.size > 1 && sides.size > 0) {
      label += ` · ${[...sides].join(' / ')}`;
    }
    const previous = fields[label];
    fields[label] = previous ? `${previous}; ${description}` : description;
  }
  return fields;
}
