/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { test, expect } from './base-test';
import { execSync, spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  ORIGINAL_REPO, DEMO_CWD, CONTROL_PORT, EXPERIMENT_PORT,
  env, loud, stage, startServers, stripAnsi, waitForPort,
} from './helpers';

const SNAPSHOT_DIR = path.join(ORIGINAL_REPO, 'integration-tests', 'snapshots', 'troubleshoot-results');
const RESULTS_DIR = path.join(DEMO_CWD, 'troubleshoot-results');
const SESSION_FILE = path.join(RESULTS_DIR, 'troubleshoot-session.json');
const ARTIFACT = '01-sides.png';

const TEST_NAME = 'Click Shop Now on the homepage';
const VIEWPORT = 'phone';

/** Every attachable side the session publishes; each is driven independently below. */
const SIDES = ['visreg:control', 'visreg:experiment', 'perf:control', 'perf:experiment'] as const;
type Side = (typeof SIDES)[number];

/** The page the test body navigates to — every side must be parked there. */
const EXPECTED_PATH = '/products';

/** Product names on the settled /products page, as an array CDP returns by value. */
const PRODUCT_LIST_EXPRESSION =
  'Array.from(document.querySelectorAll(\'a[href^="/products/"] h2\'), (el) => el.textContent.trim())';

/** The exact catalogue the settled /products page renders — pinned as a concrete value. */
const EXPECTED_PRODUCTS = [
  'Wireless Bluetooth Headphones',
  'Organic Cotton T-Shirt',
  'Stainless Steel Water Bottle',
  'Mechanical Keyboard',
  'Running Shoes',
  'Leather Wallet',
  'Smart Watch',
  'Yoga Mat',
  'Backpack',
  'Coffee Maker',
];

/**
 * The same read as PRODUCT_LIST_EXPRESSION, but as a Promise: an IIFE that polls
 * until the cards render, then resolves the list. It only reads back a value
 * because `eval` sends Runtime.evaluate with awaitPromise — a bare expression
 * would return the pending Promise, not its result.
 */
const ASYNC_PRODUCT_LIST_EXPRESSION = `(async () => {
  const read = () => Array.from(document.querySelectorAll('a[href^="/products/"] h2'), (el) => el.textContent.trim());
  const deadline = Date.now() + 5000;
  while (read().length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  return read();
})()`;

const CONSOLE_MARKER = 'shakaperf-troubleshoot-integration-marker';

const THROWING_EXPRESSION = `(() => { throw new Error('${CONSOLE_MARKER}-boom'); })()`;

/** Every logged block is indented under the line that produced it, so the transcript nests. */
const indent = (text: string, pad = '    '): string =>
  text.replace(/\n$/, '').split('\n').map((line) => `${pad}${line}`).join('\n');

function say(message: string): void {
  console.log(`  ${message}`);
}

/**
 * Announce a check, run it, confirm it. The baseline log is read as a diff, so
 * every assertion states itself there BEFORE it runs — a failed run then ends on
 * the `CHECK` line that was being evaluated, naming it without any stack.
 */
function check(description: string, assertion: () => void): void {
  console.log(`  ▸ CHECK ${description}`);
  assertion();
  console.log('    ✓ ok');
}

