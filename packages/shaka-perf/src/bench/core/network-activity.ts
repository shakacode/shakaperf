/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { RunnerResult } from 'lighthouse';
import { writeFileSync } from 'node:fs';

import type { PhaseSample } from './lighthouse-config';

// One network request as it appears in the breakdown file: origin-relative URL,
// its `requestWillBeSent` start time (devtools monotonic seconds), and the
// encoded bytes from its matching `loadingFinished` (0 if it never finished).
interface NetworkRequestRecord {
  url: string;
  startTs: number;
  sizeBytes: number;
}

/**
 * Computes total download size from devtools logs. If outputPath is provided,
 * writes a per-request breakdown file ordered by request start time — one line
 * per request (no per-URL deduplication: the same URL fetched twice is two
 * lines), each prefixed with its seconds since the first request and its
 * encoded size in KB. When
 * lcpTimestampUs is provided, a marker line is inserted at the point where the
 * downloads-before-LCP stage ends (i.e. the page's LCP time).
 */
export function saveNetworkActivity(
  lighthouseResult: RunnerResult,
  url: string,
  outputPath: string | null,
  lcpTimestampUs: number | null = null
): number {
  const devtoolsLogs = lighthouseResult.artifacts.DevtoolsLog;
  if (!devtoolsLogs) return 0;

  const parsedPageUrl = new URL(url);
  const requests: NetworkRequestRecord[] = [];
  let totalSizeBytes = 0;

  devtoolsLogs.forEach((requestWillBeSentEntry: any) => {
    if (
      requestWillBeSentEntry.method === 'Network.requestWillBeSent' &&
      requestWillBeSentEntry.params.request
    ) {
      let requestUrl = requestWillBeSentEntry.params.request.url.replace(
        parsedPageUrl.origin,
        ''
      );
      if (
        requestUrl === '/graphql' &&
        requestWillBeSentEntry.params.request.postData
      ) {
        const postData = JSON.parse(
          requestWillBeSentEntry.params.request.postData
        );
        if (postData.operationName) {
          requestUrl =
            '/graphql?operationName="' + postData.operationName + '"';
        }
      }
      const startTs = requestWillBeSentEntry.params.timestamp ?? 0;
      let sizeBytes = 0;
      devtoolsLogs.find((loadingFinishedEntry: any) => {
        if (
          loadingFinishedEntry.method === 'Network.loadingFinished' &&
          loadingFinishedEntry.params.requestId ===
            requestWillBeSentEntry.params.requestId
        ) {
          const size = loadingFinishedEntry.params.encodedDataLength;
          if (size) {
            sizeBytes += size;
            totalSizeBytes += size;
          }
          return true;
        }
        return false;
      });
      requests.push({ url: requestUrl, startTs, sizeBytes });
    }
  });

  if (outputPath) {
    const lcpTimestampSec =
      lcpTimestampUs != null ? lcpTimestampUs / 1_000_000 : null;
    // URL tie-break keeps the order deterministic across runs when two
    // requests share a timestamp, so the diff against the baseline is stable.
    const sorted = [...requests].sort((a, b) =>
      a.startTs !== b.startTs
        ? a.startTs - b.startTs
        : a.url.localeCompare(b.url)
    );
    // Seconds prefix is relative to the first request, so each line reads as
    // elapsed time from the start of network activity rather than a raw clock.
    // The size is a second prefix on the same line (not a next-liner) so each
    // request is a single self-contained row of time, size, then URL.
    const t0 = sorted.length ? sorted[0].startTs : 0;
    const lines = sorted.map(
      (r) =>
        `[${(r.startTs - t0).toFixed(3)}s] [${(r.sizeBytes / 1024).toFixed(2)} KB] ${r.url}`
    );
    if (lcpTimestampSec != null) {
      const splitIndex = sorted.findIndex((r) => r.startTs >= lcpTimestampSec);
      const insertAt = splitIndex === -1 ? lines.length : splitIndex;
      lines.splice(insertAt, 0, '--- end of downloads-before-LCP stage ---');
    }
    writeFileSync(outputPath, lines.join('\n') + '\n');
  }

  return totalSizeBytes;
}

