/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AgentPageView } from '../agent-ready-report';
import { scoreBucket } from '../agent-ready-score';
import type {
  ClientReportAgentUnderstanding,
  ClientReportAgentUnderstandingItem,
  ClientReportStatus,
} from '../client-report-renderer';

const SSR_LABELING_ITEMS = new Set([
  'Description before JavaScript',
  'Structured data before JavaScript',
]);

interface UnderstandingSource {
  item: {
    label: string;
    points: number;
    max: number;
    state: 'pass' | 'partial' | 'fail' | 'na';
    detail: string;
    action?: string;
  };
  page: AgentPageView['page'];
  order: number;
}

interface UnderstandingGroup {
  label: string;
  sources: UnderstandingSource[];
  order: number;
}

type RankedUnderstandingItem = ClientReportAgentUnderstandingItem & { lostPoints: number; order: number };

const STATUS_RANK: Record<ClientReportStatus, number> = { good: 0, fair: 1, poor: 2 };

function isUnderstandingItem(category: string, label: string): boolean {
  return category === 'structure'
    || category === 'semantics'
    || (category === 'ssr' && SSR_LABELING_ITEMS.has(label));
}

function worstSource(sources: readonly UnderstandingSource[]): UnderstandingSource {
  return [...sources].sort((a, b) => {
    const aRatio = a.item.max > 0 ? a.item.points / a.item.max : 1;
    const bRatio = b.item.max > 0 ? b.item.points / b.item.max : 1;
    if (aRatio !== bRatio) return aRatio - bRatio;
    return a.page.name.localeCompare(b.page.name);
  })[0]!;
}

function aggregatedDetail(sources: readonly UnderstandingSource[]): string {
  const worst = worstSource(sources);
  const detailsVary = new Set(sources.map((source) => source.item.detail)).size > 1;
  if (!detailsVary) return worst.item.detail;
  return `Lowest coverage on ${worst.page.name}: ${worst.item.detail.replace(/\.\s*$/, '')}.`;
}

function coverageLabel(sources: readonly UnderstandingSource[], totalPages: number): string {
  if (sources.length === 1 && totalPages > 1) return `${sources[0]!.page.name} only`;
  if (sources.length === totalPages) return `on all ${totalPages} ${totalPages === 1 ? 'page' : 'pages'}`;
  return `on ${sources.length} of ${totalPages} ${totalPages === 1 ? 'page' : 'pages'}`;
}

function pageUnderstandingStatus(view: AgentPageView): ClientReportStatus {
  let points = 0;
  let max = 0;
  for (const category of view.struct.categories) {
    for (const item of category.items) {
      max += item.max;
      points += isUnderstandingItem(category.id, item.label) && item.state !== 'na'
        ? item.points
        : item.max;
    }
  }
  return scoreBucket(max > 0 ? Math.round((points / max) * 100) : 100);
}

function understandingStatus(views: readonly AgentPageView[]): ClientReportStatus {
  return views.reduce<ClientReportStatus>((worst, view) => {
    const status = pageUnderstandingStatus(view);
    return STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst;
  }, 'good');
}

function verdictFor(status: ClientReportStatus): string {
  if (status === 'good') return 'Labeling is in place.';
  if (status === 'fair') return 'Only partly - the labels machines rely on are missing.';
  return 'No - key labels machines rely on are missing.';
}

function groupItem(group: UnderstandingGroup, totalPages: number): RankedUnderstandingItem {
  const lostPoints = group.sources.reduce((sum, source) => sum + source.item.max - source.item.points, 0);
  const status = group.sources.some((source) => source.item.state === 'fail') ? 'fail' : 'partial';
  const item: RankedUnderstandingItem = {
    label: group.label,
    status,
    coverage: coverageLabel(group.sources, totalPages),
    detail: aggregatedDetail(group.sources),
    lostPoints,
    order: group.order,
  };
  const action = group.sources[0]?.item.action;
  if (action && group.sources.every((source) => source.item.action === action)) item.action = action;
  return item;
}

/**
 * Aggregates page-level machine-understanding gaps without changing any score.
 * Text-reachability checks stay in the reading zone, while labeling checks are
 * deduplicated by their category and label across every measured page.
 */
export function buildAgentUnderstanding(views: readonly AgentPageView[]): ClientReportAgentUnderstanding {
  const groups = new Map<string, UnderstandingGroup>();
  let order = 0;
  for (const view of views) {
    for (const category of view.struct.categories) {
      for (const item of category.items) {
        if (item.state === 'pass' || item.state === 'na' || !isUnderstandingItem(category.id, item.label)) continue;
        const key = `${category.id}\u0000${item.label}`;
        const source: UnderstandingSource = { item, page: view.page, order };
        order += 1;
        const existing = groups.get(key);
        if (existing) existing.sources.push(source);
        else groups.set(key, { label: item.label, sources: [source], order: source.order });
      }
    }
  }

  const items = [...groups.values()]
    .map((group) => groupItem(group, views.length))
    .sort((a, b) => b.lostPoints - a.lostPoints || a.order - b.order)
    .map(({ lostPoints: _lostPoints, order: _order, ...item }) => item);
  const status = items.length ? understandingStatus(views) : 'good';
  if (status === 'good') return { status, verdict: verdictFor(status), items: [] };
  return { status, verdict: verdictFor(status), items };
}
