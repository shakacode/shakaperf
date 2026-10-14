/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * Side-by-side playback of the two runs' trace screenshots. Presentational
 * only: at a moment on a shared navigation-relative clock, each side shows the
 * last frame captured by then. Two optional overlays paint pixels in red -
 * "updates" marks what changed since that side's previous frame, "diff" marks
 * where the two sides disagree, drawn in the middle column.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SIDE_BY_SIDE_FRAMES_GLOBAL,
  type SideBySideFrame,
  type SideBySideFrames,
} from '../../../bench/core/side-by-side-frames';
import { Dialog, TestMeta, useStageArtifactTest } from '../../../pipeline/stage-report-components';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10] as const;
const CHANGED_PIXEL_THRESHOLD = 8;
const HIGHLIGHT = { r: 220, g: 38, b: 38 } as const;

type Side = 'control' | 'experiment';
const SIDES: readonly Side[] = ['control', 'experiment'];

type FramesRegistry = WeakMap<HTMLScriptElement, SideBySideFrames>;

function loadFrames(href: string): Promise<SideBySideFrames> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = href;
    script.onload = () => {
      const registry = (window as unknown as Record<string, FramesRegistry | undefined>)[SIDE_BY_SIDE_FRAMES_GLOBAL];
      const frames = registry?.get(script);
      script.remove();
      if (frames) resolve(frames);
      else reject(new Error(`${href} loaded but registered no frames`));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`could not load ${href}`));
    };
    document.head.appendChild(script);
  });
}

async function decodeFrames(frames: readonly SideBySideFrame[]): Promise<HTMLImageElement[]> {
  return Promise.all(frames.map(async (frame) => {
    const image = new Image();
    image.src = frame.src;
    await image.decode();
    return image;
  }));
}

/**
 * Index of the last frame captured at or before `timeMs`. Before the first
 * capture the first frame stands in, so a side is never empty; -1 only when
 * the side has no frames at all.
 */
export function frameIndexAt(frames: readonly { timeMs: number }[], timeMs: number): number {
  if (frames.length === 0) return -1;
  let index = 0;
  for (let i = 1; i < frames.length && frames[i].timeMs <= timeMs; i++) index = i;
  return index;
}

const READ_BACK: CanvasRenderingContext2DSettings = { willReadFrequently: true };

function pixelsOf(image: HTMLImageElement, scratch: HTMLCanvasElement, w: number, h: number): Uint8ClampedArray {
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', READ_BACK)!;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

function changed(a: Uint8ClampedArray, b: Uint8ClampedArray, i: number): boolean {
  return Math.max(
    Math.abs(a[i] - b[i]),
    Math.abs(a[i + 1] - b[i + 1]),
    Math.abs(a[i + 2] - b[i + 2]),
  ) > CHANGED_PIXEL_THRESHOLD;
}

/** Paints `image` and, over it, every pixel that differs from `previous`. */
function paintFrame(
  canvas: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  image: HTMLImageElement,
  previous: HTMLImageElement | null,
): void {
  const ctx = canvas.getContext('2d', READ_BACK)!;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);
  if (!previous) return;
  const w = Math.min(image.naturalWidth, previous.naturalWidth);
  const h = Math.min(image.naturalHeight, previous.naturalHeight);
  const now = pixelsOf(image, scratch, w, h);
  const before = pixelsOf(previous, scratch, w, h);
  const overlay = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < overlay.data.length; i += 4) {
    if (!changed(now, before, i)) continue;
    overlay.data[i] = HIGHLIGHT.r;
    overlay.data[i + 1] = HIGHLIGHT.g;
    overlay.data[i + 2] = HIGHLIGHT.b;
  }
  ctx.putImageData(overlay, 0, 0);
}

