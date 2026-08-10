/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/*
 * The driving half of `shaka-perf troubleshoot`: attach over CDP to a frozen
 * session's browsers and inspect the live pages. Node `fetch`/`WebSocket` only,
 * and a second CDP client — Playwright keeps its own pipe — so the run is
 * undisturbed, and closing a connection closes only ours.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CDP_SESSION_FILENAME, type CdpSession } from './debug-session';

// = `${pipeline.name}-results`; keep in sync with the troubleshoot pipeline.
const RESULTS_DIR = 'troubleshoot-results';

interface PageTarget {
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  onEvent(fn: (msg: any) => void): void;
  close(): void;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function readSession(): CdpSession | null {
  try {
    const file = path.resolve(process.cwd(), RESULTS_DIR, CDP_SESSION_FILENAME);
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CdpSession;
  } catch {
    return null;
  }
}

interface ResolvedTarget {
  port: number;
  /** The tab whose URL contains this is the one; undefined ⇒ first real page. */
  matchUrl?: string;
}

function portOf(session: CdpSession, slot: string): number {
  const browser = session.browsers.find((b) => b.slot === slot);
  if (!browser) {
    throw new Error(
      `this session has no "${slot}" browser (it runs: ${session.browsers.map((b) => b.slot).join(', ')}).`,
    );
  }
  return Number(new URL(browser.endpoint).port);
}

/**
 * `<target>` is a side — `visreg:control`, `visreg:experiment`, `perf:control`,
 * `perf:experiment` — or a raw port. The visreg sides share one browser and are
 * told apart by matching the manifest's control/experiment URL against the tabs.
 */
export function resolveTarget(target: string): ResolvedTarget {
  if (/^\d+$/.test(target)) return { port: Number(target) };
  const session = readSession();
  if (!session) {
    throw new Error(
      `"${target}" is not a port and no session manifest was found at ` +
      `${RESULTS_DIR}/${CDP_SESSION_FILENAME}. Pass a numeric port, or run this from the ` +
      'directory where `shaka-perf troubleshoot` is running.',
    );
  }
  if (target === 'visreg:control') return { port: portOf(session, 'visreg'), matchUrl: session.controlURL };
  if (target === 'visreg:experiment') return { port: portOf(session, 'visreg'), matchUrl: session.experimentURL };
  if (target === 'perf:control' || target === 'perf:experiment') return { port: portOf(session, target) };
  throw new Error(
    `unknown target "${target}". Use visreg:control, visreg:experiment, perf:control, perf:experiment, or a raw port.`,
  );
}

// Each stage brings its browser up at its own pace, so commands wait rather than
// making the caller poll.
async function waitForEndpoint(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return;
    } catch { /* not up yet */ }
    await delay(1000);
  }
  throw new Error(
    `no CDP server answered on 127.0.0.1:${port} within ${timeoutMs / 1000}s. ` +
    'Is the session still running, and has this browser reached its stage yet?',
  );
}

async function fetchPages(port: number): Promise<PageTarget[]> {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as PageTarget[];
  return targets.filter((t) => t.type === 'page');
}

function pickPage(pages: PageTarget[], matchUrl: string | undefined): PageTarget {
  if (matchUrl) {
    const hit = pages.find((t) => t.url.includes(matchUrl));
    if (!hit) {
      throw new Error(`no page tab whose URL contains "${matchUrl}". Tabs:\n${pages.map((t) => `  ${t.url}`).join('\n')}`);
    }
    return hit;
  }
  return pages.find((t) => !t.url.startsWith('about:blank')) ?? pages[0];
}

async function connect(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const listeners: Array<(msg: any) => void> = [];
  ws.addEventListener('message', (ev: MessageEvent) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
    onEvent: (fn) => { listeners.push(fn); },
    close: () => ws.close(),
  };
}

async function withPage<T>(target: string, fn: (cdp: Cdp, page: PageTarget) => Promise<T>): Promise<T> {
  const { port, matchUrl } = resolveTarget(target);
  await waitForEndpoint(port);
  const page = pickPage(await fetchPages(port), matchUrl);
  const cdp = await connect(page.webSocketDebuggerUrl);
  try {
    return await fn(cdp, page);
  } finally {
    cdp.close();
  }
}

export function cmdSession(pidOnly: boolean): void {
  const session = readSession();
  if (!session) {
    throw new Error(
      `no session manifest at ${RESULTS_DIR}/${CDP_SESSION_FILENAME}. ` +
      'Is `shaka-perf troubleshoot` running in this directory?',
    );
  }
  if (pidOnly) {
    console.log(String(session.pid));
    return;
  }
  console.log(`pid ${session.pid} — "${session.test}" @ ${session.viewport} (${session.headless ? 'headless' : 'headed'})`);
  const endpointOf = (slot: string) => session.browsers.find((b) => b.slot === slot)?.endpoint;
  const rows: Array<[string, string | undefined, string]> = [
    ['visreg:control', endpointOf('visreg'), session.controlURL],
    ['visreg:experiment', endpointOf('visreg'), session.experimentURL],
    ['perf:control', endpointOf('perf:control'), session.controlURL],
    ['perf:experiment', endpointOf('perf:experiment'), session.experimentURL],
  ];
  for (const [target, endpoint, url] of rows) {
    if (endpoint) console.log(`  ${target.padEnd(18)} ${endpoint}   ${url}`);
  }
}

export async function cmdEval(target: string, expression: string): Promise<void> {
  await withPage(target, async (cdp) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(`page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    console.log(typeof result.value === 'object' ? JSON.stringify(result.value, null, 2) : String(result.value));
  });
}

export async function cmdHtml(target: string): Promise<void> {
  await withPage(target, async (cdp) => {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML',
      returnByValue: true,
    });
    console.log(result.value);
  });
}

export async function cmdShot(target: string, out: string, full: boolean): Promise<void> {
  await withPage(target, async (cdp, page) => {
    const params = full ? { format: 'png', captureBeyondViewport: true } : { format: 'png' };
    const { data } = await cdp.send('Page.captureScreenshot', params);
    const bytes = Buffer.from(data, 'base64');
    fs.writeFileSync(out, bytes);
    console.log(`wrote ${out} (${bytes.length} bytes) from ${page.url}`);
  });
}

export async function cmdConsole(target: string): Promise<void> {
  await withPage(target, async (cdp, page) => {
    // Non-destructive: Runtime.enable/Log.enable only REPLAY the stored buffers
    // — we never clear or reload — so repeated calls return the same history.
    cdp.onEvent((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map((a: any) => a.value ?? a.description ?? a.type).join(' ');
        console.log(`[console.${msg.params.type}] ${text}`);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.log(`[error] ${d.exception?.description ?? d.text}`);
      } else if (msg.method === 'Log.entryAdded') {
        const { level, text, url } = msg.params.entry;
        console.log(`[${level}] ${text}${url ? `  (${url})` : ''}`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await delay(700); // let the replayed buffer arrive
    console.log(`(all buffered messages on ${page.url})`);
  });
}
