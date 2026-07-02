/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  buildCaptionCues,
  buildStartHere,
  dashSafe,
  detectProblems,
  faviconDataUri,
  faviconLinkTag,
  framesToBoxes,
  isDuplicateStory,
  isPublicHost,
  parseIconHref,
  pickFrames,
  videoCaption,
  windowEndMs,
  type Frame,
} from '../client-report';
import { selectViewportRows } from '../synthesis';
import type { MachineReportTest, PagePerf } from '../synthesis';

function frame(timeMs: number, overrides: Partial<Frame> = {}): Frame {
  return {
    timeMs,
    imageFilename: `timeline_frame_${timeMs.toFixed(2)}ms.webp`,
    imgW: 500,
    imgH: 998,
    shifts: [],
    isLcp: false,
    ...overrides,
  };
}

function page(metrics: Record<string, number>): PagePerf {
  return {
    id: 'p',
    name: 'Page',
    startingPath: '/',
    chips: [],
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([label, value]) => [label, { value, display: String(value) }]),
    ),
  };
}

// Shaped like thinkd2's homepage: blank start, first content at ~1.5s, slow
// progressive load to a 13.9s LCP, then a background animation emitting frames
// long after the page is visually done.
const HOMEPAGE_LIKE: Frame[] = [
  frame(0),
  frame(1517), // first content (FCP 1531)
  frame(3196),
  frame(3645),
  frame(4075),
  frame(6343),
  frame(6519, { shifts: [{ value: 0.046, rects: [[0, 100, 500, 200]] }] }),
  frame(8207),
  frame(9207),
  frame(10206),
  frame(11209),
  frame(12209),
  frame(13923, { isLcp: true }),
  frame(15044),
  frame(20000), // animation tail starts here
  frame(30000),
  frame(68019),
];

describe('buildStartHere', () => {
  const fine = (n: number) => `${n} ${n === 1 ? 'page loads' : 'pages load'} fine`;

  it('dedups same-key pages into the "same" rollup (one item, not two)', () => {
    const sh = buildStartHere(
      [
        { page: 'Home', issue: 'slow', key: 'slow-lcp' },
        { page: 'Pricing', issue: 'slow', key: 'slow-lcp' },
      ],
      0, 'a similar slowdown', 'a different problem', fine,
    );
    expect(sh?.items.map((i) => i.page)).toEqual(['Home']);
    expect(sh?.rest).toBe('1 more page has a similar slowdown.');
  });

  it('calls a DISTINCT over-cap issue "different", never "similar"', () => {
    const sh = buildStartHere(
      [
        { page: 'A', issue: 'slow', key: 'slow-lcp' },
        { page: 'B', issue: 'jumpy', key: 'layout-shift' },
        { page: 'C', issue: 'blank', key: 'blank' },
      ],
      0, 'a similar slowdown', 'a different problem', fine,
    );
    expect(sh?.items.map((i) => i.page)).toEqual(['A', 'B']); // capped at a pair
    expect(sh?.rest).toBe('1 more page has a different problem.'); // C is distinct, not "similar"
  });

  it('appends the fine clause and returns undefined for no entries', () => {
    expect(buildStartHere([{ page: 'A', issue: 'slow', key: 'slow-lcp' }], 2, 's', 'o', fine)?.rest).toBe('2 pages load fine.');
    expect(buildStartHere([], 3, 's', 'o', fine)).toBeUndefined();
  });
});

describe('windowEndMs', () => {
  it('caps the window just past LCP, excluding the animation tail', () => {
    const end = windowEndMs(HOMEPAGE_LIKE, 13923, 1531);
    expect(end).toBe(13923 + 1200);
  });

  it('extends past LCP to the last real layout shift', () => {
    const frames = [frame(0), frame(1000, { isLcp: true }), frame(5000, { shifts: [{ value: 0.4, rects: [[0, 0, 10, 10]] }] }), frame(30000)];
    expect(windowEndMs(frames, 1000, 800)).toBe(5000 + 1200);
  });

  it('falls back to the first ~12s when there is no signal at all', () => {
    const frames = [frame(0), frame(5000), frame(40000)];
    expect(windowEndMs(frames, undefined, undefined)).toBe(12000);
  });

  it('carries the window from metrics when the audit is frameless', () => {
    // Regression: a frameless page with a screencast got a 2-second video
    // captioned with the full LCP wait, because the empty frame list returned 0.
    expect(windowEndMs([], 13900, 1500)).toBe(13900);
    expect(windowEndMs([], undefined, 1500)).toBe(1500);
  });

  it('returns 0 (no video) when frameless AND metricless', () => {
    expect(windowEndMs([], undefined, undefined)).toBe(0);
  });
});

