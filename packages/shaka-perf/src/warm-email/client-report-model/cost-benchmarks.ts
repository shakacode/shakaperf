/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

/**
 * Published performance and accessibility lines.
 * Sources: https://web.dev/articles/lcp, https://web.dev/articles/cls,
 * https://developer.chrome.com/docs/lighthouse/performance/first-contentful-paint,
 * https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time,
 * and https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html.
 */
export const BENCHMARK_LINES = {
  lcpMs: { good: 2500, poor: 4000 },
  // Published raw CLS units; audit consumers must normalize the stored /100 value.
  cls: { good: 0.10, poor: 0.25 },
  fcpMs: { good: 1800, poor: 3000 },
  tbtMs: { good: 200, poor: 600 },
  contrast: 4.5,
} as const;

export const MAX_MISSING_AI_TEXT_SHARE_FOR_ZERO = 0.10;

interface DecimalFraction {
  numerator: bigint;
  denominator: bigint;
}

function decimalFraction(value: number): DecimalFraction {
  const [mantissa, exponentLabel] = value.toString().toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa.split('.');
  const numerator = BigInt(`${integer}${fraction}`);
  const exponent = Number(exponentLabel ?? 0) - fraction.length;
  if (exponent >= 0) {
    return { numerator: numerator * (10n ** BigInt(exponent)), denominator: 1n };
  }
  return { numerator, denominator: 10n ** BigInt(-exponent) };
}

/**
 * Floors a multiple directly from raw measured operands.
 */
export function benchmarkMultiple(measured: number, good: number): string | undefined {
  if (!Number.isFinite(measured) || !Number.isFinite(good) || measured <= 0 || good <= 0 || measured <= good) {
    return undefined;
  }

  const measuredFraction = decimalFraction(measured);
  const goodFraction = decimalFraction(good);
  const tenths = (
    measuredFraction.numerator
    * goodFraction.denominator
    * 10n
  ) / (
    measuredFraction.denominator
    * goodFraction.numerator
  );
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return decimal === 0n ? `${whole}x` : `${whole}.${decimal}x`;
}

export type CostZone = 'good' | 'mid' | 'poor';

export function benchmarkZone(measured: number, line: { good: number; poor: number }): CostZone {
  if (measured <= line.good) return 'good';
  if (measured > line.poor) return 'poor';
  return 'mid';
}

export interface CostGap {
  metricLabel: string;
  measuredLabel: string;
  goodLabel: string;
  poorLabel: string;
  multipleLabel?: string;
  zone: CostZone;
  lineOwner: string;
  lineUrl: string;
}

export interface BenchmarkScaleGeometry {
  axisMaxMs: number;
  axisMaxSeconds: number;
  zones: {
    green: number;
    amber: number;
    red: number;
  };
  goodLinePercent: number;
  poorLinePercent: number;
  markerPercent: number;
}

/** Returns data-derived geometry for the C benchmark scale. */
export function benchmarkScaleGeometry(
  valueMs: number,
  line: { good: number; poor: number },
): BenchmarkScaleGeometry | undefined {
  if (
    !Number.isFinite(valueMs)
    || valueMs < 0
    || !Number.isFinite(line.good)
    || !Number.isFinite(line.poor)
    || line.good <= 0
    || line.poor <= line.good
  ) {
    return undefined;
  }

  const axisMaxMs = Math.max(4000, Math.ceil((valueMs * 1.25) / 500) * 500);
  if (line.poor > axisMaxMs) return undefined;
  const percent = (value: number): number => (value / axisMaxMs) * 100;
  const goodLinePercent = percent(line.good);
  const poorLinePercent = percent(line.poor);
  return {
    axisMaxMs,
    axisMaxSeconds: axisMaxMs / 1000,
    zones: {
      green: goodLinePercent,
      amber: poorLinePercent - goodLinePercent,
      red: 100 - poorLinePercent,
    },
    goodLinePercent,
    poorLinePercent,
    markerPercent: percent(valueMs),
  };
}
