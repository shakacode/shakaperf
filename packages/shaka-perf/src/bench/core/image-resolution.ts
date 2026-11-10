/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface ImageResolutionConfig {
  minRatio: number;
  maxRatio: number;
  failOnUndersized: boolean;
}

export interface ImageResolutionMeasurement {
  src: string;
  label: string;
  fit: string;
  boxWidth: number;
  boxHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  devicePixelRatio: number;
  sourceWidth?: number;
  sourceHeight?: number;
  reason?: string;
}

export interface ImageResolutionImage extends ImageResolutionMeasurement {
  paintedWidth?: number;
  paintedHeight?: number;
  requiredWidth?: number;
  requiredHeight?: number;
  /** Smallest source-pixel / required-pixel ratio across the two axes. */
  ratio?: number;
  status: 'sufficient' | 'undersized' | 'oversized' | 'unknown';
}

export interface ImageResolutionResult {
  images: ImageResolutionImage[];
  undersized: number;
  oversized: number;
  unknown: number;
  failOnUndersized: boolean;
}

/** Runs in the page: keep all runtime dependencies inside this function. */
export async function collectImageResolutionMeasurements(rasterUrls: string[]): Promise<ImageResolutionMeasurement[]> {
  const deadline = performance.now() + 5000;
  const rasterSources = new Set(rasterUrls);
  const elements: HTMLImageElement[] = [];
  const visit = (root: Document | ShadowRoot) => {
    elements.push(...Array.from(root.querySelectorAll('img')));
    for (const element of Array.from(root.querySelectorAll('*'))) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);

  const snapshot = (element: HTMLImageElement): ImageResolutionMeasurement | undefined => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!element.isConnected || rect.width <= 0 || rect.height <= 0 ||
        rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth ||
        style.visibility !== 'visible') return undefined;
    let reason: string | undefined;
    for (let ancestor: Element | null = element; ancestor;) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (Number(ancestorStyle.opacity) === 0 || ancestorStyle.display === 'none' ||
          ancestorStyle.contentVisibility === 'hidden') return undefined;
      if (ancestorStyle.transform !== 'none' || ancestorStyle.scale !== 'none' ||
          ancestorStyle.rotate !== 'none' || ancestorStyle.perspective !== 'none' ||
          (ancestorStyle.zoom !== 'normal' && Number(ancestorStyle.zoom) !== 1)) reason = 'CSS transforms or zoom are unsupported.';
      const root = ancestor.getRootNode();
      ancestor = ancestor.assignedSlot ?? ancestor.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    }
    // Computed width/height preserve fractional layout pixels; rect includes borders and transforms.
    let boxWidth = parseFloat(style.width);
    let boxHeight = parseFloat(style.height);
    if (style.boxSizing === 'border-box') {
      boxWidth -= parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      boxHeight -= parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    }
    if (!(boxWidth > 0 && boxHeight > 0)) return undefined;
    const src = element.currentSrc;
    if (!element.complete || !src || !element.naturalWidth || !element.naturalHeight) {
      reason = 'Image is not loaded.';
    } else if (!rasterSources.has(src) && !/^data:image\/(?:png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon)(?:;|,)/i.test(src)) {
      reason = 'Image is vector or its raster format is unknown.';
    }
    return {
      src, label: element.id ? `img#${element.id}` : element.alt ? `img (${element.alt})` : 'img',
      fit: style.objectFit, boxWidth, boxHeight,
      naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
      devicePixelRatio: window.devicePixelRatio, ...(reason ? { reason } : {}),
    };
  };

  // Freeze the page's current selection and layout before any asynchronous bitmap reads.
  const snapshots = elements.map(element => ({ element, measurement: snapshot(element) }));
  const results: ImageResolutionMeasurement[] = [];
  for (const { element, measurement } of snapshots) {
    if (!measurement) continue;
    results.push(measurement);
    if (measurement.reason) continue;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      measurement.reason = 'Image measurement time limit reached.';
      continue;
    }
    if (measurement.naturalWidth * measurement.naturalHeight > 40_000_000) {
      measurement.reason = 'Image exceeds the bitmap measurement size limit.';
      continue;
    }
    if (JSON.stringify(snapshot(element)) !== JSON.stringify(measurement)) {
      measurement.reason = 'Image selection or layout changed during measurement.';
      continue;
    }
    try {
      // Uses the already-selected resource, including srcset density correction. No fetch or resize.
      // A timeout cannot interrupt synchronous decoding; the size guard limits ordinary large inputs.
      const bitmap = await new Promise<ImageBitmap | null>((resolve, reject) => {
        let expired = false;
        const timer = setTimeout(() => { expired = true; resolve(null); }, remaining);
        createImageBitmap(element).then(value => {
          clearTimeout(timer);
          if (expired) value.close();
          else resolve(value);
        }, error => { clearTimeout(timer); reject(error); });
      });
      if (!bitmap) {
        measurement.reason = 'Image measurement time limit reached.';
        continue;
      }
      try {
        if (performance.now() > deadline) {
          measurement.reason = 'Image measurement time limit reached.';
        } else if (JSON.stringify(snapshot(element)) !== JSON.stringify(measurement)) {
          measurement.reason = 'Image selection or layout changed during measurement.';
        } else if (bitmap.width * bitmap.height > 40_000_000) {
          measurement.reason = 'Image exceeds the bitmap measurement size limit.';
        } else {
          measurement.sourceWidth = bitmap.width;
          measurement.sourceHeight = bitmap.height;
        }
      } finally { bitmap.close(); }
    } catch {
      measurement.reason = 'Selected image bitmap could not be read.';
    }
  }
  return results;
}

