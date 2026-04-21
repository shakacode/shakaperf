import type { PerfArtifact, PerfMetric, PerfMetricGroup } from '../types';

const GROUP_LABEL: Record<PerfMetricGroup, string> = {
  vitals: 'vitals',
  diagnostics: 'diagnostics',
};

const GROUP_ORDER: PerfMetricGroup[] = ['vitals', 'diagnostics'];

function deltaClass(direction: PerfMetric['direction']): string {
  if (direction === 'regression') return 'delta--regression';
  if (direction === 'improvement') return 'delta--improvement';
  return 'delta--neutral';
}

function PerfTable({ title, metrics }: { title: string; metrics: PerfMetric[] }) {
  return (
    <div className="perf-section">
      <div className="perf-section__head">{title}</div>
      <table className="metrics-table">
        <thead>
          <tr>
            <th>metric</th>
            <th>control</th>
            <th>experiment</th>
            <th>Δ</th>
            <th>%Δ</th>
            <th>p</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.label}>
              <td>{m.label}</td>
              <td>{m.controlDisplay}</td>
              <td>{m.experimentDisplay}</td>
              <td className={deltaClass(m.direction)}>{m.deltaDisplay}</td>
              <td className={deltaClass(m.direction)}>{m.percentDisplay}</td>
              <td>{m.pValue.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PerfSlot({ perf }: { perf: PerfArtifact }) {
  const significant = perf.metrics.filter((m) => m.direction !== 'none');

  const grouped: Record<PerfMetricGroup, PerfMetric[]> = {
    vitals: [],
    diagnostics: [],
  };
  for (const m of significant) grouped[m.group].push(m);

  const links: { label: string; href: string }[] = [];
  if (perf.benchReportHref) links.push({ label: 'bench report', href: perf.benchReportHref });
  if (perf.controlLighthouseHref) links.push({ label: 'control lh', href: perf.controlLighthouseHref });
  if (perf.experimentLighthouseHref) links.push({ label: 'experiment lh', href: perf.experimentLighthouseHref });
  if (perf.timelineHref) links.push({ label: 'timeline', href: perf.timelineHref });
  for (const link of perf.diffHrefs) links.push({ label: link.label, href: link.href });

  const hasAny = significant.length > 0;

  return (
    <div>
      {hasAny ? (
        GROUP_ORDER.filter((g) => grouped[g].length > 0).map((g) => (
          <PerfTable key={g} title={GROUP_LABEL[g]} metrics={grouped[g]} />
        ))
      ) : (
        <div className="empty" style={{ padding: '20px 0' }}>no perf regressions or improvements</div>
      )}

      {links.length > 0 ? (
        <div className="artifact-links" style={{ marginTop: 12 }}>
          {links.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
