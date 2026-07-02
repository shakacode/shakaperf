/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AccessibilityViolation } from './types';
import type { FilterOption } from './report-utils';

const FALLBACK_TAG_ORDER = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
  'best-practice',
] as const;

export function ViolationTagChips({
  configuredTags,
  max = 3,
  violation,
}: {
  configuredTags: readonly FilterOption[] | readonly string[];
  max?: number;
  violation: AccessibilityViolation;
}) {
  const tags = primaryViolationTags(violation, configuredTags);
  if (tags.length === 0) return null;
  const visible = tags.slice(0, max);
  const hidden = tags.length - visible.length;
  return (
    <span className="a11y-tag-chips" aria-label={`tags: ${tags.join(', ')}`}>
      {visible.map((tag) => (
        <span className="a11y-tag-chip" key={tag}>
          {tag}
        </span>
      ))}
      {hidden > 0 ? (
        <span className="a11y-tag-chip a11y-tag-chip--muted">+{hidden}</span>
      ) : null}
    </span>
  );
}

export function primaryViolationTags(
  violation: AccessibilityViolation,
  configuredTags: readonly FilterOption[] | readonly string[],
): string[] {
  const tags = new Set(violation.tags ?? []);
  const configured = configuredTags.map((option) =>
    typeof option === 'string' ? option : option.value,
  );
  const configuredMatches = configured.filter((tag) => tags.has(tag));
  if (configuredMatches.length > 0) return configuredMatches;
  return FALLBACK_TAG_ORDER.filter((tag) => tags.has(tag));
}
