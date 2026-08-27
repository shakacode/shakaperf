/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { AgentPageView } from '../agent-ready-report';
import { scoreBucket } from '../agent-ready-score';
import type {
  ClientReportAgentUnderstanding,
  ClientReportAgentUnderstandingFact,
  ClientReportAgentUnderstandingGroup,
  ClientReportAgentUnderstandingItem,
  ClientReportStatus,
} from '../client-report-renderer';

interface UnderstandingItemDefinition {
  label: string;
  sourceLabels: readonly string[];
}

interface UnderstandingGroupDefinition {
  label: string;
  items: readonly UnderstandingItemDefinition[];
}

const UNDERSTANDING_GROUPS: readonly UnderstandingGroupDefinition[] = [
  {
    label: 'Labels that name the page',
    items: [{
      label: 'Page description',
      sourceLabels: ['Meta description', 'Description before JavaScript'],
    }],
  },
  {
    label: 'Machine labels (schema.org)',
    items: [{
      label: 'Structured data',
      sourceLabels: ['Structured data', 'Structured data before JavaScript'],
    }],
  },
  {
    label: 'Previews and links',
    items: [
      { label: 'Social preview tags', sourceLabels: ['Social preview tags'] },
      { label: 'Image alt text', sourceLabels: ['Image alt text'] },
      { label: 'Descriptive links', sourceLabels: ['Descriptive links'] },
    ],
  },
];

const UNDERSTANDING_LABELS = new Set(
  UNDERSTANDING_GROUPS.flatMap((group) => group.items.flatMap((item) => item.sourceLabels)),
);

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
}

const STATUS_RANK: Record<ClientReportStatus, number> = { good: 0, fair: 1, poor: 2 };

function isUnderstandingItem(label: string): boolean {
  return UNDERSTANDING_LABELS.has(label);
}

function worstStatus(statuses: readonly ClientReportStatus[]): ClientReportStatus {
  return statuses.reduce<ClientReportStatus>(
    (worst, status) => STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst,
    'good',
  );
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
      points += isUnderstandingItem(item.label) && item.state !== 'na'
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

function understandingFact(
  label: string,
  sources: readonly UnderstandingSource[],
  totalPages: number,
): ClientReportAgentUnderstandingFact {
  const status = sources.some((source) => source.item.state === 'fail') ? 'fail' : 'partial';
  return {
    label,
    status,
    coverage: coverageLabel(sources, totalPages),
    detail: aggregatedDetail(sources),
    actions: Array.from(new Set(
      sources.map((source) => source.item.action).filter((action): action is string => Boolean(action)),
    )),
  };
}

function understandingItem(
  definition: UnderstandingItemDefinition,
  sourcesByLabel: ReadonlyMap<string, readonly UnderstandingSource[]>,
  totalPages: number,
): ClientReportAgentUnderstandingItem | undefined {
  const facts = definition.sourceLabels.flatMap((label) => {
    const sources = sourcesByLabel.get(label);
    return sources?.length ? [understandingFact(label, sources, totalPages)] : [];
  });
  if (facts.length === 0) return undefined;
  return {
    label: definition.label,
    status: worstStatus(facts.map((fact) => fact.status === 'fail' ? 'poor' : 'fair')),
    facts,
  };
}

function understandingGroup(
  definition: UnderstandingGroupDefinition,
  sourcesByLabel: ReadonlyMap<string, readonly UnderstandingSource[]>,
  totalPages: number,
): ClientReportAgentUnderstandingGroup | undefined {
  const items = definition.items.flatMap((item) => {
    const built = understandingItem(item, sourcesByLabel, totalPages);
    return built ? [built] : [];
  });
  if (items.length === 0) return undefined;
  const affectedPageIds = new Set(
    definition.items.flatMap((item) => item.sourceLabels)
      .flatMap((label) => sourcesByLabel.get(label) ?? [])
      .map((source) => source.page.id),
  );
  return {
    label: definition.label,
    status: worstStatus(items.map((item) => item.status)),
    affectedPages: affectedPageIds.size,
    totalPages,
    items,
  };
}

/**
 * Groups page-level machine-understanding gaps without changing any score.
 * Text reachability and lower-level document-outline details stay in their
 * existing page cards instead of becoming another flat site-wide checklist.
 */
export function buildAgentUnderstanding(views: readonly AgentPageView[]): ClientReportAgentUnderstanding {
  const sourcesByLabel = new Map<string, UnderstandingSource[]>();
  for (const view of views) {
    for (const category of view.struct.categories) {
      for (const item of category.items) {
        if (item.state === 'pass' || item.state === 'na' || !isUnderstandingItem(item.label)) continue;
        const existing = sourcesByLabel.get(item.label);
        const source: UnderstandingSource = { item, page: view.page };
        if (existing) existing.push(source);
        else sourcesByLabel.set(item.label, [source]);
      }
    }
  }

  const groups = UNDERSTANDING_GROUPS.flatMap((group) => {
    const built = understandingGroup(group, sourcesByLabel, views.length);
    return built ? [built] : [];
  });
  const measuredStatus = understandingStatus(views);
  const status = groups.length === 0 ? 'good' : measuredStatus === 'good' ? 'fair' : measuredStatus;
  return { status, verdict: verdictFor(status), groups };
}
