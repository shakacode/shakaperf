/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export const ImageSizeContext = createContext<'fit' | 'actual'>('fit');

/** Size the coordinate plane, not just the image, so percentage annotations stay aligned. */
export function ImageViewport({ children, width, height, actualSize = 'intrinsic' }: {
  children: ReactNode;
  actualSize?: 'intrinsic' | 'fit-width';
  width?: number;
  height?: number;
}) {
  const mode = useContext(ImageSizeContext);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [natural, setNatural] = useState({ width: width ?? 0, height: height ?? 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox({ width: el.clientWidth, height: el.clientHeight, left: rect.left, top: rect.top });
    };
    const readImage = () => {
      const img = el.querySelector('img');
      if (img?.naturalWidth) setNatural({ width: width || img.naturalWidth, height: height || img.naturalHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    el.addEventListener('load', readImage, true);
    readImage();
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      el.removeEventListener('load', readImage, true);
    };
  }, [width, height]);

  const scale = natural.width && natural.height
    ? mode === 'fit'
      ? Math.min(1, box.width / natural.width, box.height / natural.height)
      : actualSize === 'fit-width' ? Math.min(1, box.width / natural.width) : 1
    : 1;
  return (
    <div
      className="image-viewport"
      data-size={mode}
      data-actual-size={actualSize}
      ref={ref}
      tabIndex={0}
      aria-label="Image viewport"
      style={{
        '--image-pane-center-x': `${box.left + box.width / 2}px`,
        '--image-pane-center-y': `${box.top + box.height / 2}px`,
        '--image-pane-height': `${box.height}px`,
      } as CSSProperties}
    >
      <div className="image-viewport__plane" style={natural.width && natural.height ? {
        width: natural.width * scale,
        height: natural.height * scale,
      } : undefined}>
        {children}
      </div>
    </div>
  );
}
