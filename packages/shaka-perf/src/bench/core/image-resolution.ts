/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { RunnerResult } from 'lighthouse';
import type { Page } from 'playwright-core';
import { escapeHtml } from 'shaka-shared';

import type { PhaseSample } from './lighthouse-config';

/** One visible `<img>` as the page reports it. */
export interface ImageSize {
  url: string;
  /** Pixels of the image file. */
  sourceWidth: number;
  sourceHeight: number;
  /** CSS pixels the image covers on screen, after object-fit. */
  paintedWidth: number;
  paintedHeight: number;
  /** Device pixels per CSS pixel, with the page zoom. */
  devicePixelRatio: number;
  /** Left, top, width and height of the element on screen, as fractions of the window. */
  box: number[];
}

export interface ImageResolutionLimits {
  minRatio: number;
  maxRatio: number;
}

/** An image painted within this many CSS pixels on both sides is small. */
const SMALL_IMAGE_SIZE = 64;

/**
 * Reads the size of every `<img>` in the viewport. It runs inside the
 * Lighthouse trace, so it only reads the DOM, and it marks its own start and
 * end so its cost shows in the performance profile.
 */
export async function collectImageSizes(page: Page): Promise<ImageSize[]> {
  try {
    return await page.evaluate(() => {
      performance.mark('shaka-perf-image-sizes-start');
      const sizes: ImageSize[] = [];
      for (const img of Array.from(document.querySelectorAll('img'))) {
        const rect = img.getBoundingClientRect();
        if (!img.naturalWidth || !img.naturalHeight || rect.width <= 0 || rect.height <= 0
          || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth
          || !img.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;

        // object-fit works inside the content box, which excludes padding and borders.
        const style = getComputedStyle(img);
        const insetX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
          + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        const insetY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
          + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        const isBorderBox = style.boxSizing === 'border-box';
        const boxWidth = parseFloat(style.width) - (isBorderBox ? insetX : 0);
        const boxHeight = parseFloat(style.height) - (isBorderBox ? insetY : 0);
        if (!(boxWidth > 0 && boxHeight > 0)) continue;

        let paintedWidth = boxWidth;
        let paintedHeight = boxHeight;
        if (style.objectFit !== 'fill') {
          const contain = Math.min(boxWidth / img.naturalWidth, boxHeight / img.naturalHeight);
          const scale = style.objectFit === 'cover' ? Math.max(boxWidth / img.naturalWidth, boxHeight / img.naturalHeight)
            : style.objectFit === 'none' ? 1
            : style.objectFit === 'scale-down' ? Math.min(1, contain)
            : contain;
          paintedWidth = img.naturalWidth * scale;
          paintedHeight = img.naturalHeight * scale;
        }
        // The rectangle includes CSS transforms, the computed size does not.
        paintedWidth *= rect.width / (boxWidth + insetX);
        paintedHeight *= rect.height / (boxHeight + insetY);

        // naturalWidth is already divided by the density of the chosen srcset candidate.
        let density = 1;
        const sources = img.parentElement instanceof HTMLPictureElement
          ? [...Array.from(img.parentElement.querySelectorAll('source')), img]
          : [img];
        for (const source of sources) {
          for (const [, url, value, unit] of source.srcset.matchAll(/(\S+)\s+([\d.]+)([wx])\s*(?:,|$)/g)) {
            if (new URL(url, document.baseURI).href !== img.currentSrc) continue;
            density = unit === 'x' ? Number(value) : Number(value) / img.naturalWidth;
          }
        }

        sizes.push({
          // An embedded image is reported by its type alone.
          url: img.currentSrc.replace(/^(data:[^;,]*).*/s, '$1'),
          sourceWidth: img.naturalWidth * density,
          sourceHeight: img.naturalHeight * density,
          paintedWidth,
          paintedHeight,
          // A phone page without a viewport meta tag is zoomed out to fit the screen.
          devicePixelRatio: devicePixelRatio * (visualViewport?.scale ?? 1),
          box: [rect.left / innerWidth, rect.top / innerHeight, rect.width / innerWidth, rect.height / innerHeight],
        });
      }
      performance.mark('shaka-perf-image-sizes-end');
      return sizes;
    });
  } catch (err) {
    // The page can be gone already when the test body failed.
    console.warn(`image sizes were not collected: ${(err as Error).message}`);
    return [];
  }
}

/** URLs answered with an SVG: a vector image has no pixel size to check. */
function svgUrls(lighthouseResult: RunnerResult): Set<string> {
  const urls = new Set<string>();
  // A redirect keeps the request id, and `<img>` keeps the URL it asked for.
  const requested = new Map<string, string[]>();
  for (const entry of lighthouseResult.artifacts.DevtoolsLog) {
    if (entry.method === 'Network.requestWillBeSent') {
      requested.set(entry.params.requestId, [...(requested.get(entry.params.requestId) ?? []), entry.params.request.url]);
    } else if (entry.method === 'Network.responseReceived' && entry.params.response.mimeType === 'image/svg+xml') {
      for (const url of requested.get(entry.params.requestId) ?? []) urls.add(url);
    }
  }
  return urls;
}

// A small image is only sharp when the file is a whole multiple of its
// on-screen pixels: 32px drawn into 31px blurs far more than 320px into 310px.
function isWholeMultiple(source: number, required: number): boolean {
  return Math.abs(source - Math.round(source / required) * required) <= 0.5;
}

/** The list as a page, under the screen with a numbered box on each image that is not ok. */
function imagesHtml(lighthouseResult: RunnerResult, lines: string[], boxes: string[]): string {
  // The last frame of the trace: the screen as the page script saw it.
  const frame = lighthouseResult.lhr.audits['final-screenshot']?.details;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>image resolution</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; display: flex; flex-wrap: wrap; gap: 20px; }
    .screen { position: relative; flex: none; align-self: flex-start; overflow: hidden; border: 1px solid #ddd; }
    .screen img { display: block; height: 60vh; }
    .screen div { position: absolute; box-sizing: border-box; border: 2px solid var(--status); }
    .screen b { position: absolute; padding: 0 4px; background: var(--status); color: #fff; font-size: 12px; }
    ol { margin: 0; font-family: monospace; white-space: pre; }
    li { color: var(--status); }
    .undersized { --status: #d32f2f; }
    .oversized { --status: #e65100; }
    .scaled-small { --status: #7b1fa2; }
  </style>
</head>
<body>
  ${frame?.type === 'screenshot' ? `<div class="screen"><img src="${frame.data}" alt="">${boxes.join('')}</div>` : ''}
  <ol>${lines.map((line) => `<li class="${line.split(' ', 1)[0]}">${escapeHtml(line)}</li>`).join('')}</ol>
</body>
</html>`;
}

/**
 * Compares each image's file pixels with the pixels the screen needs for it.
 * Returns one count per finding as metrics, and one line per image for the
 * `image_resolution.txt` artifact. The `.html` artifact also shows where each
 * finding is on screen.
 */
export function checkImageResolution(
  sizes: ImageSize[],
  lighthouseResult: RunnerResult,
  url: string,
  limits: ImageResolutionLimits,
): { phases: PhaseSample[]; report: string; html: string } {
  const svg = svgUrls(lighthouseResult);
  // Origin-relative, so the control/experiment diff only shows images that changed.
  const pageOrigin = new URL(url).origin;
  const counts = { undersized: 0, oversized: 0, 'scaled-small': 0, ok: 0 };
  const lines: string[] = [];
  const boxes: string[] = [];
  for (const image of sizes) {
    if (image.url.startsWith('data:image/svg') || svg.has(image.url.split('#', 1)[0])) continue;
    const requiredWidth = image.paintedWidth * image.devicePixelRatio;
    const requiredHeight = image.paintedHeight * image.devicePixelRatio;
    const ratio = Math.min(image.sourceWidth / requiredWidth, image.sourceHeight / requiredHeight);
    const isSmall = image.paintedWidth <= SMALL_IMAGE_SIZE && image.paintedHeight <= SMALL_IMAGE_SIZE;
    const status = ratio < limits.minRatio ? 'undersized'
      : isSmall && !(isWholeMultiple(image.sourceWidth, requiredWidth) && isWholeMultiple(image.sourceHeight, requiredHeight)) ? 'scaled-small'
      : ratio > limits.maxRatio ? 'oversized'
      : 'ok';
    counts[status]++;
    lines.push(
      `${status.padEnd(12)} ${Math.round(image.sourceWidth)}x${Math.round(image.sourceHeight)} file, ` +
      `${Math.round(requiredWidth)}x${Math.round(requiredHeight)} needed  ${image.url.replace(pageOrigin, '')}`,
    );
    if (status === 'ok') continue;
    // The number on a box is the line number of its image.
    const [left, top, width, height] = image.box.map((part) => `${(part * 100).toFixed(2)}%`);
    boxes.push(`<div class="${status}" style="left:${left};top:${top};width:${width};height:${height}"><b>${lines.length}</b></div>`);
  }
  return {
    phases: (['undersized', 'oversized', 'scaled-small'] as const).map((status) => ({
      phase: `${status}-images`,
      duration: counts[status],
      start: 0,
      sign: 1,
      unit: '',
    })),
    report: lines.join('\n') + '\n',
    html: imagesHtml(lighthouseResult, lines, boxes),
  };
}
