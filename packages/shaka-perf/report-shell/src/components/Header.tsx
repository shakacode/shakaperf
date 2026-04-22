import type { ReportMeta } from '../types';

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function Header({ meta, total }: { meta: ReportMeta; total: number }) {
  return (
    <header className="header">
      <div className="header__topline">
        <div className="header__brand">
          <strong>shaka-perf</strong>compare report
        </div>
        <div className="header__brand">{meta.categories.join(' · ')}</div>
      </div>

      <h1 className="header__title">{meta.title}</h1>

      <dl className="header__meta">
        <div>
          <dt>tests</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>elapsed</dt>
          <dd>{formatDuration(meta.durationMs)}</dd>
        </div>
        <div>
          <dt>generated</dt>
          <dd>{formatTimestamp(meta.generatedAt)}</dd>
        </div>
        <div>
          <dt>control</dt>
          <dd>{meta.controlUrl}</dd>
        </div>
        <div>
          <dt>experiment</dt>
          <dd>{meta.experimentUrl}</dd>
        </div>
      </dl>
    </header>
  );
}
