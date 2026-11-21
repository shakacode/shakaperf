/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ImageResolutionMeasurement } from './image-resolution';

export function isRasterImageType(mimeType: string): boolean {
  return /^image\/(?:png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|apng)$/i.test(mimeType);
}

export function classifyImageSources(
  measurements: ImageResolutionMeasurement[],
  rasterUrls: ReadonlySet<string>,
): ImageResolutionMeasurement[] {
  const classified: ImageResolutionMeasurement[] = [];
  for (const measurement of measurements) {
    const src = measurement.src;
    const inlineMimeType = /^data:([^;,]+)[;,]/i.exec(src)?.[1];
    const isRaster = inlineMimeType
      ? isRasterImageType(inlineMimeType)
      : rasterUrls.has(src.split('#', 1)[0]!);
    if (isRaster) {
      classified.push(measurement);
    } else {
      const { sourceWidth, sourceHeight, ...image } = measurement;
      classified.push({ ...image, reason: image.reason ?? 'Image is vector or its raster format is unknown.' });
    }
  }
  return classified;
}
