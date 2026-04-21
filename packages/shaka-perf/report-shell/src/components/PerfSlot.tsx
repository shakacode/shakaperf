import { useMemo, useRef, useState } from 'react';
import type { PerfArtifact, PerfMetric, PerfMetricGroup, TestResult } from '../types';
import { Dialog } from './Dialog';
import { TestMeta } from './TestMeta';

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

interface ArtifactLink {
  label: string;
  href: string;
}

function artifactLinks(perf: PerfArtifact): ArtifactLink[] {
  const links: ArtifactLink[] = [];
  if (perf.benchReportHref) links.push({ label: 'bench report', href: perf.benchReportHref });
  if (perf.controlLighthouseHref) links.push({ label: 'control lh', href: perf.controlLighthouseHref });
  if (perf.experimentLighthouseHref) links.push({ label: 'experiment lh', href: perf.experimentLighthouseHref });
  if (perf.timelineHref) links.push({ label: 'timeline', href: perf.timelineHref });
  for (const link of perf.diffHrefs) links.push({ label: link.label, href: link.href });
  return links;
}

/**
 * Decode a `data:text/html;base64,...` URI to the raw HTML string so we can
 * embed it via iframe `srcDoc`. data: iframes have an opaque origin — the
 * parent can't read their contentDocument to measure content height, which
 * blocks "auto-resize to fit content" (Lighthouse + bench reports overflow
 * their iframe viewport otherwise and the bottom gets clipped). srcDoc
 * iframes inherit the parent's origin, so contentDocument is readable.
 */
function dataUriToHtml(uri: string): string {
  const marker = ';base64,';
  const idx = uri.indexOf(marker);
  if (idx < 0) return '';
  try {
    return atob(uri.slice(idx + marker.length));
  } catch {
    return '';
  }
}

function ArtifactFrame({ href, label }: { href: string; label: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const html = useMemo(() => dataUriToHtml(href), [href]);

  const resize = () => {
    const el = ref.current;
    const doc = el?.contentDocument;
    if (!el || !doc) return;
    // scrollHeight on the documentElement covers the full content even when
    // the body has margin collapse / flex layouts that undersize body.
    const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
    if (h > 0) el.style.height = `${h}px`;
  };

  return (
    <iframe
      ref={ref}
      className="artifact-frame"
      srcDoc={html}
      title={label}
      onLoad={resize}
    />
  );
}

export function PerfSlot({ perf, test }: { perf: PerfArtifact; test: TestResult }) {
  const significant = perf.metrics.filter((m) => m.direction !== 'none');
  const [openArtifact, setOpenArtifact] = useState<ArtifactLink | null>(null);

  const grouped: Record<PerfMetricGroup, PerfMetric[]> = {
    vitals: [],
    diagnostics: [],
  };
  for (const m of significant) grouped[m.group].push(m);

  const links = artifactLinks(perf);

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
            <button
              key={link.label}
              type="button"
              className="artifact-links__btn"
              onClick={() => setOpenArtifact(link)}
            >
              {link.label}
            </button>
          ))}
        </div>
      ) : null}

      <Dialog
        open={openArtifact !== null}
        onClose={() => setOpenArtifact(null)}
        title={
          openArtifact ? (
            <span className="ui-dialog__title-text">{openArtifact.label}</span>
          ) : null
        }
        meta={
          openArtifact ? (
            <TestMeta
              test={test}
              extra={
                <div>
                  <dt>artifact</dt>
                  <dd>{openArtifact.label}</dd>
                </div>
              }
            />
          ) : null
        }
      >
        {openArtifact ? (
          <ArtifactFrame href={openArtifact.href} label={openArtifact.label} />
        ) : null}
      </Dialog>
    </div>
  );
}
