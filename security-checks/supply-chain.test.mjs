/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import * as lockfileChecker from './check-lockfiles-consistency.mjs';

const {
  collectNpmProductionVersions,
  collectYarnProductionVersions,
  compareVersionMaps,
} = lockfileChecker;
import { evaluateInstallScriptsPolicy } from './check-install-scripts.mjs';
import syncNpmShrinkwrapPlugin from '../.yarn/plugins/sync-npm-shrinkwrap.cjs';

const versions = (entries) => new Map(
  Object.entries(entries).map(([name, values]) => [name, new Set(values)]),
);

const locator = (name, reference) => ({ name, reference });

const captureError = (operation) => {
  try {
    operation();
  } catch (error) {
    return error;
  }
  assert.fail('expected operation to throw');
};

test('exports source-aware lockfile diagnostic formatters', () => {
  assert.equal(typeof lockfileChecker.formatDependencyGraphError, 'function');
  assert.equal(typeof lockfileChecker.formatVersionDifferences, 'function');
});

const yarnGraph = ({ rootDependencies, packages }) => {
  const root = locator('shaka-perf', 'workspace:packages/shaka-perf');
  const records = new Map();
  const manifests = new Map();

  records.set(`${root.name}@${root.reference}`, {
    packageLocation: '/repo/packages/shaka-perf/',
    packageDependencies: new Map([
      ...Object.entries(rootDependencies),
      ['shaka-perf', root.reference],
    ]),
  });
  manifests.set('/repo/packages/shaka-perf/', {
    name: 'shaka-perf',
    version: '1.0.0',
    dependencies: Object.fromEntries(Object.keys(rootDependencies).map((name) => [name, '*'])),
    devDependencies: { 'test-only': '*' },
  });

  for (const pkg of packages) {
    const key = `${pkg.locator.name}@${pkg.locator.reference}`;
    records.set(key, {
      packageLocation: pkg.location,
      packageDependencies: new Map(pkg.dependencies ?? []),
    });
    manifests.set(pkg.location, pkg.manifest);
  }

  return collectYarnProductionVersions({
    rootLocator: root,
    getPackageInformation: (candidate) => records.get(`${candidate.name}@${candidate.reference}`),
    readManifest: (location) => manifests.get(location),
  });
};

test('compares version sets symmetrically', () => {
  assert.deepEqual(
    compareVersionMaps(
      versions({ both: ['1.0.0'], 'yarn-only': ['2.0.0'], multi: ['1.0.0', '2.0.0'] }),
      versions({ both: ['1.0.0'], 'npm-only': ['3.0.0'], multi: ['1.0.0', '3.0.0'] }),
    ),
    [
      { name: 'multi', yarn: ['1.0.0', '2.0.0'], npm: ['1.0.0', '3.0.0'] },
      { name: 'npm-only', yarn: [], npm: ['3.0.0'] },
      { name: 'yarn-only', yarn: ['2.0.0'], npm: [] },
    ],
  );
});

test('collects only the production closure of the target Yarn workspace', () => {
  const actual = yarnGraph({
    rootDependencies: {
      runtime: 'npm:1.0.0',
      shared: 'workspace:packages/shared',
    },
    packages: [
      {
        locator: locator('runtime', 'npm:1.0.0'),
        location: '/cache/runtime/',
        manifest: { name: 'runtime', version: '1.0.0' },
        dependencies: [['transitive', 'npm:2.0.0']],
      },
      {
        locator: locator('transitive', 'npm:2.0.0'),
        location: '/cache/transitive/',
        manifest: { name: 'transitive', version: '2.0.0' },
      },
      {
        locator: locator('shared', 'workspace:packages/shared'),
        location: '/repo/packages/shared/',
        manifest: {
          name: 'shared',
          version: '3.0.0',
          dependencies: { 'shared-runtime': '*' },
          devDependencies: { 'shared-dev-only': '*' },
        },
        dependencies: [
          ['shared-runtime', 'npm:4.0.0'],
          ['shared-dev-only', 'npm:5.0.0'],
        ],
      },
      {
        locator: locator('shared-runtime', 'npm:4.0.0'),
        location: '/cache/shared-runtime/',
        manifest: { name: 'shared-runtime', version: '4.0.0' },
      },
      {
        locator: locator('shared-dev-only', 'npm:5.0.0'),
        location: '/cache/shared-dev-only/',
        manifest: { name: 'shared-dev-only', version: '5.0.0' },
      },
    ],
  });

  assert.deepEqual(actual, versions({
    runtime: ['1.0.0'],
    shared: ['3.0.0'],
    'shared-runtime': ['4.0.0'],
    transitive: ['2.0.0'],
  }));
});

