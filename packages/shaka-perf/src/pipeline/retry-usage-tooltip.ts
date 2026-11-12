/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

interface RetryUsage {
  stage: string;
  viewport: string;
  count: number | undefined;
  limit: number | undefined;
}

type UsageUnit = 'retries' | 'attempts';

function formatUsage({ count, limit }: RetryUsage, unit: UsageUnit): string {
  const singular = unit === 'retries' ? 'retry' : 'attempt';
  if (count === undefined) {
    const label = unit === 'retries' ? 'Retry' : 'Attempt';
    return `${label} count unavailable; limit: ${limit ?? 'unknown'}`;
  }
  if (limit === undefined) {
    return `${count} ${count === 1 ? singular : unit} used; limit unavailable`;
  }
  return `${count} of ${limit} ${unit} used`;
}

function uniformUsageTooltip(summary: string, unit: UsageUnit, usage: RetryUsage): string {
  const { count, limit } = usage;
  if (count === undefined || limit === undefined) {
    return `${summary}. ${formatUsage(usage, unit)}.`;
  }
  if (unit === 'retries' && count === 0 && limit === 0) {
    return `${summary}. No retries were allowed.`;
  }
  return `${summary} after ${count} of ${limit} allowed ${unit}.`;
}

/** Only add stage and viewport labels when the counts need disambiguation. */
export function retryUsageTooltip(summary: string, unit: UsageUnit, entries: readonly RetryUsage[]): string {
  const first = entries[0];
  if (!first) return `${summary}.`;

  const sameUsage = entries.every(({ count, limit }) => count === first.count && limit === first.limit);
  if (sameUsage) return uniformUsageTooltip(summary, unit, first);

  const stages = new Map<string, Map<string, Set<string>>>();
  for (const entry of entries) {
    let groups = stages.get(entry.stage);
    if (!groups) {
      groups = new Map();
      stages.set(entry.stage, groups);
    }
    const text = formatUsage(entry, unit);
    const viewports = groups.get(text) ?? new Set<string>();
    viewports.add(entry.viewport);
    groups.set(text, viewports);
  }

  const lines = [`${summary}.`];
  for (const [stage, groups] of stages) {
    lines.push(stage);
    for (const [text, viewports] of groups) {
      lines.push(`${[...viewports].join(', ')} — ${text}`);
    }
  }
  return lines.join('\n');
}
