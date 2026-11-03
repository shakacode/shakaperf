/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Standalone real-Chromium check: yarn build && yarn node integration-tests/check-visreg-retries.cjs
// Uses only a disposable fixture and localhost server; no demo app or Docker is needed.
// Red/blue followed by green/red can pass ONLY by retaining a frame across attempts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '..');
const originalCwd = process.cwd();
const { createCompareCommand } = require(path.join(repo, 'packages/shaka-perf/dist/compare/cli/program.js'));
const { loadTests } = require(path.join(repo, 'packages/shaka-perf/dist/config-loader/index.js'));
const { ArtifactStore } = require(path.join(repo, 'packages/shaka-perf/dist/pipeline/artifact-store.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visreg-viewport-probe-'));
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body style="margin:0;min-height:100vh"></body></html>'); });
function snapshot(dir) {
  return fs.readdirSync(dir, { recursive: true }).filter(n => fs.statSync(path.join(dir,n)).isFile()).sort().map(n => [n, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex'), fs.statSync(path.join(dir,n)).mtimeMs]);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(path.join(root, 'node_modules'));
  for (const pkg of ['shaka-shared', 'shaka-perf']) fs.symlinkSync(path.join(repo, 'packages', pkg), path.join(root, 'node_modules', pkg));
  fs.writeFileSync(path.join(root, 'abtests.config.js'), `module.exports = {
    shared: { controlURL: '${base}/control', experimentURL: '${base}/experiment', parallelism: 2,
      viewportDefinitions: [{label:'phone',width:40,height:60,formFactor:'mobile',deviceScaleFactor:1},{label:'desktop',width:80,height:60,formFactor:'desktop',deviceScaleFactor:1}], viewports: ['phone','desktop'], timeoutMs: 30000, retries: 1, retryDelay: 0,
      playwrightOptions: { browser: 'chromium', waitTimeout: 5000 }, browserConsole: { failOn: ['error','warn'], allowList: [] },
      beforeNavigate: async ({context,url,viewport,isControl}) => {
        globalThis.__visregProbe.hooks.push(viewport.label + ':' + isControl);
        await context.addCookies([{name:'seed',value:'yes',url}]);
      }
    }, visreg: { compareRetries: 2, compareRetryDelay: 0, maxNumDiffPixels: 0 }
  };`);
  fs.writeFileSync(path.join(root, 'probe.abtest.js'), `const {abTest} = require('shaka-shared');
  abTest('Viewport retry probe', { startingPath: '/', visregSelectors: ['document'] }, async ({page,isControl,viewport}) => {
    const state = globalThis.__visregProbe;
    const key = viewport.label + ':' + isControl;
    const n = state.counts[key] = (state.counts[key] || 0) + 1;
    const browserState = await page.evaluate(() => ({cookie:document.cookie,dirty:localStorage.getItem('dirty')}));
    require('node:assert/strict').equal(browserState.dirty, null);
    require('node:assert/strict').match(browserState.cookie, /seed=yes/);
    if(state.mode === 'worker' && isControl && n === 2) throw new Error('engineered recoverable failure');
    const color = state.mode === 'late-cross' ? (n <= 2 ? (isControl ? '#ff0000' : '#0000ff') : (isControl ? '#00ff00' : '#ff0000'))
      : state.mode === 'mismatch' ? (isControl ? '#00ffff' : '#ff00ff')
      : isControl ? (n === 1 ? '#ff0000' : '#00ff00') : (n === 1 ? '#0000ff' : '#ff0000');
    await page.evaluate(color => { document.body.style.background = color; localStorage.setItem('dirty','yes'); document.cookie='mutated=yes'; }, color);
  });`);
  // A saved sibling test and obsolete flat scratch folders must be untouched by a filtered run.
  fs.appendFileSync(path.join(root, 'probe.abtest.js'), `
    abTest('Unselected sibling', { startingPath: '/', config: { shared: { viewports: ['desktop'], beforeNavigate: async () => {} } } }, async ({page}) => {
      await page.evaluate(() => { document.body.style.background = '#ffffff'; });
    });`);
  process.chdir(root);
  const tests = await loadTests();
  const test = tests.find(test => test.name === 'Viewport retry probe');
  const sibling = tests.find(test => test.name === 'Unselected sibling');
  assert.ok(test && sibling);
  const store = new ArtifactStore(path.join(root, 'compare-results'));
  const savedExit = process.exitCode;
  let caseNumber = 0;
  async function run(mode, args = [], expectedExit = 0) {
    globalThis.__visregProbe = {mode, counts:{}, hooks:[]};
    process.exitCode = 0;
    const renderReport = args.includes('--report-only') || args.includes('--render-report');
    const cliArgs = args.filter(arg => arg !== '--render-report');
    // Exercise both category and exact-stage selection without combining conflicting flags.
    const selection = cliArgs.includes('--stages') ? [] : ['--categories', 'visreg'];
    await createCompareCommand().exitOverride().parseAsync([
      '--config', path.join(root, 'abtests.config.js'), ...selection,
      ...(renderReport ? [] : ['--skip-report']), ...cliArgs,
    ], {from: 'user'});
    assert.equal(process.exitCode, expectedExit, 'unexpected CLI result: ' + cliArgs.join(' '));
    const state = globalThis.__visregProbe;
    // A failing sibling can close a side after its hook but before its test body.
    for (const [key,n] of Object.entries(state.counts)) assert.ok(state.hooks.filter(h => h === key).length >= n, 'pre-navigation hook on every attempt');
    console.log('CASE PASS ' + (++caseNumber) + ': ' + mode + ' ' + cliArgs.join(' '));
    return {exit: process.exitCode, state};
  }
  let result = await run('cross');
  assert.equal(result.exit, 0);
  for (const label of ['phone','desktop']) {
    const outcome = store.readOutcome(test,label,'visreg');
    assert.equal(outcome.kind,'ok');
    assert.equal(outcome.runMetadata.compareAttempts,2);
    assert.equal(outcome.measurement[0].savedByRetries,true);
    assert.equal(outcome.measurement[0].diffPixels,0);
  }
  await run('late-cross', ['--filter', '^Viewport retry probe$', '--viewport', 'phone']);
  assert.equal(store.readOutcome(test, 'phone', 'visreg').runMetadata.compareAttempts, 3);
  assert.equal(store.readOutcome(test, 'phone', 'visreg').measurement[0].savedByRetries, true);
  const siblingBefore = snapshot(store.unitDirForViewport(sibling, 'desktop'));
  for (const dir of ['control_screenshots', 'experiment_screenshots']) {
    fs.mkdirSync(path.join(store.resultsRoot, dir));
    fs.writeFileSync(path.join(store.resultsRoot, dir, 'sentinel.png'), 'legacy scratch folder');
  }
  const onlyTest = ['--filter', '^Viewport retry probe$'];
  const desktopBefore = snapshot(store.unitDirForViewport(test, 'desktop'));
  result = await run('mismatch', [...onlyTest, '--viewport', 'phone', '--keep-old-results'], 1);
  assert.deepEqual(snapshot(store.unitDirForViewport(test, 'desktop')), desktopBefore);
  assert.deepEqual(snapshot(store.unitDirForViewport(sibling, 'desktop')), siblingBefore);
  // Reverse the viewport order and keep unrelated artifacts in the measured unit.
  const unrelated = path.join(store.artifactsDirForViewport(test, 'desktop'), 'perf-sentinel.json');
  fs.writeFileSync(unrelated, 'retained category artifact');
  result = await run('mismatch', [...onlyTest, '--keep-old-results', '--viewport', 'desktop', '--stages', 'visreg'], 1);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'retained category artifact');
  await run('cross', [...onlyTest]);
  result = await run('mismatch', [...onlyTest, '--viewport', 'phone', '--restart-from-stage', 'visreg'], 1);
  const desktopAfterReset = snapshot(store.unitDirForViewport(test, 'desktop'));
  result = await run('mismatch', [...onlyTest, '--viewport', 'phone'], 1);
  assert.equal(result.exit,1,'new run must not reuse old matching frames');
  assert.deepEqual(snapshot(store.unitDirForViewport(test,'desktop')), desktopAfterReset, 'sibling viewport must stay byte-for-byte identical');
  let outcome = store.readOutcome(test,'phone','visreg');
  assert.equal(outcome.runMetadata.compareAttempts,3);
  assert.ok(outcome.measurement[0].diffPixels > 0);
  result = await run('worker', [...onlyTest, '--viewport', 'phone', '--keep-old-results']);
  assert.equal(result.exit,0);
  outcome = store.readOutcome(test,'phone','visreg');
  assert.equal(outcome.kind,'ok');
  assert.equal(outcome.runMetadata.taskRetries,1);
  assert.equal(outcome.runMetadata.compareAttempts,3);
  assert.equal(outcome.measurement[0].savedByRetries,true);
  assert.deepEqual(snapshot(store.unitDirForViewport(test,'desktop')), desktopAfterReset);
  // Exercise worker recovery on the restart path, in the other viewport.
  result = await run('worker', [...onlyTest, '--restart-from-stage', 'visreg', '--viewport', 'desktop']);
  outcome = store.readOutcome(test, 'desktop', 'visreg');
  assert.equal(outcome.runMetadata.taskRetries, 1);
  assert.equal(outcome.runMetadata.compareAttempts, 3);
  assert.equal(outcome.measurement[0].savedByRetries, true);
  // Regenerating reports must leave every persisted unit and screenshot unchanged.
  const unitsBeforeReport = tests.flatMap(test => ['phone', 'desktop'].flatMap(label => {
    const dir = store.unitDirForViewport(test, label);
    return fs.existsSync(dir) ? [{dir, files: snapshot(dir)}] : [];
  }));
  await run('cross', ['--report-only', '--viewport', 'phone']);
  assert.deepEqual(globalThis.__visregProbe.counts, {});
  assert.deepEqual(globalThis.__visregProbe.hooks, []);
  for (const {dir, files} of unitsBeforeReport) assert.deepEqual(snapshot(dir), files);
  // Also exercise measurement with report rendering enabled, and option order reversed.
  await run('mismatch', [...onlyTest, '--keep-old-results', '--stages', 'visreg', '--viewport', 'phone', '--render-report'], 1);
  result = await run('mismatch', [], 1);
  assert.equal(result.exit,1);
  for (const label of ['phone','desktop']) assert.ok(store.readOutcome(test,label,'visreg').measurement[0].diffPixels > 0);
  result = await run('mismatch', [...onlyTest, '--viewport', 'phone', '--burn', '2', '--keep-old-results'], 1);
  assert.equal(result.exit,1);
  for (let burnIndex = 1; burnIndex <= 2; burnIndex++) {
    const burned = store.readOutcome({...test,burnIndex},'phone','visreg');
    assert.equal(burned.runMetadata.compareRetries,0);
    assert.equal(burned.runMetadata.compareAttempts,1);
    assert.equal(burned.runMetadata.taskRetries,0);
  }
  for (const dir of ['control_screenshots', 'experiment_screenshots']) {
    assert.equal(fs.readFileSync(path.join(store.resultsRoot, dir, 'sentinel.png'), 'utf8'), 'legacy scratch folder');
  }
  process.exitCode = savedExit;
  console.log('PROBE PASS: ' + caseNumber + ' actual CLI/Chromium cases; isolated new measurements, retained visual/worker retry frames, preserved siblings, report-only, legacy scratch folders and burn isolation');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  process.chdir(originalCwd);
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, {recursive:true,force:true});
});
