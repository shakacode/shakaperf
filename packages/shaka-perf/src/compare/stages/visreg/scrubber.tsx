/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

interface ScrubberProps {
  beforeSrc: string; // control
  afterSrc: string; // experiment
  /** Natural width and tallest-of-the-two height. Box is sized to these. */
  imgW?: number;
  maxImgH?: number;
}

/**
 * Before/after scrubber. Originally lived in the report-shell's VisregSlot and
 * was dropped in the "Extensible architecture" refactor (94bc09a); restored
 * here as a self-contained column for the visreg diff dialog.
 *
 * The box is sized to `imgW × maxImgH` (the taller of the two source heights)
 * via `aspect-ratio`, and fills its grid column (`width: 100%`, capped by the
 * natural width). The "base" (experiment) fills its natural region. The
 * "control side" is an absolutely-positioned layer covering the whole box —
 * the control image sits at its top, and the empty region below (where control
 * has no pixels because it's shorter) is painted with a solid background. A
 * clip-path driven by `--scrub-pos` reveals the control side only from the left
 * up to the divider. Consequences:
 *
 * - divider at 0%: control side fully hidden → full experiment visible,
 *   including the tail that extends past control's height.
 * - divider at 100%: control side fully visible → top portion shows the
 *   control image, bottom portion is the background color which covers
 *   experiment's tail (no mixed/unpaired content leaks through).
 *
 * When `imgW` / `maxImgH` aren't known (rare — rows without diffBbox), fall
 * back to letting `.scrubber__base` drive the size in flow.
 */
export function Scrubber({ beforeSrc, afterSrc, imgW, maxImgH }: ScrubberProps) {
  const [pos, setPos] = useState(50);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = hostRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, pct)));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      updateFromClientX(e.clientX);
      try {
        // setPointerCapture throws on synthetic events (DOM-dispatched from
        // tests without a real pointer). Position update above still works.
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    },
    [updateFromClientX],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        updateFromClientX(e.clientX);
      }
    },
    [updateFromClientX],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const hasBox = imgW != null && maxImgH != null && imgW > 0 && maxImgH > 0;
  const hostStyle: CSSProperties = {
    ['--scrub-pos' as string]: `${pos}%`,
    ...(hasBox ? { aspectRatio: `${imgW} / ${maxImgH}` } : null),
  };

  return (
    <div
      ref={hostRef}
      className={hasBox ? 'scrubber scrubber--boxed' : 'scrubber'}
      style={hostStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img className="scrubber__base" src={afterSrc} alt="" draggable={false} />
      <div className="scrubber__control-side" aria-hidden="true">
        <img className="scrubber__control-img" src={beforeSrc} alt="" draggable={false} />
      </div>
      {/* Full-width side layers so the clip-path percentages are relative to
          the scrubber width: the CONTROL tag is revealed only left of the
          divider (in lockstep with the control image), EXPERIMENT only right of
          it — so each label hides the moment the wipe passes over it. */}
      <div className="scrubber__tags" aria-hidden="true">
        <div className="scrubber__tag-side scrubber__tag-side--left">
          <span className="scrubber__tag">control</span>
        </div>
        <div className="scrubber__tag-side scrubber__tag-side--right">
          <span className="scrubber__tag">experiment</span>
        </div>
      </div>
      <div className="scrubber__handle" aria-hidden="true">
        <div className="scrubber__handle-grip" />
      </div>
    </div>
  );
}