/** `check` for an assertion that has to be awaited — an unawaited one never fails the test. */
async function checkAsync(description: string, assertion: () => Promise<void>): Promise<void> {
  console.log(`  ▸ CHECK ${description}`);
  await assertion();
  console.log('    ✓ ok');
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * One `shaka-perf troubleshoot <subcommand>` invocation, run exactly the way an
 * agent runs it, with its full result echoed. stdout and stderr are kept apart
 * on purpose: "eval prints the value and nothing else" is a claim about stdout
 * alone — and stdout is left UNSTRIPPED, because an escape sequence in it is
 * exactly the kind of thing that claim has to exclude.
 */
function troubleshoot(args: string[], opts: { quiet?: boolean } = {}): CliResult {
  if (!opts.quiet) loud(`run: shaka-perf troubleshoot ${args.join(' ')}`);
  const res = spawnSync('yarn', ['shaka-perf', 'troubleshoot', ...args], {
    cwd: DEMO_CWD,
    env,
    encoding: 'utf8',
    timeout: 3 * 60 * 1000,
  });
  if (res.error) throw res.error;
  const result: CliResult = {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: stripAnsi(res.stderr ?? ''),
  };
  if (!opts.quiet) {
    say(`← exit ${result.status}`);
    // Both streams unconditionally, `(empty)` included: "printed nothing on
    // stderr" is an assertion this suite makes, so its evidence has to be here.
    say(`← stdout ${result.stdout ? `(${result.stdout.length} bytes):` : '(empty)'}`);
    if (result.stdout) console.log(indent(result.stdout));
    say(`← stderr ${result.stderr ? `(${result.stderr.length} bytes):` : '(empty)'}`);
    if (result.stderr) console.log(indent(result.stderr));
  }
  return result;
}

function startSession(): ChildProcess {
  // `--headed=false` keeps the browsers alive and attachable without needing a
  // display, which is the only form this suite can drive. detached: true makes
  // the child a process-group leader, so one signal reaps yarn and the parked
  // CLI under it — the browsers need `browserPidsOn`, see there.
  const argv = ['shaka-perf', 'troubleshoot', '--viewport', VIEWPORT, '--filter', TEST_NAME, '--headed=false'];
  loud(`launch (background, never exits): yarn ${argv.join(' ')}`);
  say(`cwd ${DEMO_CWD}`);
  const child = spawn('yarn', argv, { cwd: DEMO_CWD, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  say(`spawned pid ${child.pid} (process-group leader)`);
  // Echoed live under a `[session ...]` prefix: this is the run under test, and
  // its stage banners, per-side annotations and engine errors are the only
  // record of what the browsers were doing while the subcommands drove them.
  // The lines interleave with the subcommand blocks nondeterministically — the
  // run script's header lists that with the other ordering noise.
  for (const [name, stream] of [['out', child.stdout], ['err', child.stderr]] as const) {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      for (const line of stripAnsi(chunk).split('\n')) {
        if (line.trim()) console.log(`  [session ${name}] ${line}`);
      }
    });
  }
  return child;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Both halves of readiness in one poll: the browser answering CDP is not the
 * same as the test body having driven it to the products page, and every
 * assertion below is about the settled page.
 */
async function waitForSideAtProducts(side: Side, timeoutMs = 8 * 60 * 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let last = '';
  while (Date.now() < deadline) {
    attempt += 1;
    const res = troubleshoot(['eval', side, 'location.pathname'], { quiet: true });
    last = res.status === 0 ? res.stdout.trim() : `exit ${res.status}: ${res.stderr.trim().split('\n')[0]}`;
    if (res.status === 0 && res.stdout.trim() === EXPECTED_PATH) {
      say(`· ${side} attempt ${attempt}: location.pathname = ${last} — parked`);
      return;
    }
    say(`· ${side} attempt ${attempt}: location.pathname = ${last} — waiting for ${EXPECTED_PATH}`);
    await delay(3000);
  }
  throw new Error(`${side} never reached ${EXPECTED_PATH} within ${timeoutMs / 1000}s; last: ${last}`);
}

/**
 * The browsers are the one thing that outlives the CLI: both Playwright and
 * chrome-launcher spawn Chrome detached, so it leads its own process group and
 * no signal aimed at the session's group reaches it. Its debug-port flag is the
 * only handle that identifies it precisely — matching on it can't hit anyone
 * else's Chrome, since these ports were probed free for this session.
 */
function browserPidsOn(ports: readonly number[]): number[] {
  const raw = execSync('ps axww -o pid=,command=', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const pids: number[] = [];
  for (const line of raw.split('\n')) {
    if (!ports.some((port) => line.includes(`--remote-debugging-port=${port}`))) continue;
    const match = line.trim().match(/^(\d+)\s/);
    if (match) pids.push(Number(match[1]));
  }
  return pids;
}

async function endpointsAreDown(endpoints: readonly string[], timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive: string[] = [];
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) alive.push(endpoint);
      } catch { /* down */ }
    }
    if (alive.length === 0) {
      say(`· every endpoint refused: ${endpoints.join(', ')}`);
      return true;
    }
    say(`· still answering CDP: ${alive.join(', ')}`);
    await delay(2000);
  }
  return false;
}