test('uses the real package identity for a Yarn alias target', () => {
  const actual = yarnGraph({
    rootDependencies: { alias: ['real-package', 'npm:6.0.0'] },
    packages: [{
      locator: locator('real-package', 'npm:6.0.0'),
      location: '/cache/real-package/',
      manifest: { name: 'real-package', version: '6.0.0' },
    }],
  });

  assert.deepEqual(actual, versions({ 'real-package': ['6.0.0'] }));
});

test('uses the Yarn locator when a platform-specific package is not materialized', () => {
  const actual = yarnGraph({
    rootDependencies: { fsevents: 'patch:fsevents@npm%3A2.3.3#optional!builtin::version=2.3.3&hash=abc' },
    packages: [{
      locator: locator(
        'fsevents',
        'patch:fsevents@npm%3A2.3.3#optional!builtin::version=2.3.3&hash=abc',
      ),
      location: '/missing/fsevents/',
      manifest: undefined,
    }],
  });

  assert.deepEqual(actual, versions({ fsevents: ['2.3.3'] }));
});

test('collects nested, hoisted, optional, peer, and aliased npm packages', () => {
  const actual = collectNpmProductionVersions({
    packages: {
      '': { dependencies: { a: '*', alias: 'npm:real-package@*' } },
      'node_modules/a': {
        version: '1.0.0',
        dependencies: { nested: '*' },
        optionalDependencies: { optional: '*' },
        peerDependencies: { peer: '*' },
      },
      'node_modules/a/node_modules/nested': { version: '2.0.0' },
      'node_modules/alias': { name: 'real-package', version: '3.0.0' },
      'node_modules/optional': { version: '4.0.0', optional: true },
      'node_modules/peer': { version: '5.0.0', peer: true },
    },
  });

  assert.deepEqual(actual, versions({
    a: ['1.0.0'],
    nested: ['2.0.0'],
    optional: ['4.0.0'],
    peer: ['5.0.0'],
    'real-package': ['3.0.0'],
  }));
});

test('allows absent optional npm dependencies but rejects broken required edges', () => {
  assert.deepEqual(
    collectNpmProductionVersions({
      packages: {
        '': { dependencies: { a: '*' } },
        'node_modules/a': { version: '1.0.0', optionalDependencies: { unavailable: '*' } },
      },
    }),
    versions({ a: ['1.0.0'] }),
  );

  assert.throws(
    () => collectNpmProductionVersions({
      packages: {
        '': { dependencies: { missing: '*' } },
      },
    }),
    /cannot resolve required dependency missing from the root package/,
  );
});

test('rejects unreachable non-development entries in the npm shrinkwrap', () => {
  assert.throws(
    () => collectNpmProductionVersions({
      packages: {
        '': {},
        'node_modules/unreachable': { version: '9.0.0' },
        'node_modules/dev-only': { version: '10.0.0', dev: true },
      },
    }),
    /unreachable production package.*node_modules\/unreachable/,
  );
});