describe('buildCaptionCues', () => {
  it('lays the story beats out in order with navigation-relative times', () => {
    // HOMEPAGE_LIKE: blank@0, first content ~1.5s, a visible shift @6519,
    // LCP@13923, window ends at LCP+1200.
    const cues = buildCaptionCues(HOMEPAGE_LIKE, 13923, 1531, 13923 + 1200);
    expect(cues.map((c) => c.kind)).toEqual(['blank', 'first-content', 'jump', 'main', 'loaded']);
    expect(cues.map((c) => c.atMs)).toEqual([0, 1517, 6519, 13923, 15123]);
    // The cue time is the video clock: it must equal the underlying frame time.
    expect(cues.find((c) => c.kind === 'main')!.atMs).toBe(13923);
  });

  it('captions the slow main-content beat with "finally" and its seconds', () => {
    const main = buildCaptionCues(HOMEPAGE_LIKE, 13923, 1531, 15123).find((c) => c.kind === 'main')!;
    expect(main.text).toContain('13.9s in');
    expect(main.text).toContain('finally');
  });

  it('merges first content into the main beat on a fast page (FCP ~= LCP)', () => {
    // First paint and the biggest piece land together (~1.8s): one beat, not two
    // captions on the same instant. The neutral phrasing drops "finally".
    const fast: Frame[] = [frame(0), frame(1800, { isLcp: true })];
    const cues = buildCaptionCues(fast, 1800, 1800, 1800 + 1200);
    expect(cues.map((c) => c.kind)).toEqual(['blank', 'main', 'loaded']);
    const main = cues.find((c) => c.kind === 'main')!;
    expect(main.atMs).toBe(1800);
    expect(main.text).not.toContain('finally');
  });

  it('adds a layout-jump beat for a visible shift and ignores sub-visible ripples', () => {
    const withShift: Frame[] = [
      frame(0),
      frame(2000, { isLcp: true }),
      frame(3000, { shifts: [{ value: 0.005, rects: [[0, 0, 10, 10]] }] }), // sub-visible: not a beat
      frame(4000, { shifts: [{ value: 0.3, rects: [[0, 0, 500, 200]] }] }), // visible: a beat
    ];
    const kinds = buildCaptionCues(withShift, 2000, 1800, 5200).map((c) => c.kind);
    expect(kinds).toContain('jump');
    expect(kinds.filter((k) => k === 'jump')).toHaveLength(1);
  });

  it('never emits a cue past the trimmed window (a late shift is dropped)', () => {
    const lateShift: Frame[] = [
      frame(0),
      frame(2000, { isLcp: true }),
      frame(30000, { shifts: [{ value: 0.5, rects: [[0, 0, 500, 200]] }] }), // animation-tail shift
    ];
    const cap = 2000 + 1200;
    const cues = buildCaptionCues(lateShift, 2000, 1800, cap);
    expect(Math.max(...cues.map((c) => c.atMs))).toBeLessThanOrEqual(cap + 1);
    expect(cues.some((c) => c.kind === 'jump')).toBe(false);
  });

  it('keeps the start captioned "blank" when first paint is very fast (drops first content)', () => {
    // FCP ~300ms: the screen is blank for only a blink, so the first beat must
    // still read "blank" (t=0 IS blank) - first content must not overtake it.
    const fastPaint: Frame[] = [frame(0), frame(300), frame(2200, { isLcp: true })];
    const cues = buildCaptionCues(fastPaint, 2200, 300, 2200 + 1200);
    expect(cues[0].kind).toBe('blank');
    expect(cues[0].atMs).toBe(0);
    expect(cues.some((c) => c.kind === 'first-content')).toBe(false);
  });

  it('a merged higher-priority beat keeps its OWN time so the caption is not early', () => {
    // A layout jump 400ms before LCP: the two collapse, main wins. main must fire
    // at its own 5.4s (matching the "5.4s in" text), not back at the 5.0s jump -
    // else the caption claims the main content landed while it is still jumping.
    const cluster: Frame[] = [
      frame(0),
      frame(5000, { shifts: [{ value: 0.3, rects: [[0, 0, 500, 200]] }] }),
      frame(5400, { isLcp: true }),
    ];
    const cues = buildCaptionCues(cluster, 5400, 900, 10000);
    const main = cues.find((c) => c.kind === 'main')!;
    expect(main.atMs).toBe(5400);
    expect(main.text).toContain('5.4s');
    expect(cues.some((c) => c.kind === 'jump')).toBe(false); // collapsed into main
  });

  it('drops beats past the real clip length (the video is hard-clamped, e.g. 60s)', () => {
    // A 62s LCP on a clip clamped to 60s: the main/loaded beats sit past the end
    // of the clip the viewer ever sees, so they must not be emitted (they would
    // never fire). The caller passes the clamped clip length as the window.
    const slow: Frame[] = [frame(0), frame(2000), frame(62000, { isLcp: true })];
    const cues = buildCaptionCues(slow, 62000, 1800, 60000);
    expect(Math.max(...cues.map((c) => c.atMs))).toBeLessThanOrEqual(60000);
    expect(cues.some((c) => c.kind === 'main')).toBe(false);
  });

  it('returns no cues for a frameless audit (nothing to sync to)', () => {
    expect(buildCaptionCues([], 13900, 1500, 13900)).toEqual([]);
  });

  it('always opens on the blank beat', () => {
    const cues = buildCaptionCues(HOMEPAGE_LIKE, 13923, 1531, 15123);
    expect(cues[0].kind).toBe('blank');
    expect(cues[0].atMs).toBe(0);
  });
});

