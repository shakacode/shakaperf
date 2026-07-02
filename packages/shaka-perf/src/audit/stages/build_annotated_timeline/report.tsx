/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import {
  DetailedArtifactDialog,
  StageArtifact,
  StageArtifactTitle,
} from '../../../pipeline/stage-report-components';
import { useReportMode } from '../../../pipeline/report-mode';
import {
  groupFramesByAnnotation,
  type AnnotatedFrame,
  type BuildAnnotatedTimelineResult,
} from './stage';

// Per-tile CSS-pixel target. The actual rendered tile width is whatever a
// CSS-grid auto-fill cell ends up being (the container width / column count),
// so this is the lower bound: narrower containers use fewer
// columns. DPR ≥ 2 screens consume MIN_TILE_CSS_PX × DPR hardware pixels per
// tile. The self-contained report inlines ~256px AVIF thumbnails; the full
// local report lazy-loads full-size frames from disk via imageHref.
const MIN_TILE_CSS_PX = 72;
const DIALOG_MIN_TILE_CSS_PX = 180;
const PREVIEW_MAX_HEIGHT = 400;

export function BuildAnnotatedTimelineArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<BuildAnnotatedTimelineResult>[];
}) {
  const mode = useReportMode();
  const rows = measurements
    .map((entry) => ({ timeline: entry.measurement, viewportLabel: entry.viewport.label }))
    .filter(({ timeline }) => {
      const frames = timeline.frames;
      if (!frames || frames.length === 0) return false;
      return frames.some((f) => resolveFrameImageSrc(f) != null);
    });
  if (rows.length === 0) return null;

  return (
    <StageArtifact>
      <StageArtifactTitle>annotated timeline</StageArtifactTitle>
      <div className="stage-stack">
        {rows.map((row, index) => {
          const frames = row.timeline.frames!;
          return (
            <div key={`${row.viewportLabel}-${index}`} className="stage-stack__viewport">
              <div className="stage-section">
                <div className="stage-section__head">{row.viewportLabel}</div>
                <DetailedArtifactDialog
                  body={
                    <AnnotatedTimelineDialog
                      frames={frames}
                      screencastHref={mode === 'lightweight' ? undefined : row.timeline.screencastHref}
                      debugAllFrames={row.timeline.debugAllFrames}
                    />
                  }
                  variant="preview"
                  href="#"
                  label="annotated timeline"
                >
                  <GroupedTimeline
                    frames={frames}
                    minTileCssPx={MIN_TILE_CSS_PX}
                    clipMaxHeight={PREVIEW_MAX_HEIGHT}
                  />
                </DetailedArtifactDialog>
              </div>
            </div>
          );
        })}
      </div>
    </StageArtifact>
  );
}

// Per-group accent + background fill. Groups cycle through this palette by
// index so adjacent timeline phases stay visually distinct; the `initial page
// load` group is group 0 and gets the first entry. `fill` is the soft colour
// field a group's frames sit on; `accent` is the saturated colour used both for
// the group's title text and for the left/bottom border that brackets the group
// (see `FrameTile`).
interface GroupColor {
  accent: string;
  fill: string;
}
const GROUP_PALETTE: readonly GroupColor[] = [
  { accent: '#2563eb', fill: 'rgba(37,99,235,0.16)' }, // blue
  { accent: '#16a34a', fill: 'rgba(22,163,74,0.16)' }, // green
  { accent: '#d97706', fill: 'rgba(217,119,6,0.18)' }, // amber
  { accent: '#9333ea', fill: 'rgba(147,51,234,0.16)' }, // purple
  { accent: '#dc2626', fill: 'rgba(220,38,38,0.15)' }, // red
  { accent: '#0891b2', fill: 'rgba(8,145,178,0.18)' }, // cyan
  { accent: '#db2777', fill: 'rgba(219,39,119,0.15)' }, // pink
  { accent: '#65a30d', fill: 'rgba(101,163,13,0.18)' }, // lime
];

