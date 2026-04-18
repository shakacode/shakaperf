import type { PerfArtifact, PerfMetric } from '../types';

function deltaClass(metric: PerfMetric): string {
  if (!metric.significant) return 'delta--neutral';
  return metric.hlDiffMs > 0 ? 'delta--regression' : 'delta--improvement';
}

function formatMs(value: number): string {
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value.toFixed(0)}ms`;
}

function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatMs(value)}`;
}

export function PerfSlot({ perf }: { perf: PerfArtifact }) {
  const hasMetrics = perf.metrics.length > 0;
  const links: { label: string; href: string }[] = [];
  if (perf.controlLighthouseHref) links.push({ label: 'control lh', href: perf.controlLighthouseHref });
  if (perf.experimentLighthouseHref) links.push({ label: 'experiment lh', href: perf.experimentLighthouseHref });
  if (perf.timelineHref) links.push({ label: 'timeline', href: perf.timelineHref });
  for (const link of perf.diffHrefs) links.push({ label: link.label, href: link.href });

  return (
    <div>
      {hasMetrics ? (
        <table className="metrics-table">
          <thead>
            <tr>
              <th>metric</th>
              <th>control</th>
              <th>experiment</th>
              <th>Δ</th>
              <th>p</th>
            </tr>
          </thead>
          <tbody>
            {perf.metrics.map((m) => (
              <tr key={m.label}>
                <td>{m.label}</td>
                <td>{formatMs(m.controlMs)}</td>
                <td>{formatMs(m.experimentMs)}</td>
                <td className={deltaClass(m)}>{formatDelta(m.hlDiffMs)}</td>
                <td>{m.pValue.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty" style={{ padding: '20px 0' }}>no perf metrics</div>
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
