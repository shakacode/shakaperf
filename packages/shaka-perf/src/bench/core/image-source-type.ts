/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ImageResolutionMeasurement } from './image-resolution';

// SVG is the only vector format an <img> displays. Any other image it decoded is a bitmap.
export function isVectorImageType(mimeType: string): boolean {
  return /^image\/svg\+xml$/i.test(mimeType);
}

export function classifyImageSources(
  measurements: ImageResolutionMeasurement[],
  rasterUrls: ReadonlySet<string>,
): ImageResolutionMeasurement[] {
  const classified: ImageResolutionMeasurement[] = [];
  for (const measurement of measurements) {
    const src = measurement.src;
    const inlineMimeType = /^data:([^;,]+)[;,]/i.exec(src)?.[1];
    // A URL without a recorded response, such as a blob: URL, stays unknown.
    const isRaster = inlineMimeType
      ? !isVectorImageType(inlineMimeType)
      : rasterUrls.has(src.split('#', 1)[0]!);
    if (isRaster) {
      classified.push(measurement);
    } else {
      const { sourceWidth, sourceHeight, ...image } = measurement;
      classified.push({ ...image, reason: image.reason ?? 'Image is vector or its response type was not recorded.' });
    }
  }
  return classified;
}
