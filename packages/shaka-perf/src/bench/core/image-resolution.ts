/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export interface ImageResolutionConfig {
  minRatio: number;
  maxRatio: number;
}

export interface ImageResolutionMeasurement {
  src: string;
  label: string;
  fit: string;
  boxWidth: number;
  boxHeight: number;
  /** On-screen scale on each axis, applied after object-fit. Defaults to 1. */
  scaleX?: number;
  scaleY?: number;
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
}

/** Whole-check outcomes are distinct from individual images with unknown dimensions. */
export type ImageResolutionCheck = ImageResolutionResult | {
  status: 'unavailable';
  reason: string;
};

interface ViewportImage {
  image: HTMLImageElement;
  measurement: ImageResolutionMeasurement;
}

function renderedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function hasUnsupportedImageTransform(style: CSSStyleDeclaration): boolean {
  if (style.rotate !== 'none' || style.perspective !== 'none' || style.offsetPath !== 'none') return true;
  if (style.transform === 'none') return false;
  const matrix = new DOMMatrixReadOnly(style.transform);
  // The bounding rectangle gives the scaled width and height only while the axes stay aligned.
  return !matrix.isIdentity && (!matrix.is2D || matrix.b !== 0 || matrix.c !== 0);
}

function readImageLayout(image: HTMLImageElement, rect: DOMRect): ImageResolutionMeasurement | undefined {
  const style = getComputedStyle(image);
  if (style.visibility !== 'visible') return;

  let reason: string | undefined;
  let hasTransform = false;
  for (let element: Element | null = image; element; element = renderedParent(element)) {
    const ancestorStyle = element === image ? style : getComputedStyle(element);
    if (Number(ancestorStyle.opacity) === 0 || ancestorStyle.display === 'none' ||
        ancestorStyle.contentVisibility === 'hidden') return;
    if (ancestorStyle.transform !== 'none' || ancestorStyle.scale !== 'none') hasTransform = true;
    if (hasUnsupportedImageTransform(ancestorStyle) ||
        (ancestorStyle.zoom !== 'normal' && Number(ancestorStyle.zoom) !== 1)) {
      reason = 'This CSS transform or zoom is unsupported.';
    }
  }

  // object-fit uses the content box, which excludes padding and borders.
  const horizontalInsets = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
    parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const verticalInsets = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const isBorderBox = style.boxSizing === 'border-box';
  const boxWidth = parseFloat(style.width) - (isBorderBox ? horizontalInsets : 0);
  const boxHeight = parseFloat(style.height) - (isBorderBox ? verticalInsets : 0);
  if (!(boxWidth > 0 && boxHeight > 0)) return;
  if (!image.complete || !image.currentSrc || !image.naturalWidth || !image.naturalHeight) {
    reason ??= 'Image is not loaded.';
  }

  let label = 'img';
  if (image.id) label = `img#${image.id}`;
  else if (image.alt) label = `img (${image.alt})`;
  else if (!image.currentSrc && image.getAttribute('src')) label = `img (${image.getAttribute('src')})`;

  return {
    src: image.currentSrc, label, fit: style.objectFit, boxWidth, boxHeight,
    ...(hasTransform && !reason ? {
      scaleX: rect.width / (boxWidth + horizontalInsets),
      scaleY: rect.height / (boxHeight + verticalInsets),
    } : {}),
    naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
    devicePixelRatio: window.devicePixelRatio, ...(reason ? { reason } : {}),
  };
}

function collectImagesInViewport(root: Document | ShadowRoot): ViewportImage[] {
  const images: ViewportImage[] = [];
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const rect = image.getBoundingClientRect();
    const overlapsViewport = rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    if (!overlapsViewport) continue;

    const measurement = readImageLayout(image, rect);
    if (measurement) images.push({ image, measurement });
  }
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (!element.shadowRoot) continue;
    for (const image of collectImagesInViewport(element.shadowRoot)) images.push(image);
  }
  return images;
}

async function readBitmapDimensions(image: HTMLImageElement, measurement: ImageResolutionMeasurement): Promise<void> {
  if (image.currentSrc !== measurement.src) {
    measurement.reason = 'Image source changed before the bitmap was read.';
    return;
  }
  const maxBitmapPixels = 40_000_000;
  if (measurement.naturalWidth * measurement.naturalHeight > maxBitmapPixels) {
    measurement.reason = 'Image exceeds the bitmap measurement size limit.';
    return;
  }
  try {
    const bitmap = await createImageBitmap(image);
    measurement.sourceWidth = bitmap.width;
    measurement.sourceHeight = bitmap.height;
    bitmap.close();
  } catch {
    measurement.reason = 'Selected image bitmap could not be read.';
  }
}

export async function collectImageResolutionMeasurements(): Promise<ImageResolutionMeasurement[]> {
  const images = collectImagesInViewport(document);
  const measurements: ImageResolutionMeasurement[] = [];
  for (const { image, measurement } of images) {
    if (!measurement.reason) await readBitmapDimensions(image, measurement);
    measurements.push(measurement);
  }
  return measurements;
}

// Lighthouse evaluates the collector in Chrome. These functions go with it.
export const imageMeasurementPageHelpers = [
  renderedParent, hasUnsupportedImageTransform, readImageLayout, collectImagesInViewport, readBitmapDimensions,
];

function evaluateSingleImage(
  measurement: ImageResolutionMeasurement, config: ImageResolutionConfig,
): ImageResolutionImage {
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
  paintedWidth *= measurement.scaleX ?? 1;
  paintedHeight *= measurement.scaleY ?? 1;
  const requiredWidth = paintedWidth * devicePixelRatio;
  const requiredHeight = paintedHeight * devicePixelRatio;
  const ratio = Math.min(sourceWidth! / requiredWidth, sourceHeight! / requiredHeight);
  // Only absorb floating-point roundoff. User thresholds control intentional tolerance.
  const status = ratio + 1e-6 < config.minRatio ? 'undersized' : ratio - 1e-6 > config.maxRatio ? 'oversized' : 'sufficient';
  return { ...measurement, paintedWidth, paintedHeight, requiredWidth, requiredHeight, ratio, status };
}

export function evaluateImageResolution(
  measurements: ImageResolutionMeasurement[], config: ImageResolutionConfig,
): ImageResolutionResult {
  const result: ImageResolutionResult = { images: [], undersized: 0, oversized: 0, unknown: 0 };
  for (const measurement of measurements) {
    const image = evaluateSingleImage(measurement, config);
    result.images.push(image);
    if (image.status !== 'sufficient') result[image.status]++;
  }
  return result;
}
