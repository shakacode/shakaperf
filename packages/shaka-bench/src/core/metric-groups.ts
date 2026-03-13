// Well-known Lighthouse / Web Vitals metrics that belong in the "LH & Vitals" group.
// Custom markers are also included in this group (they're not in this set, but anything
// not in DIAGNOSTICS_METRICS is treated as a vital).
const VITALS_METRICS = new Set([
  'first-contentful-paint',
  'speed-index',
  'largest-contentful-paint',
  'total-blocking-time',
  'cumulative-layout-shift',
  'server-response-time',
  'interaction-to-next-paint',
  'total-score',
  'accessibility',
]);

// Resource breakdown metrics that belong in the "Diagnostics" group.
// Order determines display order in the summary.
const DIAGNOSTICS_METRICS = [
  'downloads',
  'downloads-count',
  'early-downloads',
  'early-downloads-count',
  'js',
  'js-count',
  'images',
  'images-count',
  'fonts',
  'fonts-count',
];

const DIAGNOSTICS_SET = new Set(DIAGNOSTICS_METRICS);

// Short display names for well-known metrics.
const METRIC_DISPLAY_NAMES: Record<string, string> = {
  'first-contentful-paint': 'FCP',
  'speed-index': 'SI',
  'largest-contentful-paint': 'LCP',
  'total-blocking-time': 'TBT',
  'cumulative-layout-shift': 'CLS',
  'server-response-time': 'TTFB',
  'interaction-to-next-paint': 'INP',
  'total-score': 'LH Score',
  'accessibility': 'Accessibility',
};

export function isDiagnosticMetric(phaseName: string): boolean {
  return DIAGNOSTICS_SET.has(phaseName);
}

export function diagnosticSortOrder(phaseName: string): number {
  const idx = DIAGNOSTICS_METRICS.indexOf(phaseName);
  return idx === -1 ? DIAGNOSTICS_METRICS.length : idx;
}

export function getDisplayName(phaseName: string): string {
  return METRIC_DISPLAY_NAMES[phaseName] ?? phaseName;
}
