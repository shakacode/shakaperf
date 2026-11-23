/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementThrottling } from '../pipeline/run-metadata';

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

export type PerformanceSettings = {
  numberOfMeasurements: number;
  targetCount: number;
  throttling?: MeasurementThrottling;
};

export type PerformanceEngineResult<M> = {
  measurement: M;
  settings: PerformanceSettings;
};

type PerformanceMetadataFields = {
  'number of measurements': string;
  throttling?: string;
};

export function performanceMetadataFields(settings: PerformanceSettings): PerformanceMetadataFields {
  let countLabel = String(settings.numberOfMeasurements);
  if (settings.targetCount > 1) countLabel += ' per side';
  if (settings.numberOfMeasurements === 1) countLabel += ' (1 sample below)';
  const fields: PerformanceMetadataFields = { 'number of measurements': countLabel };

  const lighthouseSettings = settings.throttling;
  if (lighthouseSettings?.engine === 'Lighthouse') {
    fields.throttling = formatThrottling(lighthouseSettings);
  }
  return fields;
}