/** Paints a pale ghost of `experiment` with every pixel unlike `control` in red. */
function paintDiff(
  canvas: HTMLCanvasElement,
  scratch: HTMLCanvasElement,
  control: HTMLImageElement,
  experiment: HTMLImageElement,
): void {
  const ctx = canvas.getContext('2d', READ_BACK)!;
  const w = Math.min(control.naturalWidth, experiment.naturalWidth);
  const h = Math.min(control.naturalHeight, experiment.naturalHeight);
  const a = pixelsOf(control, scratch, w, h);
  const b = pixelsOf(experiment, scratch, w, h);
  canvas.width = w;
  canvas.height = h;
  const out = ctx.createImageData(w, h);
  for (let i = 0; i < out.data.length; i += 4) {
    if (changed(a, b, i)) {
      out.data[i] = HIGHLIGHT.r;
      out.data[i + 1] = HIGHLIGHT.g;
      out.data[i + 2] = HIGHLIGHT.b;
    } else {
      const faded = 255 - (255 - b[i + 1]) * 0.15;
      out.data[i] = faded;
      out.data[i + 1] = faded;
      out.data[i + 2] = faded;
    }
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function FramePlayerButton({ href }: { href: string }) {
  const [open, setOpen] = useState(false);
  const test = useStageArtifactTest();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>play frames</button>
      {open ? (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          variant="wide"
          title={<span className="ui-dialog__title-text">frames side by side</span>}
          meta={test ? <TestMeta test={test} /> : null}
        >
          <FramePlayer href={href} />
        </Dialog>
      ) : null}
    </>
  );
}

type Loaded = {
  frames: SideBySideFrames;
  images: Record<Side, HTMLImageElement[]>;
};

export function FramePlayer({ href }: { href: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const frames = await loadFrames(href);
        const [control, experiment] = await Promise.all([
          decodeFrames(frames.control),
          decodeFrames(frames.experiment),
        ]);
        if (!cancelled) setLoaded({ frames, images: { control, experiment } });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [href]);

  if (error) return <div className="frame-player__status">{error}</div>;
  if (!loaded) return <div className="frame-player__status">loading frames…</div>;
  return <LoadedFramePlayer frames={loaded.frames} images={loaded.images} />;
}

function LoadedFramePlayer({ frames, images }: Loaded) {
  const durationMs = useMemo(
    () => Math.max(0, ...SIDES.flatMap((side) => frames[side].map((f) => f.timeMs))),
    [frames],
  );
  const [timeMs, setTimeMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [highlightUpdates, setHighlightUpdates] = useState(false);
  const [highlightDiff, setHighlightDiff] = useState(false);

  const canvases = useRef<Record<Side, HTMLCanvasElement | null>>({ control: null, experiment: null });
  const diffCanvas = useRef<HTMLCanvasElement | null>(null);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  if (!scratch.current && typeof document !== 'undefined') scratch.current = document.createElement('canvas');

  // The clock: advance by wall time times speed while playing, stop at the end.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let handle = 0;
    const tick = (now: number) => {
      const elapsed = (now - last) * speed;
      last = now;
      setTimeMs((t) => {
        const next = t + elapsed;
        if (next >= durationMs) {
          setPlaying(false);
          return durationMs;
        }
        return next;
      });
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, speed, durationMs]);

  const indices = useMemo(() => ({
    control: frameIndexAt(frames.control, timeMs),
    experiment: frameIndexAt(frames.experiment, timeMs),
  }), [frames, timeMs]);

  useEffect(() => {
    for (const side of SIDES) {
      const canvas = canvases.current[side];
      if (!canvas) continue;
      const index = indices[side];
      if (index < 0) continue;
      const previous = highlightUpdates && index > 0 ? images[side][index - 1] : null;
      paintFrame(canvas, scratch.current!, images[side][index], previous);
    }
    if (highlightDiff && diffCanvas.current) {
      if (indices.control >= 0 && indices.experiment >= 0) {
        paintDiff(
          diffCanvas.current,
          scratch.current!,
          images.control[indices.control],
          images.experiment[indices.experiment],
        );
      }
    }
  }, [indices, images, highlightUpdates, highlightDiff]);

  const togglePlay = useCallback(() => {
    setPlaying((was) => {
      if (!was && timeMs >= durationMs) setTimeMs(0);
      return !was;
    });
  }, [timeMs, durationMs]);

  const frameCaption = (side: Side): string => {
    const index = indices[side];
    if (index < 0) return 'no frames';
    return `frame ${index + 1}/${frames[side].length} · ${formatSeconds(frames[side][index].timeMs)}`;
  };

  return (
    <div className="frame-player">
      <div className="frame-player__controls">
        <button type="button" className="frame-player__play" onClick={togglePlay} aria-label={playing ? 'pause' : 'play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          className="frame-player__scrub"
          min={0}
          max={durationMs}
          step={1}
          value={Math.round(timeMs)}
          onChange={(e) => { setPlaying(false); setTimeMs(Number(e.target.value)); }}
          aria-label="time"
        />
        <span className="frame-player__time">{formatSeconds(timeMs)} / {formatSeconds(durationMs)}</span>
        <label className="frame-player__option">
          speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <label className="frame-player__option">
          <input type="checkbox" checked={highlightUpdates} onChange={(e) => setHighlightUpdates(e.target.checked)} />
          highlight updates
        </label>
        <label className="frame-player__option">
          <input type="checkbox" checked={highlightDiff} onChange={(e) => setHighlightDiff(e.target.checked)} />
          highlight diff
        </label>
      </div>
      <div className={`frame-player__stage${highlightDiff ? ' frame-player__stage--with-diff' : ''}`}>
        <figure className="frame-player__side">
          <canvas ref={(el) => { canvases.current.control = el; }} />
          <figcaption><b>control</b> {frameCaption('control')}</figcaption>
        </figure>
        {highlightDiff ? (
          <figure className="frame-player__side frame-player__side--diff">
            <canvas ref={diffCanvas} />
            <figcaption><b>diff</b> pixels unlike between the two</figcaption>
          </figure>
        ) : null}
        <figure className="frame-player__side">
          <canvas ref={(el) => { canvases.current.experiment = el; }} />
          <figcaption><b>experiment</b> {frameCaption('experiment')}</figcaption>
        </figure>
      </div>
    </div>
  );
}