/** PNG header, so a shot's real pixel size is in the log without pulling in a decoder. */
function pngSize(file: string): string {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, header, 0, 24, 0); } finally { fs.closeSync(fd); }
  return `${header.readUInt32BE(16)}x${header.readUInt32BE(20)}`;
}

/**
 * One reviewable artifact per run instead of four: the sides are only
 * interesting next to each other, and a single stable-named PNG is what the
 * screenshot-diff report can compare run to run.
 */
async function writeSideBySideArtifact(
  page: import('@playwright/test').Page,
  shots: Array<{ side: Side; file: string }>,
  out: string,
): Promise<void> {
  const cards = shots.map(({ side, file }) => {
    const b64 = fs.readFileSync(file).toString('base64');
    return `<figure><figcaption>${side}</figcaption><img src="data:image/png;base64,${b64}"></figure>`;
  }).join('\n');
  // Short viewport + fullPage: the strip's own content sets the height, so the
  // artifact carries no dead band that a diff would have to look past.
  await page.setViewportSize({ width: 1400, height: 200 });
  await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; padding: 24px; background: #1b1d23; font: 14px/1.4 -apple-system, system-ui, sans-serif; }
  h1 { color: #e8eaed; font-size: 16px; margin: 0 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: start; }
  figure { margin: 0; background: #24262d; border-radius: 6px; overflow: hidden; }
  figcaption { color: #9aa0a6; padding: 8px 10px; font-family: ui-monospace, monospace; font-size: 12px; }
  img { display: block; width: 100%; height: auto; }
</style>
<h1>shaka-perf troubleshoot — ${TEST_NAME} @ ${VIEWPORT}</h1>
<div class="grid">${cards}</div>`);
  await page.screenshot({ path: out, fullPage: true });
}

test('run shaka-perf troubleshoot and drive its frozen browsers over CDP @troubleshoot', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);

  loud('PLAN: launch one troubleshoot session, drive all four frozen browsers over CDP, then reap them');
  say(`test        "${TEST_NAME}" @ ${VIEWPORT}`);
  say(`sides       ${SIDES.join(', ')}`);
  say(`control     http://localhost:${CONTROL_PORT}`);
  say(`experiment  http://localhost:${EXPERIMENT_PORT}`);
  say(`session     ${SESSION_FILE}`);
  say(`artifact    ${path.join(SNAPSHOT_DIR, ARTIFACT)}`);

  startServers();
  await stage(`Waiting for ports ${CONTROL_PORT} + ${EXPERIMENT_PORT}`, () => Promise.all([
    waitForPort(CONTROL_PORT),
    waitForPort(EXPERIMENT_PORT),
  ]));

  // A manifest left by an earlier run would let `session` resolve before this
  // run has written its own, and every target would point at dead ports.
  say(`clearing ${RESULTS_DIR} so no stale manifest can answer for this run`);
  fs.rmSync(RESULTS_DIR, { recursive: true, force: true });

  let child: ChildProcess | undefined;
  let session: { pid: number; browsers: Array<{ slot: string; endpoint: string }> } | undefined;

  try {
    await stage('Launch the troubleshoot session (headless, never exits by design)', async () => {
      child = startSession();
      say(`waiting up to 180s for the session manifest at ${SESSION_FILE}`);
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline && !fs.existsSync(SESSION_FILE)) await delay(1000);
      if (!fs.existsSync(SESSION_FILE)) {
        throw new Error(`troubleshoot never wrote ${SESSION_FILE}`);
      }
      const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
      say('manifest on disk:');
      console.log(indent(raw));
      session = JSON.parse(raw);
    });

    // The manifest is the contract every subcommand reads; `session` is how an
    // agent discovers the sides, so it must agree with what is on disk.
    await stage('`troubleshoot session` must agree with the manifest', () => {
      const listed = troubleshoot(['session']);
      check('session exits 0', () => expect(listed.status).toBe(0));
      for (const side of SIDES) {
        check(`session lists the ${side} target`, () => expect(listed.stdout).toContain(side));
      }
      check('the manifest publishes one visreg browser and one Chrome per perf side', () =>
        expect(session!.browsers.map((b) => b.slot).sort())
          .toEqual(['perf:control', 'perf:experiment', 'visreg']));

      const pidOnly = troubleshoot(['session', '--pid']);
      // Raw stdout, byte for byte: this is the `kill "$(… --pid)"` contract, and
      // it once shipped broken because console.log colorized the bare number.
      check('session --pid prints the manifest pid and nothing else', () =>
        expect(pidOnly.stdout).toBe(`${session!.pid}\n`));
    });

    await stage(`Every side must park on ${EXPECTED_PATH} (the test body clicks through)`, async () => {
      for (const side of SIDES) await waitForSideAtProducts(side);
    });

    // read console → eval a console.log → read console again. The second read
    // must show what the eval logged, which is what makes `console` useful at
    // all; the third pins the "non-destructive, never resets the buffer" claim.
    await stage('console → eval a console.log → console (replay, then non-destructive re-read)', () => {
      say('1/4 read the buffer before anything is logged into it');
      const before = troubleshoot(['console', 'visreg:experiment']);
      check('console exits 0', () => expect(before.status).toBe(0));
      check('console names the page it read', () =>
        expect(before.stdout).toContain('all buffered messages on'));
      check('the marker cannot be in the buffer before it is logged', () =>
        expect(before.stdout).not.toContain(CONSOLE_MARKER));

      say('2/4 eval a console.log into the live page');
      const logged = troubleshoot(['eval', 'visreg:experiment', `console.log('${CONSOLE_MARKER}', 42)`]);
      check('eval of a console.log exits 0', () => expect(logged.status).toBe(0));
      check('console.log evaluates to undefined', () => expect(logged.stdout.trim()).toBe('undefined'));

      say('3/4 read the buffer again — it must now replay what the eval logged');
      const after = troubleshoot(['console', 'visreg:experiment']);
      check('console exits 0', () => expect(after.status).toBe(0));
      check(`the buffer replays "[console.log] ${CONSOLE_MARKER} 42"`, () =>
        expect(after.stdout).toContain(`[console.log] ${CONSOLE_MARKER} 42`));

      say('4/4 read a third time — `console` promises it never resets the buffer');
      const again = troubleshoot(['console', 'visreg:experiment']);
      check('a repeat read still carries the whole history', () =>
        expect(again.stdout).toContain(`[console.log] ${CONSOLE_MARKER} 42`));
    });

    // Every side, because an agent comparing control against experiment is the
    // whole point — and stdout must carry the value and nothing else, or the
    // output cannot be piped into anything.
    const productsBySide = new Map<Side, string[]>();
    await stage('eval the product list on every side — stdout must be the value alone', () => {
      for (const side of SIDES) {
        const res = troubleshoot(['eval', side, PRODUCT_LIST_EXPRESSION]);
        check(`eval on ${side} exits 0`, () => expect(res.status).toBe(0));
        check(`eval on ${side} prints nothing on stderr`, () => expect(res.stderr).toBe(''));

        const products = JSON.parse(res.stdout) as string[];
        say(`${side} returned ${products.length} product(s)`);
        check(`${side} returns the exact catalogue`, () => expect(products).toEqual(EXPECTED_PRODUCTS));
        // Exact equality, not a `toContain`: this is the "only the JS output and
        // nothing else" check — a banner, a yarn line or a stray log breaks it.
        check(`${side} prints the JSON value and NOTHING else on stdout`, () =>
          expect(res.stdout).toBe(`${JSON.stringify(products, null, 2)}\n`));
        productsBySide.set(side, products);
      }
      const [first, ...rest] = SIDES;
      for (const side of rest) {
        check(`${side} sees the same catalogue as ${first}`, () =>
          expect(productsBySide.get(side)).toEqual(productsBySide.get(first)));
      }
    });

    // Async eval: the expression resolves to a Promise (poll until the cards
    // render, then read), so `eval` returns a value only because it awaits it.
    // The settled page is a known catalogue, so pin the exact list.
    await stage('eval an ASYNC expression — it must be awaited, not returned pending', () => {
      say('expression polls in-page for up to 5s, then resolves the product list');
      const res = troubleshoot(['eval', 'perf:experiment', ASYNC_PRODUCT_LIST_EXPRESSION]);
      check('async eval exits 0', () => expect(res.status).toBe(0));
      check('async eval prints nothing on stderr', () => expect(res.stderr).toBe(''));
      check('async eval resolves the promise and prints the settled catalogue', () =>
        expect(JSON.parse(res.stdout)).toEqual(EXPECTED_PRODUCTS));
    });

    // A page exception must surface as a failure, on stderr, naming the thrown
    // error — silently printing "undefined" on stdout with exit 0 would let an
    // agent read a broken expression as a real answer.
    await stage('eval an expression that THROWS — the failure must be loud and on stderr', () => {
      const thrown = troubleshoot(['eval', 'visreg:control', THROWING_EXPRESSION]);
      check('a page exception exits non-zero', () => expect(thrown.status).not.toBe(0));
      check('nothing reaches stdout when the page threw', () => expect(thrown.stdout).toBe(''));
      check('the failure is attributed to the page', () => expect(thrown.stderr).toContain('page threw'));
      check('the failure names the thrown error', () =>
        expect(thrown.stderr).toContain(`${CONSOLE_MARKER}-boom`));

      say('and the session must survive it — the CDP connection is per-command');
      const after = troubleshoot(['eval', 'visreg:control', 'location.pathname']);
      check('the next eval on the same side still works', () => expect(after.status).toBe(0));
      check(`that side is still parked on ${EXPECTED_PATH}`, () =>
        expect(after.stdout.trim()).toBe(EXPECTED_PATH));
    });

    await stage('Screenshot every side over CDP and merge them into one artifact', async () => {
      say(`resetting ${SNAPSHOT_DIR}`);
      fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      const shots: Array<{ side: Side; file: string }> = [];
      for (const side of SIDES) {
        const file = path.join(RESULTS_DIR, `${side.replace(':', '-')}.png`);
        const res = troubleshoot(['shot', side, file]);
        check(`shot ${side} exits 0`, () => expect(res.status).toBe(0));
        check(`shot ${side} writes ${path.basename(file)}`, () => expect(fs.existsSync(file)).toBe(true));
        say(`${side} → ${pngSize(file)} px, ${fs.statSync(file).size} bytes`);
        check(`shot ${side} is not an empty frame`, () =>
          expect(fs.statSync(file).size).toBeGreaterThan(1000));
        shots.push({ side, file });
      }
      const merged = path.join(SNAPSHOT_DIR, ARTIFACT);
      say(`merging ${shots.length} shots into ${merged}`);
      await writeSideBySideArtifact(page, shots, merged);
      say(`artifact → ${pngSize(merged)} px, ${fs.statSync(merged).size} bytes`);
      check('the merged artifact is on disk for the screenshot-diff review', () =>
        expect(fs.existsSync(merged)).toBe(true));
    });
  } finally {
    await stage('Stop the session and reap the browsers it deliberately left open', async () => {
      // Identified BEFORE anything is signalled: once the CLI is gone its
      // browsers are orphans, and only the flag they were launched with still
      // names them.
      const endpoints = (session?.browsers ?? []).map((b) => b.endpoint);
      const ports = endpoints.map((endpoint) => Number(new URL(endpoint).port));
      const browserPids = ports.length > 0 ? browserPidsOn(ports) : [];
      // Endpoints, not pids: a pid list would diff on every run, and the
      // baseline log is read as a diff. Finding NONE is the reviewable event.
      say(browserPids.length > 0
        ? `1/3 found the browsers on ${endpoints.join(', ')}`
        : `1/3 no browser process on ${endpoints.join(', ')} — nothing to reap`);

      say(`2/3 SIGTERM the parked CLI (pid ${session?.pid ?? 'unknown'}) — the documented stop`);
      if (session?.pid) {
        try { process.kill(session.pid, 'SIGTERM'); } catch { /* already gone */ }
      }
      await delay(3000);

      // The CLI deliberately leaves the browsers running, so stopping it is
      // only half of teardown — a suite that skipped this half would leak three
      // Chromes per run.
      say('3/3 SIGKILL the orphaned browsers and the session process group');
      for (const pid of browserPids) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      if (child?.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      if (endpoints.length > 0) {
        await checkAsync('every CDP endpoint stops answering — the run leaks no browser', async () => {
          expect(await endpointsAreDown(endpoints)).toBe(true);
        });
      }
    });
  }
});
