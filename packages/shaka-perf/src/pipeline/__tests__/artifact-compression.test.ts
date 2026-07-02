/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import sharp from 'sharp';
import { bufferToAvifDataUri } from '../artifact-compression';

const HEIF_MAX_DIMENSION = 16384;

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 180, b: 180 } },
  })
    .png()
    .toBuffer();
}

async function decode(dataUri: string): Promise<{ width: number; height: number }> {
  const m = /^data:image\/avif;base64,(.+)$/.exec(dataUri);
  if (!m) throw new Error('not an avif data uri');
  const meta = await sharp(Buffer.from(m[1], 'base64')).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

describe('bufferToAvifDataUri', () => {
  // libheif rejects any side over 16384 ("too large for the HEIF format").
  // Before the clamp, a full-page screenshot of a tall page threw here and
  // sank the whole accessibility stage for that page.
  it('encodes an over-tall image by clamping the long side into the HEIF box', async () => {
    const png = await solidPng(100, HEIF_MAX_DIMENSION + 1);
    const uri = await bufferToAvifDataUri(png, 45);
    const { width, height } = await decode(uri);
    expect(height).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
    expect(width).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
    // Aspect ratio preserved (tall image stays tall).
    expect(height).toBeGreaterThan(width);
  }, 30000);

  it('encodes an over-wide image by clamping the long side into the HEIF box', async () => {
    const png = await solidPng(HEIF_MAX_DIMENSION + 1, 100);
    const uri = await bufferToAvifDataUri(png, 45);
    const { width, height } = await decode(uri);
    expect(width).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
    expect(height).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
  }, 30000);

  it('honors a requested downscale on an oversized image', async () => {
    // 20000 wide at scale 0.5 -> target 10000 wide, still under the cap.
    const png = await solidPng(20000, 200);
    const uri = await bufferToAvifDataUri(png, 45, 0.5);
    const { width, height } = await decode(uri);
    expect(width).toBeLessThanOrEqual(10000);
    expect(width).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
    expect(height).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
  }, 30000);

  it('clamps an over-wide image when the requested downscale is still over the cap', async () => {
    // 40000 wide at scale 0.9 -> requested 36000, still > 16384; the
    // Math.min(requestedWidth, HEIF_MAX_DIMENSION) guard must box it back under
    // the cap, otherwise fit:'inside' would emit a > 16384 width and AVIF throws.
    const png = await solidPng(40000, 200);
    const uri = await bufferToAvifDataUri(png, 45, 0.9);
    const { width, height } = await decode(uri);
    expect(width).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
    expect(height).toBeLessThanOrEqual(HEIF_MAX_DIMENSION);
  }, 30000);

  it('leaves a normal image at full size when no downscale is requested', async () => {
    const png = await solidPng(200, 300);
    const uri = await bufferToAvifDataUri(png, 45);
    expect(await decode(uri)).toEqual({ width: 200, height: 300 });
  });

  it('downscales a normal image by width when scale < 1', async () => {
    const png = await solidPng(800, 600);
    const uri = await bufferToAvifDataUri(png, 45, 0.5);
    const { width, height } = await decode(uri);
    expect(width).toBe(400);
    expect(height).toBe(300);
  });
});
