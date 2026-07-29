/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Scores accessibility with vanilla Lighthouse in its own process. The audit's
// perf LH run is patched (visual-settle early-stop) and snapshots the a11y DOM
// before styling settles, inflating style-dependent audits; this clean child
// avoids that. Reads A11Y_URL/A11Y_VIEWPORT (env), prints {"score":N|null} to stdout.
import lighthouse from 'lighthouse';
import * as ChromeLauncher from 'chrome-launcher';

async function main() {
  const url = process.env.A11Y_URL;
  if (!url) throw new Error('A11Y_URL not set');
  const vp = JSON.parse(process.env.A11Y_VIEWPORT || '{}');

  const chrome = await ChromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  // Kill Chrome on SIGTERM (the parent's timeout signal) too - finally doesn't run on a bare signal.
  const killChrome = () => {
    try {
      chrome.kill();
    } catch {
      // already gone
    }
  };
  process.once('SIGTERM', () => {
    killChrome();
    process.exit(1);
  });
  process.once('SIGINT', () => {
    killChrome();
    process.exit(130);
  });
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      logLevel: 'silent',
      output: 'json',
      onlyCategories: ['accessibility'],
      formFactor: vp.formFactor === 'mobile' ? 'mobile' : 'desktop',
      screenEmulation: {
        mobile: vp.formFactor === 'mobile',
        width: vp.width ?? 412,
        height: vp.height ?? 823,
        deviceScaleFactor: vp.deviceScaleFactor ?? 1,
        disabled: false,
      },
      // Accessibility is DOM-based; do not throttle. A standard navigation that
      // waits for full load gives the score a client sees.
      throttlingMethod: 'provided',
    });
    const raw = result?.lhr?.categories?.accessibility?.score;
    const score = typeof raw === 'number' ? Math.round(raw * 100) : null;
    process.stdout.write(JSON.stringify({ score }));
  } finally {
    const killed = chrome.kill();
    if (killed && typeof killed.then === 'function') await killed;
  }
}

main().catch((err) => {
  process.stderr.write(`accessibility-score-runner failed: ${err && err.message ? err.message : err}\n`);
  process.exit(1);
});