const JS_EXTENSIONS = ['.js', '.mjs'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif'];
const FONT_EXTENSIONS = ['.woff', '.woff2', '.ttf', '.otf', '.eot'];

function getUrlExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dotIndex = pathname.lastIndexOf('.');
    if (dotIndex === -1) return '';
    return pathname.slice(dotIndex).toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Analyzes network resources from devtools logs to produce resource breakdown metrics.
 *
 * @param lighthouseResult - The Lighthouse runner result containing devtools logs
 * @param url - The page URL (used to strip origin from request URLs)
 * @param lcpTimestampUs - Raw trace event `ts` in microseconds for the page's LCP
 *   (final `largestContentfulPaint::Candidate`). If provided, downloads-before-LCP
 *   metrics are computed.
 */
export function analyzeNetworkResources(
  lighthouseResult: RunnerResult,
  url: string,
  lcpTimestampUs: number | null,
): PhaseSample[] {
  const devtoolsLogs = lighthouseResult.artifacts.DevtoolsLog;
  if (!devtoolsLogs) return [];

  // Convert LCP timestamp from microseconds to seconds (devtools log time domain)
  const lcpTimestampSec = lcpTimestampUs != null
    ? lcpTimestampUs / 1_000_000
    : null;

  const parsedPageUrl = new URL(url);

  // Build a map of requestId -> { url, size, requestTimestamp }
  interface RequestInfo {
    url: string;
    size: number;
    requestTimestamp: number;
  }
  const requests = new Map<string, RequestInfo>();

  // First pass: collect all request URLs and timestamps
  for (const entry of devtoolsLogs) {
    if (
      entry.method === 'Network.requestWillBeSent' &&
      entry.params.request
    ) {
      const requestUrl = entry.params.request.url.replace(parsedPageUrl.origin, '');
      requests.set(entry.params.requestId, {
        url: requestUrl,
        size: 0,
        requestTimestamp: entry.params.timestamp ?? 0,
      });
    }
  }

  // Second pass: attach sizes from loadingFinished
  for (const entry of devtoolsLogs) {
    if (entry.method === 'Network.loadingFinished') {
      const req = requests.get(entry.params.requestId);
      if (req && entry.params.encodedDataLength) {
        req.size = entry.params.encodedDataLength;
      }
    }
  }

  let jsCount = 0;
  let jsBytes = 0;
  let imagesCount = 0;
  let imagesBytes = 0;
  let fontsCount = 0;
  let fontsBytes = 0;
  let totalCount = 0;
  let downloadsBeforeLcpCount = 0;
  let downloadsBeforeLcpBytes = 0;

  for (const req of requests.values()) {
    totalCount++;
    const ext = getUrlExtension(parsedPageUrl.origin + req.url);

    if (JS_EXTENSIONS.includes(ext)) {
      jsCount++;
      jsBytes += req.size;
    } else if (IMAGE_EXTENSIONS.includes(ext)) {
      imagesCount++;
      imagesBytes += req.size;
    } else if (FONT_EXTENSIONS.includes(ext)) {
      fontsCount++;
      fontsBytes += req.size;
    }

    if (lcpTimestampSec != null && req.requestTimestamp < lcpTimestampSec) {
      downloadsBeforeLcpCount++;
      downloadsBeforeLcpBytes += req.size;
    }
  }

  const results: PhaseSample[] = [
    { phase: 'downloads-count', duration: totalCount, start: 0, sign: 1, unit: '' },
    { phase: 'js', duration: jsBytes / 1024, start: 0, sign: 1, unit: 'KB' },
    { phase: 'js-count', duration: jsCount, start: 0, sign: 1, unit: '' },
    { phase: 'images', duration: imagesBytes / 1024, start: 0, sign: 1, unit: 'KB' },
    { phase: 'images-count', duration: imagesCount, start: 0, sign: 1, unit: '' },
    { phase: 'fonts', duration: fontsBytes / 1024, start: 0, sign: 1, unit: 'KB' },
    { phase: 'fonts-count', duration: fontsCount, start: 0, sign: 1, unit: '' },
  ];

  if (lcpTimestampSec != null) {
    results.push(
      { phase: 'downloads-before-LCP', duration: downloadsBeforeLcpBytes / 1024, start: 0, sign: 1, unit: 'KB' },
      { phase: 'downloads-count-before-LCP', duration: downloadsBeforeLcpCount, start: 0, sign: 1, unit: '' },
    );
  }

  return results;
}