describe('pickFrames', () => {
  it('always keeps the first-content frame (nearest to FCP)', () => {
    // Regression: even sampling on a 15s window skipped the 1.5s first paint,
    // so the strip jumped from blank straight to a half-loaded page.
    const picked = pickFrames(HOMEPAGE_LIKE, 13923, 1531, 8);
    expect(picked.map((f) => f.timeMs)).toContain(1517);
  });

  it('keeps the story beats: blank start, LCP, settled end of window', () => {
    const times = pickFrames(HOMEPAGE_LIKE, 13923, 1531, 8).map((f) => f.timeMs);
    expect(times).toContain(0);
    expect(times).toContain(13923);
    expect(times).toContain(15044); // last frame inside the window
  });

  it('never includes animation-tail frames past the window', () => {
    const times = pickFrames(HOMEPAGE_LIKE, 13923, 1531, 8).map((f) => f.timeMs);
    expect(Math.max(...times)).toBeLessThanOrEqual(13923 + 1200);
  });

  it('keeps the biggest layout-shift frames on a dense strip', () => {
    const frames = [
      frame(0),
      frame(1571, { isLcp: true }),
      frame(3529),
      frame(5379),
      frame(6271, { shifts: [{ value: 0.445, rects: [[0, 0, 500, 400]] }] }),
      frame(6406, { shifts: [{ value: 0.398, rects: [[0, 0, 500, 400]] }] }),
      frame(7000),
    ];
    const times = pickFrames(frames, 1571, 1570, 12).map((f) => f.timeMs);
    expect(times).toContain(6271);
    expect(times).toContain(6406);
  });

  it('shows every frame when the deduped window holds fewer than the budget', () => {
    const frames = [frame(0), frame(900), frame(1800, { isLcp: true }), frame(2500)];
    const times = pickFrames(frames, 1800, 900, 8).map((f) => f.timeMs);
    expect(times).toEqual([0, 900, 1800, 2500]);
  });

  it('returns [] for a frameless audit', () => {
    expect(pickFrames([], 1000, 500, 8)).toEqual([]);
  });
});

