import { useEffect, useMemo, useRef, useState } from 'react';
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
  /**
   * `'data-uri'` (default) — base64 data: URI decoded and embedded via
   * iframe `srcDoc`. `'relative'` — plain relative path, loaded lazily via
   * iframe `src`. Only the timeline uses `'relative'` today; the timeline
   * HTML is too big to inline, so the report references the on-disk file
   * instead and shows a fallback message when it's missing.
   */
  kind?: 'data-uri' | 'relative';
}

const TIMELINE_FALLBACK_MESSAGE =
  'TIMELINE COMPARISON IS ONLY AVAILABLE WHEN RUNNING PERFORMANCE TESTS LOCALLY';

// Matches the literal string the timeline HTML posts up via `window.parent
// .postMessage(...)` at the end of its boot script — see
// `timeline-comparison.ts`. Using a literal rather than a structured payload
// keeps the handshake minimal and easy to eyeball in DevTools.
const TIMELINE_READY_MESSAGE = 'shaka-timeline-loaded';

// How long to wait for the timeline's ready ping before giving up. Timelines
// render dozens of base64-encoded JPEGs, and first paint over file:// can be
// slow on underpowered machines — 4s leaves headroom without stalling the
// fallback indefinitely when the file is genuinely missing.
const TIMELINE_READY_TIMEOUT_MS = 4000;

function artifactLinks(perf: PerfArtifact, hasPreview: boolean): ArtifactLink[] {
  const links: ArtifactLink[] = [];
  if (perf.benchReportHref) links.push({ label: 'bench report', href: perf.benchReportHref });
  if (perf.controlLighthouseHref) links.push({ label: 'control lh', href: perf.controlLighthouseHref });
  if (perf.experimentLighthouseHref) links.push({ label: 'experiment lh', href: perf.experimentLighthouseHref });
  // When we have an inline preview SVG, the timeline is opened by clicking
  // the preview itself — don't duplicate it as a plain button below.
  if (perf.timelineHref && !hasPreview) {
    links.push({ label: 'timeline', href: perf.timelineHref, kind: 'relative' });
  }
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

// Resize the iframe so its height matches the content — otherwise Lighthouse
// and bench reports overflow and the bottom gets clipped. scrollHeight on the
// documentElement covers the full content even when the body has margin
// collapse / flex layouts that undersize body.
function fitIframeToContent(el: HTMLIFrameElement): void {
  const doc = el.contentDocument;
  if (!doc) return;
  const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
  if (h > 0) el.style.height = `${h}px`;
}

function ArtifactFrame({ href, label }: { href: string; label: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const html = useMemo(() => dataUriToHtml(href), [href]);

  const onLoad = () => {
    if (ref.current) fitIframeToContent(ref.current);
  };

  return (
    <iframe
      ref={ref}
      className="artifact-frame"
      srcDoc={html}
      title={label}
      onLoad={onLoad}
    />
  );
}

/**
 * Lazy-loads the timeline HTML from its on-disk relative URL instead of
 * inlining it. Detection needs to work under Chrome's file:// sandbox,
 * where every file URL is its own origin and `iframe.contentDocument`
 * is unreadable from the parent — so we can't sniff the loaded page
 * directly. Instead the timeline HTML itself pings the parent via
 * `window.parent.postMessage('shaka-timeline-loaded', '*')` on boot;
 * we listen for that message, and if it never arrives within the
 * timeout we show the huge-letters "timeline only available locally"
 * fallback.
 */
function TimelineFrame({ href, label }: { href: string; label: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let loaded = false;
    const onMessage = (ev: MessageEvent) => {
      // `ev.source` is the iframe's window on successful load; guard on it
      // so an unrelated postMessage from elsewhere on the page can't
      // mis-signal a successful timeline render.
      if (ev.data === TIMELINE_READY_MESSAGE && ev.source === ref.current?.contentWindow) {
        loaded = true;
        if (ref.current) fitIframeToContent(ref.current);
      }
    };
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(() => {
      if (!loaded) setMissing(true);
    }, TIMELINE_READY_TIMEOUT_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
  }, [href]);

  if (missing) {
    return <div className="timeline-missing">{TIMELINE_FALLBACK_MESSAGE}</div>;
  }

  return (
    <iframe
      ref={ref}
      className="artifact-frame"
      src={href}
      title={label}
      loading="lazy"
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
          onClick={() => onOpen({ label: 'timeline', href: perf.timelineHref!, kind: 'relative' })}
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
          openArtifact.kind === 'relative' ? (
            // Key on href so switching between per-viewport timelines while
            // the dialog stays open remounts the frame and re-probes the
            // on-disk file — otherwise a prior "missing" status would stick.
            <TimelineFrame
              key={openArtifact.href}
              href={openArtifact.href}
              label={openArtifact.label}
            />
          ) : (
            <ArtifactFrame href={openArtifact.href} label={openArtifact.label} />
          )
        ) : null}
      </Dialog>
    </div>
  );
}