interface TimelineCell {
  frame: AnnotatedFrame;
  color: GroupColor;
  // Set only on a group's first frame — the wrapping title that names the
  // subarray, and the marker for the group's accent left border. Frames flow
  // continuously, so the next group simply begins at its titled first frame
  // right after the previous group's last frame.
  title?: string;
}

/**
 * One continuous, condensed CSS-grid timeline. Every frame is a cell in a
 * single shared grid (auto-fill columns, gapless), so frames flow and wrap
 * densely with no breaks between groups — the next group's first frame starts
 * immediately after the previous group's last. Grouping is conveyed by colour:
 * every frame in an `AnnotatedFrameGroup` shares the group's `fill` and an
 * accent bottom border, and the group's first frame additionally carries an
 * accent left border beside its title — together bracketing the group and
 * accentuating its annotation text (see `FrameTile`). `clipMaxHeight` clips the
 * collapsed preview.
 */
function GroupedTimeline({
  frames,
  minTileCssPx,
  clipMaxHeight,
}: {
  frames: readonly AnnotatedFrame[];
  minTileCssPx: number;
  clipMaxHeight?: number;
}) {
  const cells: TimelineCell[] = groupFramesByAnnotation(frames).flatMap((group, gi) => {
    const color = GROUP_PALETTE[gi % GROUP_PALETTE.length]!;
    return group.frames.map((frame, fi) => ({
      frame,
      color,
      title: fi === 0 ? group.label : undefined,
    }));
  });
  const wrapperStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minTileCssPx}px, 1fr))`,
    // Gapless: tiles abut so each group's colour fill forms one continuous
    // block. The breathing room between frame images comes from the tiles'
    // own colour-filled padding, which merges across the seamless edges.
    gap: 0,
    background: '#ffffff',
    border: '1px solid var(--border, #d1d5db)',
    width: '100%',
    boxSizing: 'border-box',
    ...(clipMaxHeight != null ? { maxHeight: clipMaxHeight, overflow: 'hidden', position: 'relative' as const } : {}),
  };
  return (
    <div style={wrapperStyle}>
      {cells.map((cell, i) => (
        <FrameTile
          key={`${cell.frame.timeMs}-${i}`}
          frame={cell.frame}
          color={cell.color}
          title={cell.title}
          minTileCssPx={minTileCssPx}
        />
      ))}
      {clipMaxHeight != null ? <ClipGradient /> : null}
    </div>
  );
}

function ClipGradient() {
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        background: 'linear-gradient(to bottom, transparent 70%, var(--bg-elevated, #f5f6f8) 100%)',
      }}
    />
  );
}

function FrameTile({
  frame,
  color,
  title,
  minTileCssPx,
}: {
  frame: AnnotatedFrame;
  color: GroupColor;
  title?: string;
  minTileCssPx: number;
}) {
  const src = resolveFrameImageSrc(frame);
  if (!src) return null;
  // Test-supplied `performance.mark('shaka-perf-annotation: …')` labels title
  // the group's first frame: rendered below the timing (never over the image)
  // and wrapped onto as many lines as needed (never cut). Keeping it below the
  // fixed-height image + timestamp means the title grows downward, so images
  // stay aligned across the row instead of jumping. Font scales with tile width.
  const titleFontSize = Math.max(9, Math.min(13, Math.round(minTileCssPx * 0.075)));
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        minWidth: 0,
        // Group fill: the padding is filled with the group colour and — because
        // the grid has no gaps — merges with neighbouring same-group tiles into
        // one continuous block. The accent borders bracket the group without
        // breaking the condensed flow: a bottom border under every frame
        // underlines the group across whatever rows it wraps onto, and a left
        // border on the titled first frame marks where the group — and its
        // annotation text — begins.
        background: color.fill,
        borderBottom: `3px solid ${color.accent}`,
        ...(title != null ? { borderLeft: `4px solid ${color.accent}` } : {}),
        padding: 4,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          // Aspect ratio reserves layout space before the image decodes so
          // the grid doesn't reflow when individual frames stream in.
          aspectRatio: `${frame.imgW > 0 ? frame.imgW : 1} / ${frame.imgH > 0 ? frame.imgH : 1}`,
          // Transparent so letterbox bars (objectFit: contain) show the group
          // colour rather than breaking the block with white rectangles.
          background: 'transparent',
          boxSizing: 'border-box',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <img
          src={src}
          alt={`frame ${formatMs(frame.timeMs)}`}
          loading="lazy"
          decoding="async"
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
        <FrameOverlaySvg frame={frame} />
      </div>
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9,
          color: 'var(--fg-muted, #5a6470)',
          lineHeight: 1.2,
          marginTop: 2,
          textAlign: 'center',
          // `aspect-ratio` placeholders inherit the tile width; suppress
          // overflow if a label is wider than the tile (rare; tile widths
          // are >60 px) by truncating.
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        // Keep aspect-ratio reserved area unaware of the timestamp height
        // so the IMG box stays a clean rectangle.
      >
        {formatMs(frame.timeMs)}
      </span>
      {title != null ? (
        <div
          style={{
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontSize: titleFontSize,
            fontWeight: 700,
            color: color.accent,
            lineHeight: 1.25,
            marginTop: 4,
            // Full label, never clipped: wrap onto as many lines as it needs.
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </div>
      ) : null}
    </div>
  );
}

function FrameOverlaySvg({ frame }: { frame: AnnotatedFrame }) {
  // Test-annotation labels title the group's full-width `GroupTitle` header,
  // not in-frame pills — drop them here so they don't generate empty colored
  // chips with no rect/pill style assigned.
  const annotations = (frame.annotations ?? []).filter((a) => a.kind !== 'test-annotation');
  const arrows = frame.arrows ?? [];
  if ((annotations.length === 0 && arrows.length === 0) || frame.imgW <= 0 || frame.imgH <= 0) {
    return null;
  }

  const imgW = frame.imgW;
  const imgH = frame.imgH;
  const fontSize = Math.max(10, Math.round(imgW * 0.045));
  const pillH = Math.round(fontSize * 1.3);
  const pillPad = Math.max(2, Math.round(fontSize * 0.4));
  const chipInset = Math.min(20, Math.max(4, Math.round(imgW * 0.04)));
  const chipGap = Math.max(2, Math.round(fontSize * 0.2));
  const brushScale = Math.max(0.2, Math.min(0.4, imgW * 0.00045));
  const brushStrokeW = Math.max(1, 1.5 / brushScale);

  return (
    <svg
      viewBox={`0 0 ${imgW} ${imgH}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      {annotations.map((ann, annIndex) => {
        const rects = ann.kind === 'layout-shift' ? ann.rects ?? [] : [];
        return rects.map((r, rectIndex) => {
          const x = r[0] ?? 0;
          const y = r[1] ?? 0;
          const width = r[2] ?? 0;
          const height = r[3] ?? 0;
          return (
            <rect
              key={`layout-shift-${annIndex}-${rectIndex}`}
              data-annotation-kind={ann.kind}
              x={x}
              y={y}
              width={width}
              height={height}
              fill="rgba(220,38,38,0.28)"
              stroke="#dc2626"
              strokeWidth={2}
            />
          );
        });
      })}
      {annotations.map((ann, annIndex) => {
        const rect = ann.kind === 'pw-interaction' ? ann.pwRect : undefined;
        if (!rect) return null;
        const outset = 2;
        const x = rect.x - outset;
        const y = rect.y - outset;
        const width = rect.width + outset * 2;
        const height = rect.height + outset * 2;
        return (
          <g key={`pw-interaction-${annIndex}`} data-annotation-kind={ann.kind}>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill="none"
              stroke="#000000"
              strokeWidth={3}
            />
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill="rgba(37,99,235,0.28)"
              stroke="#2563eb"
              strokeWidth={1}
            />
          </g>
        );
      })}
      {arrows.length > 0 && arrows.length <= 2
        ? arrows.map((arrow, index) => {
          const tipX = Math.max(0, Math.min(imgW - 1, arrow.targetX));
          const tipY = Math.max(0, Math.min(imgH - 1, arrow.y));
          return (
            <g
              key={`brush-${index}`}
              transform={`translate(${tipX} ${tipY}) scale(${brushScale} ${brushScale}) translate(0 -103.78)`}
            >
              <path
                d={BRUSH_PATH}
                fill="#facc15"
                stroke="rgba(0,0,0,0.7)"
                strokeWidth={brushStrokeW}
                strokeLinejoin="round"
                fillRule="evenodd"
              />
            </g>
          );
        })
        : null}
      {annotations.map((ann, index) => {
        const fill = ann.kind === 'lcp'
          ? '#16a34a'
          : ann.kind === 'layout-shift'
            ? '#dc2626'
            : '#2563eb';
        const pillY = chipInset + index * (pillH + chipGap);
        const textW = ann.label.length * fontSize * 0.6 + pillPad * 2;
        const pillW = Math.max(1, Math.min(imgW - chipInset * 2, textW));
        const baselineY = pillY + (pillH - fontSize) / 2 + fontSize * 0.8;
        return (
          <g key={`label-${index}`} data-annotation-kind={ann.kind}>
            <rect
              x={chipInset}
              y={pillY}
              width={pillW}
              height={pillH}
              rx={2}
              ry={2}
              fill={fill}
            />
            <text
              x={chipInset + pillPad}
              y={baselineY}
              fontFamily="ui-monospace, monospace"
              fontSize={fontSize}
              fontWeight={700}
              fill="#ffffff"
            >
              {ann.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AnnotatedTimelineDialog({
  frames,
  screencastHref,
  debugAllFrames,
}: {
  frames: readonly AnnotatedFrame[];
  screencastHref?: string;
  debugAllFrames?: readonly AnnotatedFrame[];
}) {
  // Force a re-render when the dialog body resizes so we get a clean layout
  // pass after the dialog modal animates open. The grid itself is fully
  // CSS-driven, so we don't need the measured value — just the trigger.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setTick((n) => n + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={ANNOTATED_TIMELINE_DIALOG_STYLE}>
      {screencastHref ? (
        <video
          src={screencastHref}
          controls
          preload="metadata"
          style={ANNOTATED_TIMELINE_VIDEO_STYLE}
        />
      ) : null}
      <GroupedTimeline frames={frames} minTileCssPx={DIALOG_MIN_TILE_CSS_PX} />
      {debugAllFrames && debugAllFrames.length > 0 ? (
        <DebugAllFramesTimeline frames={debugAllFrames} />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Diagnostics-only: full, non-deduped timeline (audit `--debug-show-all-frames`).
// Renders EVERY synced screencast frame in a dense flat grid, each labelled with
// its pixel diff vs the previous KEPT frame (`prevDiff`) — exactly the signal the
// dedupe thresholds on (it accumulates change against the last non-discarded
// frame, not each immediate neighbour). Frames that survived into the rendered
// (deduped) timeline are highlighted; collapsed frames are dimmed. Lives behind a
// <details> so it stays out of the way until you go looking for why a frame was
// dropped.
// ----------------------------------------------------------------------------

const DEBUG_KEPT_ACCENT = '#16a34a'; // green — frame survived the dedupe
const DEBUG_DROPPED_DIM = 0.55; // opacity for collapsed (deduped-away) frames

function DebugAllFramesTimeline({ frames }: { frames: readonly AnnotatedFrame[] }) {
  const visible = frames.filter((f) => resolveFrameImageSrc(f) != null);
  if (visible.length === 0) return null;
  const keptCount = visible.filter((f) => f.keptByDedupe).length;
  return (
    <details style={{ marginTop: 10 }}>
      <summary
        style={{
          cursor: 'pointer',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--fg-muted, #5a6470)',
          userSelect: 'none',
        }}
      >
        debug: all {visible.length} frames (no dedupe) — {keptCount} kept,{' '}
        {visible.length - keptCount} collapsed · each labelled Δ vs previous kept frame
      </summary>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_TILE_CSS_PX}px, 1fr))`,
          gap: 2,
          marginTop: 8,
          border: '1px solid var(--border, #d1d5db)',
          background: '#ffffff',
          padding: 4,
          boxSizing: 'border-box',
        }}
      >
        {visible.map((frame, i) => (
          <DebugFrameTile key={`${frame.timeMs}-${i}`} frame={frame} />
        ))}
      </div>
    </details>
  );
}

function DebugFrameTile({ frame }: { frame: AnnotatedFrame }) {
  const src = resolveFrameImageSrc(frame)!;
  const kept = frame.keptByDedupe === true;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        minWidth: 0,
        padding: 3,
        boxSizing: 'border-box',
        background: kept ? 'rgba(22,163,74,0.12)' : 'transparent',
        border: kept ? `2px solid ${DEBUG_KEPT_ACCENT}` : '2px solid transparent',
        opacity: kept ? 1 : DEBUG_DROPPED_DIM,
      }}
    >
      <div
        style={{
          width: '100%',
          aspectRatio: `${frame.imgW > 0 ? frame.imgW : 1} / ${frame.imgH > 0 ? frame.imgH : 1}`,
          overflow: 'hidden',
        }}
      >
        <img
          src={src}
          alt={`frame ${formatMs(frame.timeMs)}`}
          loading="lazy"
          decoding="async"
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9,
          color: 'var(--fg-muted, #5a6470)',
          lineHeight: 1.2,
          marginTop: 2,
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {formatMs(frame.timeMs)}
      </span>
      <span
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9,
          fontWeight: kept ? 700 : 400,
          color: kept ? DEBUG_KEPT_ACCENT : 'var(--fg-muted, #8a94a0)',
          lineHeight: 1.2,
          textAlign: 'center',
        }}
      >
        {formatDiff(frame.prevDiff)}
      </span>
    </div>
  );
}

function formatDiff(prevDiff: AnnotatedFrame['prevDiff']): string {
  if (!prevDiff) return 'Δ —';
  const pct = prevDiff.fraction * 100;
  // Sub-0.1% diffs are the near-identical idle frames the dedupe collapses;
  // show extra precision there so they don't all read as "Δ0.0%".
  const text = pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);
  return `Δ${text}%`;
}

function resolveFrameImageSrc(frame: AnnotatedFrame): string | undefined {
  return frame.imageDataUri ?? frame.imageHref;
}

function formatMs(timeMs: number): string {
  if (Math.abs(timeMs) >= 1000) return `${(timeMs / 1000).toFixed(2)}s`;
  return `${Math.round(timeMs)}ms`;
}

const ANNOTATED_TIMELINE_DIALOG_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 16,
  width: '100%',
};

const ANNOTATED_TIMELINE_VIDEO_STYLE: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  maxHeight: 400,
  margin: '0 auto 16px',
};

const BRUSH_PATH = 'M0,103.78c11.7-8.38,30.46.62,37.83-14a16.66,16.66,0,0,0,.62-13.37,10.9,10.9,0,0,0-3.17-4.35,11.88,11.88,0,0,0-2.11-1.35c-9.63-4.78-19.67,1.91-25,10-4.9,7.43-7,16.71-8.18,23.07ZM54.09,43.42a54.31,54.31,0,0,1,15,18.06l50.19-49.16c3.17-3,5-5.53,2.3-10.13A6.5,6.5,0,0,0,117.41,0,7.09,7.09,0,0,0,112.8,1.6L54.09,43.42Zm-16.85,22c2.82,1.52,6.69,5.25,7.61,9.32L65.83,64c-3.78-7.54-8.61-14-15.23-18.58-6.9,9.27-5.5,11.17-13.36,20Z';
