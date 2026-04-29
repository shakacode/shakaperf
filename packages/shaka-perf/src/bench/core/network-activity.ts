import type { RunnerResult } from 'lighthouse';
import { writeFileSync } from 'node:fs';

import type { PhaseSample } from './lighthouse-config';

/**
 * Computes total download size from devtools logs. If outputPath is provided,
 * writes a per-URL breakdown file ordered by request start time. When
 * earlyPhaseTimestampUs is provided, a marker line is inserted at the point
 * where the early-downloads stage ends.
 */
export function saveNetworkActivity(
  lighthouseResult: RunnerResult,
  url: string,
  outputPath: string | null,
  earlyPhaseTimestampUs: number | null = null
): number {
  const devtoolsLogs = lighthouseResult.artifacts.DevtoolsLog;
  if (!devtoolsLogs) return 0;

  const parsedPageUrl = new URL(url);
  const sizesByUrl: { [requestUrl: string]: number } = {};
  const earliestTimestampByUrl: { [requestUrl: string]: number } = {};
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
      const requestTimestamp = requestWillBeSentEntry.params.timestamp ?? 0;
      if (
        earliestTimestampByUrl[requestUrl] === undefined ||
        requestTimestamp < earliestTimestampByUrl[requestUrl]
      ) {
        earliestTimestampByUrl[requestUrl] = requestTimestamp;
      }
      devtoolsLogs.find((loadingFinishedEntry: any) => {
        if (
          loadingFinishedEntry.method === 'Network.loadingFinished' &&
          loadingFinishedEntry.params.requestId ===
            requestWillBeSentEntry.params.requestId
        ) {
          const size = loadingFinishedEntry.params.encodedDataLength;
          if (size) {
            sizesByUrl[requestUrl] = (sizesByUrl[requestUrl] ?? 0) + size;
            totalSizeBytes += size;
          }
        }
      });
    }
  });

  if (outputPath) {
    const earlyPhaseTimestampSec = earlyPhaseTimestampUs != null
      ? earlyPhaseTimestampUs / 1_000_000
      : null;
    const urls = Object.keys(sizesByUrl).sort(
      (a, b) => earliestTimestampByUrl[a] - earliestTimestampByUrl[b]
    );
    const lines: string[] = [];
    let earlyPhaseMarkerInserted = false;
    for (const u of urls) {
      if (
        earlyPhaseTimestampSec != null &&
        !earlyPhaseMarkerInserted &&
        earliestTimestampByUrl[u] >= earlyPhaseTimestampSec
      ) {
        lines.push('--- end of early-downloads stage ---');
        earlyPhaseMarkerInserted = true;
      }
      lines.push(`${u}\n⤷ ${(sizesByUrl[u] / 1024).toFixed(2)} KB`);
    }
    if (earlyPhaseTimestampSec != null && !earlyPhaseMarkerInserted) {
      lines.push('--- end of early-downloads stage ---');
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
 * @param earlyPhaseTimestampUs - Raw trace event `ts` in microseconds for the early-phase
 *   marker (e.g. hydration-start). If provided, early-loads metrics are computed.
 * @param prefix - Phase name prefix (e.g. '' or 'control-')
 */
export function analyzeNetworkResources(
  lighthouseResult: RunnerResult,
  url: string,
  earlyPhaseTimestampUs: number | null,
  prefix: string
): PhaseSample[] {
  const devtoolsLogs = lighthouseResult.artifacts.DevtoolsLog;
  if (!devtoolsLogs) return [];

  // Convert early-phase timestamp from microseconds to seconds (devtools log time domain)
  const earlyPhaseTimestampSec = earlyPhaseTimestampUs != null
    ? earlyPhaseTimestampUs / 1_000_000
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
  let earlyLoadsCount = 0;
  let earlyLoadsBytes = 0;

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

    if (earlyPhaseTimestampSec != null && req.requestTimestamp < earlyPhaseTimestampSec) {
      earlyLoadsCount++;
      earlyLoadsBytes += req.size;
    }
  }

  const results: PhaseSample[] = [
    { phase: prefix + 'downloads-count', duration: totalCount, start: 0, sign: 1, unit: '' },
    { phase: prefix + 'js', duration: jsBytes / 1024, start: 0, sign: 1, unit: 'KB' },
    { phase: prefix + 'js-count', duration: jsCount, start: 0, sign: 1, unit: '' },
    { phase: prefix + 'images', duration: imagesBytes / 1024, start: 0, sign: 1, unit: 'KB' },
    { phase: prefix + 'images-count', duration: imagesCount, start: 0, sign: 1, unit: '' },
    { phase: prefix + 'fonts', duration: fontsBytes / 1024, start: 0, sign: 1, unit: 'KB' },
    { phase: prefix + 'fonts-count', duration: fontsCount, start: 0, sign: 1, unit: '' },
  ];

  if (earlyPhaseTimestampSec != null) {
    results.push(
      { phase: prefix + 'early-downloads', duration: earlyLoadsBytes / 1024, start: 0, sign: 1, unit: 'KB' },
      { phase: prefix + 'early-downloads-count', duration: earlyLoadsCount, start: 0, sign: 1, unit: '' },
    );
  }

  return results;
}
