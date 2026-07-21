/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PageSignals } from './types';

// The agent-readiness signal reader. Runs IN THE BROWSER via `page.evaluate`, so
// it must be fully self-contained: it may touch only DOM globals, never a
// module-scope import or helper (Playwright serializes the function source and
// runs it in the page). The SAME function reads both the rendered DOM and the
// raw server HTML (loaded into a JavaScript-disabled context), which is what
// makes the two views directly comparable.
//
// Exported as a function value (not called here) purely so the engine can hand
// it to `page.evaluate(extractPageSignals)` and tests can document its shape.
export function extractPageSignals(): PageSignals {
  const doc = document;
  const text = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();
  const attr = (el: Element | null, name: string): string => text(el?.getAttribute(name));
  const metaContent = (selector: string): string => attr(doc.querySelector(selector), 'content');

  const title = text(doc.title) || attr(doc.querySelector('title'), '');
  const metaDescription = metaContent('meta[name="description" i]');
  const canonical = !!doc.querySelector('link[rel="canonical" i][href]');
  const lang = attr(doc.documentElement, 'lang');
  const robotsMeta = metaContent('meta[name="robots" i]');

  const og = {
    title: !!metaContent('meta[property="og:title" i]'),
    description: !!metaContent('meta[property="og:description" i]'),
    image: !!metaContent('meta[property="og:image" i]'),
    type: !!metaContent('meta[property="og:type" i]'),
    siteName: !!metaContent('meta[property="og:site_name" i]'),
  };
  const twitterCard = !!metaContent('meta[name="twitter:card" i]');

  // ---- structured data (JSON-LD) ----
  const ldBlocks = Array.from(doc.querySelectorAll('script[type="application/ld+json" i]'));
  let ldValid = 0;
  let ldInvalid = 0;
  const ldTypes = new Set<string>();
  const collectType = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(collectType);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj['@type'];
    if (typeof t === 'string') ldTypes.add(t.toLowerCase());
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && ldTypes.add(x.toLowerCase()));
    if (Array.isArray(obj['@graph'])) (obj['@graph'] as unknown[]).forEach(collectType);
  };
  for (const block of ldBlocks) {
    const src = (block.textContent || '').trim();
    if (!src) {
      ldInvalid++;
      continue;
    }
    try {
      collectType(JSON.parse(src));
      ldValid++;
    } catch {
      ldInvalid++;
    }
  }
  const microdataItems = doc.querySelectorAll('[itemscope][itemtype]').length;

  // ---- headings ----
  const headingEls = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const levels = headingEls.map((h) => Number(h.tagName.slice(1)));
  const h1Count = levels.filter((l) => l === 1).length;
  let orderOk = true;
  for (let i = 1; i < levels.length; i++) {
    // A jump DOWN of more than one level (h2 -> h4) breaks the outline; going
    // back up any number of levels (h4 -> h2) is fine.
    if (levels[i] - levels[i - 1] > 1) {
      orderOk = false;
      break;
    }
  }

  // ---- landmarks ----
  const has = (selector: string): boolean => !!doc.querySelector(selector);
  const landmarks = {
    main: has('main, [role="main" i]'),
    nav: has('nav, [role="navigation" i]'),
    header: has('header, [role="banner" i]'),
    footer: has('footer, [role="contentinfo" i]'),
    article: has('article'),
  };

  // ---- links ----
  const generic = new Set([
    'click here', 'click', 'here', 'read more', 'read', 'learn more', 'more',
    'link', 'this', 'this link', 'details', 'see more', 'continue', 'go', 'view',
    'download', 'open', 'see', 'find out more',
  ]);
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  let nondescriptive = 0;
  for (const a of anchors) {
    const label = (attr(a, 'aria-label') || text(a.textContent)).toLowerCase();
    if (!label || generic.has(label) || /^https?:\/\//.test(label)) nondescriptive++;
  }

  // ---- images ----
  const imgs = Array.from(doc.querySelectorAll('img'));
  let withAlt = 0;
  for (const im of imgs) {
    const alt = im.getAttribute('alt');
    if (alt !== null && alt.trim().length > 0) withAlt++;
  }

  // ---- visible-ish text volume ----
  // Clone the body, strip the elements that never carry reading content, and
  // count what is left. Done identically on both views so the raw-vs-rendered
  // word ratio is apples-to-apples.
  let textChars = 0;
  let textWords = 0;
  let textSample: string | undefined;
  if (doc.body) {
    const clone = doc.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script,style,noscript,template,svg').forEach((e) => e.remove());
    const body = text(clone.textContent);
    textChars = body.length;
    textWords = body ? body.split(' ').filter(Boolean).length : 0;
    const sentences: string[] = [];
    let sentenceStart = 0;
    const isDigit = (char: string): boolean => char >= '0' && char <= '9';
    const isLower = (char: string): boolean => char >= 'a' && char <= 'z';
    const isUpper = (char: string): boolean => char >= 'A' && char <= 'Z';
    const isSentenceBoundary = (index: number): boolean => {
      const mark = body[index];
      if (mark !== '.') return true;
      const prev = body[index - 1] || '';
      const next = body[index + 1] || '';
      if ((next === '.' || prev === '.') || (isDigit(prev) && isDigit(next))) return false;
      const before = body.slice(Math.max(0, index - 16), index);
      const word = before.match(/[A-Za-z]+$/)?.[0] || '';
      const after = body.slice(index + 1).match(/^\s*([A-Za-z])/)?.[1] || '';
      if (word.length === 1 && /[A-Za-z]/.test(next)) return false;
      if (word.length === 1 && isUpper(word) && after && isUpper(after)) return false;
      if (/([A-Za-z]\.)+[A-Za-z]$/.test(before)) return false;
      if (/^(e|g|i|mr|mrs|ms|dr|prof|sr|jr|vs|etc|inc|ltd|co|corp|st|ave|no)$/i.test(word) && isLower(after)) {
        return false;
      }
      return true;
    };
    for (let i = 0; i < body.length; i++) {
      if (!/[.!?]/.test(body[i]) || !isSentenceBoundary(i)) continue;
      let end = i + 1;
      while (/[.!?]/.test(body[end] || '')) end++;
      sentences.push(body.slice(sentenceStart, end));
      sentenceStart = end;
      i = end - 1;
    }
    if (sentenceStart < body.length) sentences.push(body.slice(sentenceStart));
    for (const sentence of sentences) {
      const clean = text(sentence);
      if (!clean) continue;
      const words = clean.split(' ').filter(Boolean);
      if (words.length < 8) continue;
      const short = words.length > 20 ? words.slice(0, 20).join(' ') : clean;
      textSample = short.length > 200
        ? short.slice(0, 200).replace(/\s+\S*$/, '').trim()
        : short;
      break;
    }
  }

  return {
    title,
    titlePresent: title.length > 0,
    metaDescription,
    metaDescriptionPresent: metaDescription.length > 0,
    canonical,
    lang,
    robotsMeta,
    og,
    twitterCard,
    structuredData: {
      blocks: ldBlocks.length,
      valid: ldValid,
      invalid: ldInvalid,
      types: Array.from(ldTypes),
      microdataItems,
    },
    headings: { h1Count, total: headingEls.length, orderOk },
    landmarks,
    links: { total: anchors.length, nondescriptive },
    images: { total: imgs.length, withAlt },
    textChars,
    textWords,
    ...(textSample ? { textSample } : {}),
  };
}
