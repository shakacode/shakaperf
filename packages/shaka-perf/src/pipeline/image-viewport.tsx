/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export const ImageSizeContext = createContext<'fit' | 'actual'>('fit');

/** Size the coordinate plane, not just the image, so percentage annotations stay aligned. */
export function ImageViewport({ children, width, height }: {
  children: ReactNode;
  width?: number;
  height?: number;
}) {
  const mode = useContext(ImageSizeContext);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: width ?? 0, height: height ?? 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    const readImage = () => {
      const img = el.querySelector('img');
      if (img?.naturalWidth) setNatural({ width: width || img.naturalWidth, height: height || img.naturalHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener('load', readImage, true);
    readImage();
    measure();
    return () => {
      observer.disconnect();
      el.removeEventListener('load', readImage, true);
    };
  }, [width, height]);

  const scale = mode === 'fit' && natural.width && natural.height
    ? Math.min(1, box.width / natural.width, box.height / natural.height)
    : 1;
  return (
    <div className="image-viewport" data-size={mode} ref={ref} tabIndex={0} aria-label="Image viewport">
      <div className="image-viewport__plane" style={natural.width && natural.height ? {
        width: natural.width * scale,
        height: natural.height * scale,
      } : undefined}>
        {children}
      </div>
    </div>
  );
}
