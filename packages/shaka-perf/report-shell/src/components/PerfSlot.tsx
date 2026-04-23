import { useMemo, useRef, useState } from 'react';
import type { PerfArtifact, PerfMetric, PerfMetricGroup, TestResult } from '../types';
import { Dialog } from './Dialog';
import { TestMeta } from './TestMeta';

const LOG_UNAVAILABLE_MESSAGE =
  'engine log not found on disk — the bench worker may have been killed ' +
  'before it could flush stderr, or the results folder was wiped between ' +
  'measurement and report generation.';

const EMPTY: PerfArtifact[] = [];

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

function artifactLinks(perf: PerfArtifact, hasPreview: boolean): ArtifactLink[] {
  const links: ArtifactLink[] = [];
  if (perf.benchReportHref) links.push({ label: 'bench report', href: perf.benchReportHref });
  if (perf.controlLighthouseHref) links.push({ label: 'control lh', href: perf.controlLighthouseHref });
  if (perf.experimentLighthouseHref) links.push({ label: 'experiment lh', href: perf.experimentLighthouseHref });
  // When we have an inline preview SVG, the timeline is opened by clicking
  // the preview itself — don't duplicate it as a plain button below.
  if (perf.timelineHref && !hasPreview) links.push({ label: 'timeline', href: perf.timelineHref });
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

/**
 * Body of a single per-viewport perf row: metric tables, timeline preview,
 * artifact buttons. `onOpen` bubbles the artifact click up to the enclosing
 * PerfSlot so one dialog instance is shared across all viewports on the card.
 */
function PerfError({ perf, test }: { perf: PerfArtifact; test: TestResult }) {
  const [open, setOpen] = useState(false);
  // Always render as a button even when the log is missing — clicking shows a
  // clear "log unavailable" message so the missing artifact is visible instead
  // of being silently swallowed by a non-clickable div.
  const logBody = perf.errorLog && perf.errorLog.length > 0
    ? perf.errorLog
    : LOG_UNAVAILABLE_MESSAGE;
  return (
    <>
      <button
        type="button"
        className="slot-error slot-error--clickable"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="slot-error__prefix">perf ·</span>
        <span className="slot-error__message">{perf.error}</span>
        <span className="slot-error__hint">view logs →</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={<span className="ui-dialog__title-text">perf · measurement logs</span>}
        meta={<TestMeta test={test} />}
      >
        <pre className="error-log">{logBody}</pre>
      </Dialog>
    </>
  );
}

function PerfBody({
  perf,
  test,
  onOpen,
}: {
  perf: PerfArtifact;
  test: TestResult;
  onOpen: (link: ArtifactLink) => void;
}) {
  const significant = perf.metrics.filter((m) => m.direction !== 'none');

  const grouped: Record<PerfMetricGroup, PerfMetric[]> = {
    vitals: [],
    diagnostics: [],
  };
  for (const m of significant) grouped[m.group].push(m);

  const hasPreview = perf.timelinePreviewSvg !== null && perf.timelineHref !== null;
  const links = artifactLinks(perf, hasPreview);

  const hasAny = significant.length > 0;

  return (
    <div>
      {perf.error ? <PerfError perf={perf} test={test} /> : null}
      {hasAny ? (
        GROUP_ORDER.filter((g) => grouped[g].length > 0).map((g) => (
          <PerfTable key={g} title={GROUP_LABEL[g]} metrics={grouped[g]} />
        ))
      ) : !perf.error ? (
        <div className="empty" style={{ padding: '20px 0' }}>no perf regressions or improvements</div>
      ) : null}

      {hasPreview && perf.timelinePreviewSvg && perf.timelineHref ? (
        <button
          type="button"
          className="timeline-preview"
          onClick={() => onOpen({ label: 'timeline', href: perf.timelineHref! })}
          aria-label="open timeline"
          dangerouslySetInnerHTML={{ __html: perf.timelinePreviewSvg }}
        />
      ) : null}

      {links.length > 0 ? (
        <div className="artifact-links" style={{ marginTop: 12 }}>
          {links.map((link) => (
            <button
              key={link.label}
              type="button"
              className="artifact-links__btn"
              onClick={() => onOpen(link)}
            >
              {link.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PerfSlot({ perfs = EMPTY, test }: { perfs?: PerfArtifact[]; test: TestResult }) {
  const [openArtifact, setOpenArtifact] = useState<ArtifactLink | null>(null);

  if (perfs.length === 0) {
    return <div className="empty" style={{ padding: '20px 0' }}>no perf artifacts</div>;
  }

  // Only show per-viewport headers when this test was measured at more than
  // one viewport — single-viewport tests (the common case) read cleanly as
  // just the metrics table without a redundant "desktop" label above it.
  const multi = perfs.length > 1;

  return (
    <div className="perf-slot">
      {perfs.map((perf) => (
        <div key={perf.viewportLabel} className="perf-slot__viewport">
          {multi ? (
            <div className="perf-slot__viewport-head">
              <span className="perf-slot__viewport-label">{perf.viewportLabel}</span>
            </div>
          ) : null}
          <PerfBody perf={perf} test={test} onOpen={setOpenArtifact} />
        </div>
      ))}

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
