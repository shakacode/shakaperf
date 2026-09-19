/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jpeg = require('jpeg-js') as {
  decode(buf: Buffer, opts?: { useTArray: boolean }): { width: number; height: number; data: Uint8Array };
};

/** Decode a JPEG to RGBA. Its own module so the frame matcher and the timeline
 *  can both use it without importing each other. */
export function decodeJpeg(buf: Buffer): { width: number; height: number; data: Uint8Array } {
  const raw = jpeg.decode(buf, { useTArray: true });
  return { width: raw.width, height: raw.height, data: raw.data };
}