describe('detectProblems', () => {
  it('leads with an honest slow-lcp on a borderline 3.7s page', () => {
    const { lead } = detectProblems(page({ LCP: 3700, FCP: 1200 }));
    expect(lead.kind).toBe('slow-lcp');
    expect(lead.status).toBe('fair');
  });

  it('ranks a poor layout shift above a mild lcp overshoot', () => {
    const { lead, rest } = detectProblems(page({ LCP: 2600, CLS: 45 }));
    expect(lead.kind).toBe('layout-shift');
    expect(rest.map((p) => p.kind)).toContain('slow-lcp');
  });

  it('marks a fast page clean', () => {
    const { lead, rest } = detectProblems(page({ LCP: 1800, CLS: 2 }));
    expect(lead.kind).toBe('clean');
    expect(lead.status).toBe('good');
    expect(rest).toEqual([]);
  });

  it('flags an effectively blank screen as the worst problem', () => {
    const { lead } = detectProblems(page({ LCP: 9000, FCP: 8800 }));
    expect(lead.kind).toBe('blank');
  });

  it('does not claim an empty screen when the rest of the page paints early', () => {
    // thinkd2 homepage shape: first content at 1.5s, LCP at 13.9s. The frames
    // show a filled page from 1.5s on, so the note must not contradict them.
    const early = detectProblems(page({ LCP: 13900, FCP: 1500 })).lead;
    expect(early.kind).toBe('slow-lcp');
    expect(early.note).toContain('Most of the page paints early');

    const lateEverything = detectProblems(page({ LCP: 9000, FCP: 3400 })).lead;
    expect(lateEverything.kind).toBe('slow-lcp');
    expect(lateEverything.note).toContain('mostly empty screen');
  });

  it('never says "Loads cleanly" about a page with no metrics (failed audit)', () => {
    // Regression: an error-outcome audit.json leaves metrics empty and used to
    // fall through to the clean lead, contradicting the email's broken count.
    const { lead, rest } = detectProblems(page({}));
    expect(lead.kind).toBe('no-data');
    expect(lead.headline).toContain(`couldn't measure`);
    expect(lead.headline).not.toContain('Loads cleanly');
    expect(rest).toEqual([]);
  });

  it('cites the CLS threshold the page actually crossed', () => {
    // 0.10-0.25 band: referencing the 0.25 "poor" line the page is under would
    // be a non sequitur a perf-literate client can call out.
    const mid = detectProblems(page({ LCP: 1800, CLS: 15 })).lead;
    expect(mid.kind).toBe('layout-shift');
    expect(mid.note).toContain('0.10');
    expect(mid.note).not.toContain('0.25');

    const poor = detectProblems(page({ LCP: 1800, CLS: 30 })).lead;
    expect(poor.note).toContain('0.25');
    expect(poor.note).not.toContain('0.10');
    // The bare number must read as Google's layout-shift score, not an ambiguous
    // unit (client feedback: "0.74 what?"). Both bands label it a "score".
    expect(poor.note).toContain('layout-shift scale');
    expect(mid.note).toContain('layout-shift scale');
  });
});

describe('videoCaption', () => {
  it('promises the full wait only when the clip covers it', () => {
    expect(videoCaption('slow-lcp', 13900, 15.1)).toBe('Press play - this is the 13.9s a phone visitor waits, in real time.');
  });

  it('sells only the covered seconds when the screencast is shorter than the wait', () => {
    // Legacy screencasts can stop ~10s into a 40s load; "this is the 40.1s ...
    // in real time" over an 11s clip reads as a broken or dishonest report.
    expect(videoCaption('slow-lcp', 40099, 10.75)).toBe('Press play - the first 11s of the 40.1s a phone visitor waits.');
  });

  it('keeps the full-wait caption when coverage is unknown', () => {
    expect(videoCaption('slow-lcp', 13900, undefined)).toBe('Press play - this is the 13.9s a phone visitor waits, in real time.');
  });

  it('uses the problem-specific caption regardless of coverage', () => {
    expect(videoCaption('layout-shift', 40000, 10)).toBe('Press play and watch the page jump around as it loads.');
  });
});