export function evaluateImageResolution(
  measurements: ImageResolutionMeasurement[], config: ImageResolutionConfig,
): ImageResolutionResult {
  const images = measurements.map((measurement): ImageResolutionImage => {
    const { boxWidth, boxHeight, naturalWidth, naturalHeight, sourceWidth, sourceHeight, devicePixelRatio } = measurement;
    if (measurement.reason || ![boxWidth, boxHeight, naturalWidth, naturalHeight, sourceWidth, sourceHeight, devicePixelRatio]
      .every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      return { ...measurement, status: 'unknown', reason: measurement.reason ?? 'Image dimensions are unavailable.' };
    }
    let paintedWidth = boxWidth;
    let paintedHeight = boxHeight;
    if (measurement.fit !== 'fill') {
      const containScale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
      let scale: number;
      switch (measurement.fit) {
        case 'cover': scale = Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight); break;
        case 'contain': scale = containScale; break;
        case 'none': scale = 1; break;
        case 'scale-down': scale = Math.min(1, containScale); break;
        default: return { ...measurement, status: 'unknown', reason: 'Unsupported object-fit value.' };
      }
      paintedWidth = naturalWidth * scale;
      paintedHeight = naturalHeight * scale;
    }
    const requiredWidth = paintedWidth * devicePixelRatio;
    const requiredHeight = paintedHeight * devicePixelRatio;
    const ratio = Math.min(sourceWidth! / requiredWidth, sourceHeight! / requiredHeight);
    // Only absorb floating-point roundoff. User thresholds control intentional tolerance.
    const status = ratio + 1e-6 < config.minRatio ? 'undersized' : ratio - 1e-6 > config.maxRatio ? 'oversized' : 'sufficient';
    return { ...measurement, paintedWidth, paintedHeight, requiredWidth, requiredHeight, ratio, status };
  });
  return {
    images,
    undersized: images.filter(image => image.status === 'undersized').length,
    oversized: images.filter(image => image.status === 'oversized').length,
    unknown: images.filter(image => image.status === 'unknown').length,
    failOnUndersized: config.failOnUndersized,
  };
}
