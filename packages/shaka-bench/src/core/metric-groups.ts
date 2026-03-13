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

export function isDiagnosticMetric(phaseName: string): boolean {
  return DIAGNOSTICS_SET.has(phaseName);
}

export function diagnosticSortOrder(phaseName: string): number {
  const idx = DIAGNOSTICS_METRICS.indexOf(phaseName);
  return idx === -1 ? DIAGNOSTICS_METRICS.length : idx;
}
