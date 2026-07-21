/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Viewport } from '../../../config';

// "Agent readiness" = how legible a page is to AI agents and answer engines
// (ChatGPT, Claude, Perplexity, Google AI Overviews, shopping agents). The stage
// captures the OBJECTIVE signals here at audit time; the client report turns them
// into a 0-100 score + plain-language guidance (see ../../../warm-email).
//
// Every page is captured TWICE and compared:
//  - `raw`     : the HTML the server returns BEFORE any JavaScript runs (a plain
//                fetch). Most AI crawlers read this and many do not execute JS,
//                so a client-rendered SPA hands them a near-empty shell.
//  - `rendered`: the same page after the browser ran its JavaScript (the DOM a
//                person, and a JS-rendering crawler, actually sees).
// The gap between the two is the core "reachable without JavaScript" signal and
// the heart of ShakaCode's SSR pitch.

// Presence flags for the Open Graph tags that answer engines and link unfurlers
// read when they summarize a page.
export interface OpenGraphSignals {
  title: boolean;
  description: boolean;
  image: boolean;
  type: boolean;
  siteName: boolean;
}

// schema.org / JSON-LD structured data found on the page. `types` is the flat
// set of `@type` values across every JSON-LD block (and any `@graph` children),
// e.g. ["Organization", "Product", "BreadcrumbList"].
export interface StructuredDataSignals {
  blocks: number; // <script type="application/ld+json"> count
  valid: number; // blocks that parsed as JSON
  invalid: number; // blocks present but unparseable (a real, common defect)
  types: string[]; // distinct @type values, lower-cased de-duped
  microdataItems: number; // [itemscope][itemtype] elements (the older microdata form)
}

export interface HeadingSignals {
  h1Count: number;
  total: number; // h1..h6 count
  // No heading level is skipped going down the document (e.g. h2 -> h4). A clean
  // outline is how a machine reconstructs the page's structure.
  orderOk: boolean;
}

// Presence of the HTML5 landmark regions (or their ARIA-role equivalents) that
// let a machine tell navigation/chrome from the actual content.
export interface LandmarkSignals {
  main: boolean;
  nav: boolean;
  header: boolean;
  footer: boolean;
  article: boolean;
}

export interface LinkSignals {
  total: number;
  // Links whose visible text (or aria-label) is generic ("click here", "read
  // more", a bare URL, or empty). Opaque link text gives an agent no idea where
  // the link goes.
  nondescriptive: number;
}

export interface ImageSignals {
  total: number;
  withAlt: number; // images carrying a non-empty alt attribute
}

// The full per-view signal set. Computed identically for `raw` and `rendered` so
// the two are directly comparable.
export interface PageSignals {
  title: string;
  titlePresent: boolean;
  metaDescription: string;
  metaDescriptionPresent: boolean;
  canonical: boolean;
  lang: string; // <html lang> value ('' when absent)
  robotsMeta: string; // <meta name="robots"> content (e.g. "noindex")
  og: OpenGraphSignals;
  twitterCard: boolean;
  structuredData: StructuredDataSignals;
  headings: HeadingSignals;
  landmarks: LandmarkSignals;
  links: LinkSignals;
  images: ImageSignals;
  textChars: number; // visible-ish text length (body minus script/style/etc.)
  textWords: number;
  textSample?: string; // short rendered-content sample for later verification copy
}

// What a no-JS fetch returned, plus the parsed signals. `signals` is null when
// the fetch itself failed (network error / non-HTML) so the report can say
// "could not fetch the server HTML" rather than claiming an empty page.
export interface RawFetchResult {
  ok: boolean;
  status?: number; // HTTP status of the raw fetch
  contentType?: string;
  bytes?: number; // size of the raw HTML body
  // True when the raw response looks like a bot-block / challenge page (a
  // Cloudflare/Akamai interstitial, a 403/429) rather than the real page - an AI
  // crawler hitting that wall sees nothing useful either.
  likelyBlocked: boolean;
  signals: PageSignals | null;
}

// The stage's measurement, persisted to <id>/agent-readiness.json. One per
// (test, viewport); the client report reads the phone row.
export interface AgentReadinessResult {
  url: string;
  viewportLabel: string;
  viewport: Viewport;
  fetchedAt: string; // ISO timestamp of the raw fetch
  raw: RawFetchResult;
  rendered: PageSignals;
  // Bytes of the rendered DOM vs the raw HTML, a coarse "how much is assembled in
  // the browser" gauge that complements the text-word comparison.
  rawHtmlBytes?: number;
  renderedHtmlBytes?: number;
  // True when the raw fetch OR the rendered page was a bot-protection / challenge
  // interstitial, not the real page - so the report says "could not measure"
  // instead of scoring the challenge page's markup as the site's.
  blocked?: boolean;
}