test('explains a missing required npm dependency on both lockfile sides', () => {
  const lock = {
    packages: {
      '': { dependencies: { parent: '2.0.0' } },
      'node_modules/parent': {
        version: '2.0.0',
        dependencies: { child: '^1.0.0' },
      },
    },
  };
  const error = captureError(() => collectNpmProductionVersions(lock));

  assert.equal(
    lockfileChecker.formatDependencyGraphError(error, {
      yarnVersions: versions({ child: ['1.2.3'] }),
      npmLock: lock,
    }),
    `npm-shrinkwrap.json has an incomplete dependency edge

Required package: child@^1.0.0
Required by:      parent@2.0.0
Parent location:  node_modules/parent

Yarn:             present as child@1.2.3
npm shrinkwrap:   missing`,
  );
});

test('reports an npm package that exists elsewhere but cannot resolve from its parent', () => {
  const lock = {
    packages: {
      '': { dependencies: { parent: '2.0.0', other: '3.0.0' } },
      'node_modules/parent': {
        version: '2.0.0',
        dependencies: { child: '^1.0.0' },
      },
      'node_modules/other': { version: '3.0.0' },
      'node_modules/other/node_modules/child': { version: '1.2.3' },
    },
  };
  const error = captureError(() => collectNpmProductionVersions(lock));
  const message = lockfileChecker.formatDependencyGraphError(error, {
    yarnVersions: versions({ child: ['1.2.3'] }),
    npmLock: lock,
  });

  assert.match(
    message,
    /npm shrinkwrap:\s+present as child@1\.2\.3 at node_modules\/other\/node_modules\/child, but not resolvable from node_modules\/parent/,
  );
});

test('explains unreachable npm production entries with identity and location', () => {
  const lock = {
    packages: {
      '': {},
      'node_modules/unreachable': { version: '9.0.0' },
    },
  };
  const error = captureError(() => collectNpmProductionVersions(lock));
  const message = lockfileChecker.formatDependencyGraphError(error, {
    yarnVersions: versions({}),
    npmLock: lock,
  });

  assert.match(message, /Package:\s+unreachable@9\.0\.0/);
  assert.match(message, /Location:\s+node_modules\/unreachable/);
  assert.match(message, /Yarn:\s+missing/);
  assert.match(
    message,
    /npm shrinkwrap:\s+present as unreachable@9\.0\.0 at node_modules\/unreachable, but unreachable from shaka-perf/,
  );
});

test('explains when a Yarn dependency-map locator lacks PnP package information', () => {
  const root = locator('shaka-perf', 'workspace:packages/shaka-perf');
  const error = captureError(() => collectYarnProductionVersions({
    rootLocator: root,
    getPackageInformation: (candidate) => candidate === root ? {
      packageLocation: '/repo/packages/shaka-perf/',
      packageDependencies: new Map([['child', 'npm:1.2.3']]),
    } : undefined,
    readManifest: () => ({
      name: 'shaka-perf',
      version: '1.0.0',
      dependencies: { child: '^1.0.0' },
    }),
  }));
  const message = lockfileChecker.formatDependencyGraphError(error, {
    yarnVersions: versions({}),
    npmLock: {
      packages: {
        '': { dependencies: { child: '^1.0.0' } },
        'node_modules/child': { version: '1.2.3' },
      },
    },
  });

  assert.match(
    message,
    /Yarn:\s+present as locator child@npm:1\.2\.3 in the dependency map, but missing PnP package information/,
  );
  assert.match(
    message,
    /npm shrinkwrap:\s+present as child@1\.2\.3 at node_modules\/child/,
  );
});

test('formats ordinary version differences with explicit source states', () => {
  const message = lockfileChecker.formatVersionDifferences([
    { name: 'different', yarn: ['1.0.0'], npm: ['2.0.0'] },
    { name: 'npm-only', yarn: [], npm: ['3.0.0'] },
    { name: 'yarn-only', yarn: ['4.0.0'], npm: [] },
  ]);

  assert.match(message, /different\n\s+Yarn:\s+present as different@1\.0\.0\n\s+npm shrinkwrap:\s+present as different@2\.0\.0/);
  assert.match(message, /npm-only\n\s+Yarn:\s+missing\n\s+npm shrinkwrap:\s+present as npm-only@3\.0\.0/);
  assert.match(message, /yarn-only\n\s+Yarn:\s+present as yarn-only@4\.0\.0\n\s+npm shrinkwrap:\s+missing/);
  assert.doesNotMatch(message, /\(absent\)/);
});

