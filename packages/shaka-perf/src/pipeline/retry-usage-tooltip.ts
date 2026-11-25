/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

interface RetryUsage {
  stage: string;
  viewport: string;
  count: number | undefined;
  limit: number | undefined;
}

type UsageUnit = 'retries' | 'comparisons';

/**
 * @example
 * formatUsage({ stage: 'Accessibility', viewport: 'desktop', count: 1, limit: 2 }, 'retries')
 * // => '1 of 2 retries used'
 */
function formatUsage({ count, limit }: RetryUsage, unit: UsageUnit): string {
  const singular = unit === 'retries' ? 'retry' : 'comparison';
  if (count === undefined) {
    return unit === 'comparisons' ? '' : `Retry count unavailable; limit: ${limit ?? 'unknown'}`;
  }
  if (limit === undefined) {
    return `${count} ${count === 1 ? singular : unit} used; limit unavailable`;
  }
  return `${count} of ${limit} ${unit} used`;
}

/**
 * @example
 * uniformUsageTooltip('Screenshots matched', 'comparisons', {
 *   stage: 'Visual comparison', viewport: 'desktop', count: 2, limit: 3,
 * })
 * // => 'Screenshots matched after 2 of 3 allowed comparisons.'
 */
function uniformUsageTooltip(summary: string, unit: UsageUnit, usage: RetryUsage): string {
  const { count, limit } = usage;
  if (count === undefined || limit === undefined) {
    const detail = formatUsage(usage, unit);
    return detail ? `${summary}. ${detail}.` : `${summary}.`;
  }
  if (unit === 'retries' && count === 0 && limit === 0) {
    return `${summary}. No retries were allowed.`;
  }
  return `${summary} after ${count} of ${limit} allowed ${unit}.`;
}

/**
 * Only add stage and viewport labels when the counts need disambiguation.
 *
 * @example
 * retryUsageTooltip('Tasks still failed', 'retries', [
 *   { stage: 'Accessibility', viewport: 'desktop', count: 1, limit: 1 },
 *   { stage: 'Accessibility', viewport: 'phone', count: 2, limit: 2 },
 * ])
 * // => 'Tasks still failed.\nAccessibility · desktop — 1 of 1 retries used\n'
 * //    + 'Accessibility · phone — 2 of 2 retries used'
 */
export function retryUsageTooltip(summary: string, unit: UsageUnit, entries: readonly RetryUsage[]): string {
  const first = entries[0];
  if (!first) return `${summary}.`;

  const sameUsage = entries.every(({ count, limit }) => count === first.count && limit === first.limit);
  if (sameUsage) return uniformUsageTooltip(summary, unit, first);

  const lines = entries.flatMap(entry => {
    const detail = formatUsage(entry, unit);
    return detail ? [`${entry.stage} · ${entry.viewport} — ${detail}`] : [];
  });
  return [`${summary}.`, ...lines].join('\n');
}