describe('selectViewportRows', () => {
  const row = (label?: string): MachineReportTest =>
    label === undefined ? { id: 'x', name: 'X' } : { id: `x-${label}`, name: 'X', viewport: { label } };

  it('keeps only phone rows on a dual-viewport audit (the default config)', () => {
    // Regression: desktop rows doubled the page count and were presented to the
    // client as phone measurements.
    const rows = selectViewportRows([row('desktop'), row('phone'), row('desktop'), row('phone')]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.viewport?.label === 'phone')).toBe(true);
  });

  it('passes legacy rows without a viewport field through unchanged', () => {
    const legacy = [row(undefined), row(undefined)];
    expect(selectViewportRows(legacy)).toEqual(legacy);
  });

  it('falls back to all rows when no phone-class viewport exists', () => {
    const desktopOnly = [row('desktop'), row('desktop')];
    expect(selectViewportRows(desktopOnly)).toEqual(desktopOnly);
  });
});

describe('framesToBoxes', () => {
  it('scales shift rects from image pixels to percentages', () => {
    const f = frame(1000, { imgW: 500, imgH: 1000, shifts: [{ value: 0.3, rects: [[50, 100, 250, 500]] }] });
    const { boxes, shiftValue } = framesToBoxes(f);
    expect(shiftValue).toBe(0.3);
    expect(boxes).toEqual([{ left: 10, top: 10, width: 50, height: 50 }]);
  });

  it('drops zero-area rects', () => {
    const f = frame(1000, { shifts: [{ value: 0.3, rects: [[50, 100, 0, 500]] }] });
    expect(framesToBoxes(f).boxes).toEqual([]);
  });
});

describe('dashSafe', () => {
  it('normalizes em and en dashes to plain hyphens', () => {
    expect(dashSafe('fast—but heavy – still slow')).toBe('fast - but heavy - still slow');
  });
});

describe('isDuplicateStory', () => {
  it('treats a scroll variant of the same path with near-identical LCP as a duplicate', () => {
    // thinkd2: Homepage LCP 13.9s vs Scrolling-the-homepage LCP 12.9s, both '/'
    expect(
      isDuplicateStory(
        { startingPath: '/', leadKind: 'slow-lcp', lcpMs: 13923 },
        { startingPath: '/', leadKind: 'slow-lcp', lcpMs: 12884 },
      ),
    ).toBe(true);
  });

  it('keeps both cards when the variant tells a different story', () => {
    // different lead problem
    expect(
      isDuplicateStory(
        { startingPath: '/', leadKind: 'slow-lcp', lcpMs: 13923 },
        { startingPath: '/', leadKind: 'layout-shift', lcpMs: 13000 },
      ),
    ).toBe(false);
    // materially different LCP
    expect(
      isDuplicateStory(
        { startingPath: '/', leadKind: 'slow-lcp', lcpMs: 13923 },
        { startingPath: '/', leadKind: 'slow-lcp', lcpMs: 6000 },
      ),
    ).toBe(false);
    // different page
    expect(
      isDuplicateStory(
        { startingPath: '/', leadKind: 'slow-lcp', lcpMs: 13923 },
        { startingPath: '/work', leadKind: 'slow-lcp', lcpMs: 13900 },
      ),
    ).toBe(false);
  });

  it('never dedupes two metricless flows on the same path', () => {
    // Without an LCP on both sides there is no evidence the stories match;
    // distinct configured flows starting at "/" must keep their own cards.
    expect(
      isDuplicateStory(
        { startingPath: '/', leadKind: 'no-data' },
        { startingPath: '/', leadKind: 'no-data' },
      ),
    ).toBe(false);
    expect(
      isDuplicateStory(
        { startingPath: '/', leadKind: 'slow-lcp', lcpMs: 13923 },
        { startingPath: '/', leadKind: 'slow-lcp' },
      ),
    ).toBe(false);
  });
});

