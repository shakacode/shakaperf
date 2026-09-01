/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  buildProfileTimelineHtml,
  type ProfileData,
} from '../performance-profile-timeline';

/** A real (tiny, solid-grey) JPEG, so the frame-width decode has something to read. */
function jpeg(width: number, height: number): Buffer {
  const { encode } = require('jpeg-js') as {
    encode(img: { data: Buffer; width: number; height: number }, quality?: number): { data: Buffer };
  };
  const data = Buffer.alloc(width * height * 4, 0x80);
  return encode({ data, width, height }, 50).data;
}

// No screenshots keeps the frame width off the JPEG decoder; the columns,
// headers and grid — what halving the comparison view changed — still render.
function profile(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    screenshots: [],
    events: [
      { timeMs: 10, label: '/app.js', category: 'network-start' },
      { timeMs: 40, label: '/app.js', category: 'network-end' },
      { timeMs: 50, label: 'firstContentfulPaint', category: 'paint' },
    ],
    maxTimeMs: 100,
    baseOrigin: 'http://localhost',
    ...overrides,
  };
}

describe('audit performance profile timeline', () => {
  it('renders the comparison layout with only the measured side', () => {
    const html = buildProfileTimelineHtml(profile(), 'Homepage · desktop');

    expect(html).toContain('>Frames<');
    expect(html).toContain('>Network<');
    expect(html).toContain('>Main thread<');
    expect(html).toContain('>Events<');
    // Four grid tracks: frames | network | main thread | events.
    expect(html).toMatch(/grid-template-columns: \d+px \d+px \d+px \d+px;/);
  });

  it('carries nothing from the control half', () => {
    const html = buildProfileTimelineHtml(profile(), 'Homepage · desktop');

    expect(html).not.toContain('col-header control');
    expect(html).not.toContain('col-header diff');
    expect(html).not.toContain('screenshot-col diff');
    expect(html).not.toContain('data-side=');
    // The cross-side jump and its toast have no other side to reach.
    expect(html).not.toContain('toast');
  });

  it('makes the frames column exactly one frame wide', () => {
    // A 250x156 trace thumbnail must not be stretched to a target height;
    // the column is the JPEG's own pixel width.
    const html = buildProfileTimelineHtml(profile({
      screenshots: [{ timeMs: 0, dataUri: 'data:image/jpeg;base64,', snapshot: jpeg(250, 156) }],
    }), 'Homepage · desktop');

    expect(html).toMatch(/grid-template-columns: 250px /);
  });

  it('titles the page with the audited test and viewport', () => {
    const html = buildProfileTimelineHtml(profile(), 'Cart · phone');

    expect(html).toContain('<title>Cart · phone</title>');
    expect(html).toContain('<h1>Cart · phone</h1>');
  });

  it('escapes a title that contains markup', () => {
    const html = buildProfileTimelineHtml(profile(), '<script>x</script>');

    expect(html).toContain('<title>&lt;script&gt;x&lt;/script&gt;</title>');
  });
});
