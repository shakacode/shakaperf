/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import { retryUsageTooltip } from '../retry-usage-tooltip';

it('omits all scopes when usage is identical across stages and viewports', () => {
  expect(retryUsageTooltip('Tasks still failed', 'retries', [
    { stage: 'Visual comparison', viewport: 'desktop', count: 1, limit: 1 },
    { stage: 'Accessibility', viewport: 'phone', count: 1, limit: 1 },
  ])).toBe('Tasks still failed after 1 of 1 allowed retries.');
});

it('groups equal viewports under stage labels when usage differs', () => {
  expect(retryUsageTooltip('Screenshots still differ', 'attempts', [
    { stage: 'Visual comparison', viewport: 'desktop', count: 3, limit: 3 },
    { stage: 'Visual comparison', viewport: 'tablet', count: 3, limit: 3 },
    { stage: 'Visual comparison', viewport: 'phone', count: 2, limit: 3 },
  ])).toBe('Screenshots still differ.\nVisual comparison\ndesktop, tablet — 3 of 3 attempts used\nphone — 2 of 3 attempts used');
});

it('keeps distinct retry limits separate even when counts match', () => {
  expect(retryUsageTooltip('Tasks still failed', 'retries', [
    { stage: 'Visual comparison', viewport: 'desktop', count: 1, limit: 1 },
    { stage: 'Accessibility', viewport: 'desktop', count: 1, limit: 2 },
  ])).toBe('Tasks still failed.\nVisual comparison\ndesktop — 1 of 1 retries used\nAccessibility\ndesktop — 1 of 2 retries used');
});

it('does not infer unknown limits from the current configuration', () => {
  expect(retryUsageTooltip('Tasks still failed', 'retries', [
    { stage: 'Visual comparison', viewport: 'desktop', count: 1, limit: undefined },
  ])).toBe('Tasks still failed. 1 retry used; limit unavailable.');
});

it('explains disabled retries', () => {
  expect(retryUsageTooltip('Tasks still failed', 'retries', [
    { stage: 'Visual comparison', viewport: 'desktop', count: 0, limit: 0 },
  ])).toBe('Tasks still failed. No retries were allowed.');
});