describe('faviconDataUri', () => {
  it('inlines bytes with the response content-type', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(faviconDataUri(bytes, 'image/png')).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  });

  it('strips content-type parameters and lowercases the mime', () => {
    const bytes = new Uint8Array([9]);
    expect(faviconDataUri(bytes, 'image/X-Icon; charset=binary')).toBe(
      `data:image/x-icon;base64,${Buffer.from(bytes).toString('base64')}`,
    );
  });

  it('defaults to image/x-icon when the type is missing or not an image', () => {
    const bytes = new Uint8Array([7, 7]);
    const expected = `data:image/x-icon;base64,${Buffer.from(bytes).toString('base64')}`;
    expect(faviconDataUri(bytes, null)).toBe(expected);
    expect(faviconDataUri(bytes, 'text/html')).toBe(expected);
  });

  it('rejects empty bytes and files too large to inline (cap is inclusive)', () => {
    expect(faviconDataUri(new Uint8Array(0), 'image/x-icon')).toBeNull();
    expect(faviconDataUri(new Uint8Array(512 * 1024 + 1), 'image/x-icon')).toBeNull();
    expect(faviconDataUri(new Uint8Array(512 * 1024), 'image/png')).not.toBeNull();
  });

  it('rejects a content-type that could break out of the href attribute', () => {
    const bytes = new Uint8Array([1]);
    // Attacker-controlled header with a quote + tag: must NOT reach the data URI.
    const hostile = 'image/svg+xml"><script>alert(1)</script>';
    expect(faviconDataUri(bytes, hostile)).toBe(`data:image/x-icon;base64,${Buffer.from(bytes).toString('base64')}`);
    // A legitimate compound subtype is still preserved.
    expect(faviconDataUri(bytes, 'image/svg+xml')).toBe(`data:image/svg+xml;base64,${Buffer.from(bytes).toString('base64')}`);
  });
});

describe('faviconLinkTag', () => {
  it('emits the inlined favicon when we have one', () => {
    expect(faviconLinkTag('data:image/x-icon;base64,AAAA')).toBe(
      '<link rel="icon" href="data:image/x-icon;base64,AAAA" />',
    );
  });

  it('falls back to a blank icon that suppresses the default /favicon.ico request', () => {
    expect(faviconLinkTag(null)).toBe('<link rel="icon" href="data:," />');
  });

  it('escapes any HTML-special char that reaches the href (defense in depth)', () => {
    expect(faviconLinkTag('data:image/x-icon;base64,"><script>')).not.toContain('"><script>');
  });
});

describe('isPublicHost', () => {
  it('accepts public hostnames and public IPs', () => {
    for (const h of ['example.com', 'www.sunhub.com', '8.8.8.8', '1.2.3.4', 'fcbarcelona.com']) {
      expect(isPublicHost(h)).toBe(true);
    }
  });

  it('rejects loopback, private, CGNAT, link-local and metadata addresses', () => {
    for (const h of [
      'localhost',
      'foo.localhost',
      '127.0.0.1',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '100.64.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '[::1]',
      'fc00::1',
      'fd12::1',
      'fe80::1',
    ]) {
      expect(isPublicHost(h)).toBe(false);
    }
  });

  it('does not reject a public 172.x outside the private block', () => {
    expect(isPublicHost('172.15.0.1')).toBe(true);
    expect(isPublicHost('172.32.0.1')).toBe(true);
  });
});

describe('parseIconHref', () => {
  it('prefers a real icon rel over apple-touch-icon and mask-icon', () => {
    const html =
      '<link rel="apple-touch-icon" href="/apple.png">' +
      '<link rel="mask-icon" href="/mask.svg">' +
      '<link rel="icon" href="/real.ico">';
    expect(parseIconHref(html)).toBe('/real.ico');
  });

  it('matches "shortcut icon" and tolerates href before rel', () => {
    expect(parseIconHref('<link href="/f.ico" rel="shortcut icon">')).toBe('/f.ico');
  });

  it('returns null when no icon link is present', () => {
    expect(parseIconHref('<link rel="stylesheet" href="/x.css"><meta charset="utf-8">')).toBeNull();
  });

  it('does not catastrophically backtrack on a hostile body', () => {
    // A 300KB run of unterminated icon-like text used to hang the old regex.
    const hostile = '<link rel="' + '"icon"'.repeat(50_000);
    expect(parseIconHref(hostile)).toBeNull();
  });
});
