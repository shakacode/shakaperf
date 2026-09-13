/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// The page behind integration-tests/orphaned-poller.spec.ts. Serves one
// document shaped to keep exactly one of Lighthouse's load gates pending past
// maxWaitForLoad and its cpu-idle poller re-scheduling forever:
//
//   - exactly ONE fetch in flight at all times (/tick, 100ms latency): a fetch
//     is a High-priority request, so Lighthouse's "critical network idle" gate
//     never resolves — while its "2-idle" gate (<=2 in flight) resolves early
//   - a 55ms busy-loop every 400ms, started after first paint: enough to count
//     as a long task (>=50ms) so "time since last long task" stays small, light
//     enough that Lighthouse's 1s hung-page ping still gets through
//   - window.__stopNetwork(): the testFn calls this just before it returns, so
//     the critical gate resolves AFTER the hold releases
//
// Importable (startFixtureServer) and runnable: `node server.mjs [port]`.

import * as http from 'node:http';

export const PAGE_HTML = `<!doctype html>
<meta charset="utf-8">
<title>orphaned poller fixture</title>
<style>div.r{height:14px;margin:1px;background:#eee}</style>
<h1>orphaned poller fixture</h1>
<div id="rows"></div>
<script>
  // Some DOM so artifact collection (full-page screenshot, trace) takes a
  // moment after the race settles - that is the window the orphan is created in.
  const rows = document.getElementById('rows');
  for (let i = 0; i < 8000; i++) { const d = document.createElement('div'); d.className = 'r'; d.textContent = 'row ' + i; rows.appendChild(d); }

  let stopped = false;
  window.__stopNetwork = () => { stopped = true; };
  (async () => { let n = 0; while (!stopped) { await fetch('/tick?n=' + (n++)).catch(() => {}); } })();

  requestAnimationFrame(() => setTimeout(() => {
    setInterval(() => { const end = performance.now() + 55; while (performance.now() < end) {} }, 400);
  }, 300));
</script>`;

/** @param {number} port  @returns {Promise<http.Server>} */
export function startFixtureServer(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/tick') {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); }, 100);
      return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/up') { res.writeHead(200); res.end('ok'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(PAGE_HTML);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const port = Number(process.argv[2] || 50990);
  startFixtureServer(port).then(() => console.log(`orphaned-poller fixture on http://127.0.0.1:${port}`));
}