const lockWith = (...packages) => ({
  packages: Object.fromEntries([
    ['', {}],
    ...packages.map(({ path: packagePath, ...entry }) => [`node_modules/${packagePath}`, entry]),
  ]),
});

const allowed = (...entries) => ({
  allowed: entries.map((entry) => typeof entry === 'string'
    ? { package: entry, reason: 'Reviewed for this test.' }
    : entry),
});

test('accepts an exact reviewed install-script set', () => {
  const result = evaluateInstallScriptsPolicy({
    lock: lockWith({ path: 'native', version: '1.2.3', hasInstallScript: true }),
    allowlist: allowed('native@1.2.3'),
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.found, ['native@1.2.3']);
});

test('does not govern repository-local Yarn or workspace hooks', () => {
  const result = evaluateInstallScriptsPolicy({
    lock: lockWith(),
    allowlist: allowed(),
    yarnConfigText: 'enableScripts: true\n',
    manifests: [{
      path: 'package.json',
      manifest: { scripts: { postinstall: 'run-unreviewed-code' } },
    }],
  });

  assert.deepEqual(result.errors, []);
});

test('rejects both unreviewed hooks and stale allowlist entries', () => {
  const result = evaluateInstallScriptsPolicy({
    lock: lockWith({ path: 'new-hook', version: '2.0.0', hasInstallScript: true }),
    allowlist: allowed('old-hook@1.0.0'),
  });

  assert.match(result.errors.join('\n'), /unreviewed install hook: new-hook@2.0.0/);
  assert.match(result.errors.join('\n'), /stale allowlist entry: old-hook@1.0.0/);
});

test('uses a package entry real name for npm aliases with install scripts', () => {
  const result = evaluateInstallScriptsPolicy({
    lock: lockWith({
      path: 'native-alias',
      name: 'native',
      version: '1.2.3',
      hasInstallScript: true,
    }),
    allowlist: allowed('native@1.2.3'),
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.found, ['native@1.2.3']);
});

test('rejects broad, duplicate, and unexplained allowlist entries', () => {
  const result = evaluateInstallScriptsPolicy({
    lock: lockWith({ path: 'native', version: '1.2.3', hasInstallScript: true }),
    allowlist: {
      allowed: [
        { package: 'native@^1.2.3', reason: 'Broad.' },
        { package: 'native@1.2.3', reason: '' },
        { package: 'native@1.2.3', reason: 'Duplicate.' },
      ],
    },
  });

  assert.match(result.errors.join('\n'), /not an exact name@version/);
  assert.match(result.errors.join('\n'), /must have a review reason/);
  assert.match(result.errors.join('\n'), /duplicate allowlist entry/);
});

test('syncs the npm shrinkwrap only outside CI', () => {
  assert.equal(syncNpmShrinkwrapPlugin.shouldSyncNpmShrinkwrap({}), true);
  assert.equal(syncNpmShrinkwrapPlugin.shouldSyncNpmShrinkwrap({ CI: 'true' }), false);
  assert.equal(syncNpmShrinkwrapPlugin.shouldSyncNpmShrinkwrap({ CI: '1' }), false);
  assert.equal(syncNpmShrinkwrapPlugin.shouldSyncNpmShrinkwrap({ CI: 'false' }), true);
});

test('requires an npm version that preserves platform-specific optional dependencies', () => {
  const supported = syncNpmShrinkwrapPlugin.supportsNpmVersion;

  assert.deepEqual(
    ['10.9.2', '11.2.0', '11.6.2', '11.6.3', '11.8.0', '12.0.0', 'not-a-version']
      .map((version) => supported?.(version)),
    [false, false, false, true, true, true, false],
  );
});
