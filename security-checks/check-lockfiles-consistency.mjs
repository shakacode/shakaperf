#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Asserts that the production dependency closure Yarn installs for the
// shaka-perf workspace exactly matches what npm installs for consumers from the
// committed shrinkwrap. This is deliberately offline: Yarn's PnP map provides
// the concrete Yarn locators, and the shrinkwrap provides the npm graph.
//
// Run this through `yarn node` so the pnpapi module and zip-backed package
// manifests are available.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const addVersion = (versions, name, version) => {
  if (!versions.has(name)) versions.set(name, new Set());
  versions.get(name).add(version);
};

const locatorKey = ({ name, reference }) => `${name}@${reference}`;

class DependencyGraphError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DependencyGraphError';
    this.code = code;
    this.details = details;
  }
}

const dependencyLocator = (dependencyName, target) => {
  if (target === null || target === undefined) return null;
  if (Array.isArray(target)) return { name: target[0], reference: target[1] };
  return { name: dependencyName, reference: target };
};

const isWorkspaceLocator = ({ reference }) => /(?:^|#)workspace:/.test(reference);

const versionFromLocator = ({ name, reference }, yarnVersions) => {
  const decoded = decodeURIComponent(reference);
  const metadataAt = decoded.lastIndexOf('::');
  if (metadataAt !== -1) {
    const version = new URLSearchParams(decoded.slice(metadataAt + 2)).get('version');
    if (version) return version;
  }

  const npmReference = decoded.match(/(?:^|[#@])npm:([^#?&:]+)/)?.[1];
  if (npmReference) return npmReference;
  throw new DependencyGraphError(
    'yarn-version-unknown',
    `cannot determine a version for Yarn locator ${name}@${reference}`,
    { locator: { name, reference }, yarnVersions },
  );
};

export const collectYarnProductionVersions = ({
  rootLocator,
  getPackageInformation,
  readManifest,
}) => {
  const versions = new Map();
  const visited = new Set();

  const visit = (locator, includePackage, requiredBy = null) => {
    const key = locatorKey(locator);
    if (visited.has(key)) return;
    visited.add(key);

    const information = getPackageInformation(locator);
    if (!information) {
      throw new DependencyGraphError(
        'yarn-package-info-missing',
        `Yarn PnP has no package information for ${key}`,
        { locator, requiredBy, yarnVersions: versions },
      );
    }

    let manifest;
    try {
      manifest = readManifest(information.packageLocation);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    if (isWorkspaceLocator(locator) && (!manifest?.name || !manifest?.version)) {
      throw new DependencyGraphError(
        'yarn-workspace-identity-missing',
        `Yarn workspace at ${information.packageLocation} has no name or version`,
        {
          locator,
          packageLocation: information.packageLocation,
          manifest,
          yarnVersions: versions,
        },
      );
    }
    if (includePackage) {
      addVersion(
        versions,
        manifest?.name ?? locator.name,
        manifest?.version ?? versionFromLocator(locator, versions),
      );
    }

    const dependencyNames = isWorkspaceLocator(locator)
      ? new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ])
      : information.packageDependencies.keys();

    for (const dependencyName of dependencyNames) {
      const target = information.packageDependencies.get(dependencyName);
      const child = dependencyLocator(dependencyName, target);
      if (child) visit(child, true, locator);
    }
  };

  visit(rootLocator, false);
  return versions;
};

const packageNameFromPath = (packagePath) => {
  const marker = 'node_modules/';
  return packagePath.slice(packagePath.lastIndexOf(marker) + marker.length);
};

const resolveNpmDependency = (packages, fromPath, dependencyName) => {
  let searchPath = fromPath;
  while (true) {
    const candidate = searchPath
      ? `${searchPath}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!searchPath) return null;

    const parentMarker = searchPath.lastIndexOf('/node_modules/');
    searchPath = parentMarker === -1 ? '' : searchPath.slice(0, parentMarker);
  }
};

const npmDependencyEdges = (entry) => {
  const edges = new Map();
  for (const [name, range] of Object.entries(entry.dependencies ?? {})) {
    edges.set(name, { range, optional: false });
  }
  for (const [name, range] of Object.entries(entry.optionalDependencies ?? {})) {
    edges.set(name, { range, optional: true });
  }
  for (const [name, range] of Object.entries(entry.peerDependencies ?? {})) {
    const optional = entry.peerDependenciesMeta?.[name]?.optional === true;
    if (!edges.has(name)) edges.set(name, { range, optional });
  }
  return edges;
};

const npmPackageIdentity = (entry, packagePath) => ({
  name: entry?.name ?? (packagePath ? packageNameFromPath(packagePath) : 'root package'),
  version: entry?.version,
});

export const collectNpmProductionVersions = (lock) => {
  const packages = lock?.packages;
  if (!packages?.['']) {
    throw new DependencyGraphError(
      'npm-root-missing',
      'npm shrinkwrap has no root package entry',
    );
  }

  const versions = new Map();
  const visited = new Set();

  const visit = (packagePath) => {
    if (visited.has(packagePath)) return;
    visited.add(packagePath);

    const entry = packages[packagePath];
    if (!entry) {
      throw new DependencyGraphError(
        'npm-entry-missing',
        `npm shrinkwrap has no entry for ${packagePath || 'the root package'}`,
        { packagePath },
      );
    }

    if (packagePath) {
      const identity = npmPackageIdentity(entry, packagePath);
      if (!entry.version) {
        throw new DependencyGraphError(
          'npm-version-missing',
          `npm package ${packagePath} has no version`,
          { ...identity, packagePath },
        );
      }
      if (entry.dev) {
        throw new DependencyGraphError(
          'npm-dev-only',
          `production dependency resolves to dev-only entry ${packagePath}`,
          { ...identity, packagePath },
        );
      }
      addVersion(versions, identity.name, entry.version);
    }

    for (const [dependencyName, edge] of npmDependencyEdges(entry)) {
      const dependencyPath = resolveNpmDependency(packages, packagePath, dependencyName);
      if (!dependencyPath) {
        if (edge.optional) continue;
        const parent = npmPackageIdentity(entry, packagePath);
        throw new DependencyGraphError(
          'npm-required-dependency-missing',
          `cannot resolve required dependency ${dependencyName} from ${packagePath || 'the root package'}`,
          {
            dependencyName,
            dependencyRange: edge.range,
            parentName: parent.name,
            parentVersion: parent.version,
            parentPath: packagePath,
          },
        );
      }
      visit(dependencyPath);
    }
  };

  visit('');

  const unreachable = Object.entries(packages)
    .filter(([packagePath, entry]) => packagePath && entry?.version && !entry.dev && !visited.has(packagePath))
    .map(([packagePath]) => packagePath)
    .sort();
  if (unreachable.length) {
    throw new DependencyGraphError(
      'npm-unreachable',
      `unreachable production package entr${unreachable.length === 1 ? 'y' : 'ies'}: ${unreachable.join(', ')}`,
      {
        packages: unreachable.map((packagePath) => ({
          ...npmPackageIdentity(packages[packagePath], packagePath),
          packagePath,
        })),
      },
    );
  }

  return versions;
};

export const compareVersionMaps = (yarnVersions, npmVersions) => {
  const names = new Set([...yarnVersions.keys(), ...npmVersions.keys()]);
  const rows = [];

  for (const name of names) {
    const yarn = [...(yarnVersions.get(name) ?? [])].sort();
    const npm = [...(npmVersions.get(name) ?? [])].sort();
    if (yarn.length === npm.length && yarn.every((version, index) => version === npm[index])) continue;
    rows.push({ name, yarn, npm });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
};

export const countVersions = (versions) => [...versions.values()]
  .reduce((count, packageVersions) => count + packageVersions.size, 0);

const formatIdentity = (name, version) => version ? `${name}@${version}` : name;

const formatVersionPresence = (name, versionMap) => {
  const packageVersions = [...(versionMap?.get(name) ?? [])].sort();
  if (!packageVersions.length) return 'missing';
  return `present as ${packageVersions.map((version) => `${name}@${version}`).join(', ')}`;
};

const npmOccurrences = (lock, name) => Object.entries(lock?.packages ?? {})
  .filter(([packagePath, entry]) => packagePath && npmPackageIdentity(entry, packagePath).name === name)
  .map(([packagePath, entry]) => ({ packagePath, version: entry?.version }))
  .sort((a, b) => a.packagePath.localeCompare(b.packagePath));

const formatNpmOccurrence = (name, { packagePath, version }) => version
  ? `present as ${name}@${version} at ${packagePath}`
  : `present at ${packagePath}, but missing a version`;

const formatNpmPresence = (name, lock) => {
  const occurrences = npmOccurrences(lock, name);
  if (!occurrences.length) return 'missing';
  return occurrences.map((occurrence) => formatNpmOccurrence(name, occurrence)).join('; ');
};

export const formatDependencyGraphError = (error, {
  yarnVersions = new Map(),
  npmLock,
} = {}) => {
  if (!(error instanceof DependencyGraphError)) return error?.message ?? String(error);

  const details = error.details;
  const knownYarnVersions = details.yarnVersions ?? yarnVersions;

  if (error.code === 'npm-required-dependency-missing') {
    const requiredPackage = details.dependencyRange
      ? `${details.dependencyName}@${details.dependencyRange}`
      : details.dependencyName;
    const parent = formatIdentity(details.parentName, details.parentVersion);
    const parentLocation = details.parentPath || '(root package entry)';
    const npmPresence = formatNpmPresence(details.dependencyName, npmLock);
    const npmState = npmPresence === 'missing'
      ? npmPresence
      : `${npmPresence}, but not resolvable from ${parentLocation}`;
    return `npm-shrinkwrap.json has an incomplete dependency edge

Required package: ${requiredPackage}
Required by:      ${parent}
Parent location:  ${parentLocation}

Yarn:             ${formatVersionPresence(details.dependencyName, knownYarnVersions)}
npm shrinkwrap:   ${npmState}`;
  }

  if (error.code === 'npm-unreachable') {
    const blocks = details.packages.map((pkg) => `Package:         ${formatIdentity(pkg.name, pkg.version)}
Location:        ${pkg.packagePath}
Yarn:            ${formatVersionPresence(pkg.name, knownYarnVersions)}
npm shrinkwrap:  ${formatNpmOccurrence(pkg.name, pkg)}, but unreachable from shaka-perf`);
    return `npm-shrinkwrap.json has production package entries outside the shaka-perf dependency closure

${blocks.join('\n\n')}`;
  }

  if (error.code === 'yarn-package-info-missing') {
    const key = locatorKey(details.locator);
    return `Yarn has an incomplete PnP package record

Package locator: ${key}

Yarn:            present as locator ${key} in the dependency map, but missing PnP package information
npm shrinkwrap:  ${formatNpmPresence(details.locator.name, npmLock)}`;
  }

  if (error.code === 'yarn-version-unknown') {
    const key = locatorKey(details.locator);
    return `Yarn has a package locator without a concrete version

Package locator: ${key}

Yarn:            present as locator ${key}, but its version cannot be determined
npm shrinkwrap:  ${formatNpmPresence(details.locator.name, npmLock)}`;
  }

  if (error.code === 'yarn-workspace-identity-missing') {
    const key = locatorKey(details.locator);
    const missingFields = [
      !details.manifest?.name && 'name',
      !details.manifest?.version && 'version',
    ].filter(Boolean).join(' and ');
    return `Yarn workspace manifest is missing package identity

Workspace locator:  ${key}
Workspace location: ${details.packageLocation}
Missing field(s):   ${missingFields}

Yarn:               present as workspace locator ${key}, but missing ${missingFields}
npm shrinkwrap:     ${details.manifest?.name
    ? formatNpmPresence(details.manifest.name, npmLock)
    : 'cannot look up a package without its name'}`;
  }

  if (error.code === 'npm-version-missing') {
    return `npm-shrinkwrap.json has a package entry without a version

Package:         ${details.name}
Location:        ${details.packagePath}
Yarn:            ${formatVersionPresence(details.name, knownYarnVersions)}
npm shrinkwrap:  present at ${details.packagePath}, but missing a version`;
  }

  if (error.code === 'npm-dev-only') {
    return `npm-shrinkwrap.json resolves a production dependency to a development-only entry

Package:         ${formatIdentity(details.name, details.version)}
Location:        ${details.packagePath}
Yarn:            ${formatVersionPresence(details.name, knownYarnVersions)}
npm shrinkwrap:  ${formatNpmOccurrence(details.name, details)}, but marked dev-only`;
  }

  if (error.code === 'npm-entry-missing') {
    const name = details.packagePath ? packageNameFromPath(details.packagePath) : 'root package';
    return `npm-shrinkwrap.json references a package location with no entry

Package:         ${name}
Location:        ${details.packagePath || '(root package entry)'}
Yarn:            ${name === 'root package' ? 'workspace root present' : formatVersionPresence(name, knownYarnVersions)}
npm shrinkwrap:  missing at ${details.packagePath || 'packages[""]'}`;
  }

  if (error.code === 'npm-root-missing') {
    return `npm-shrinkwrap.json is missing its root package entry

Yarn:            workspace root present
npm shrinkwrap:  missing at packages[""]`;
  }

  return error.message;
};

export const formatVersionDifferences = (rows) => rows.map((row) => `${row.name}
  Yarn:            ${formatVersionPresence(row.name, new Map([[row.name, row.yarn]]))}
  npm shrinkwrap:  ${formatVersionPresence(row.name, new Map([[row.name, row.npm]]))}`)
  .join('\n\n');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHAKA_PERF = path.join(ROOT, 'packages', 'shaka-perf');
const SHRINKWRAP = path.join(SHAKA_PERF, 'npm-shrinkwrap.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const main = async () => {
  const require = createRequire(import.meta.url);
  let pnpapi;
  try {
    pnpapi = require('pnpapi');
  } catch {
    process.stderr.write('check-lockfiles: pnpapi is unavailable; run this check with `yarn node`\n');
    process.exit(1);
  }
  const { default: chalk } = await import('chalk');

  const rootLocator = pnpapi.findPackageLocator(`${SHAKA_PERF}${path.sep}`);
  if (!rootLocator) {
    process.stderr.write('check-lockfiles: shaka-perf is absent from Yarn\'s installed PnP graph\n');
    process.exit(1);
  }

  let yarn = new Map();
  let npm;
  let npmLock;
  try {
    npmLock = readJson(SHRINKWRAP);
    yarn = collectYarnProductionVersions({
      rootLocator,
      getPackageInformation: (locator) => pnpapi.getPackageInformation(locator),
      readManifest: (packageLocation) => readJson(path.join(packageLocation, 'package.json')),
    });
    npm = collectNpmProductionVersions(npmLock);
  } catch (error) {
    process.stderr.write(
      `${chalk.red('check-lockfiles: invalid dependency graph')}\n\n` +
      `${formatDependencyGraphError(error, { yarnVersions: yarn, npmLock })}\n`,
    );
    process.exit(1);
  }

  const rows = compareVersionMaps(yarn, npm);
  if (!rows.length) {
    process.stdout.write(`lockfiles agree on all ${countVersions(npm)} production versions\n`);
    process.exit(0);
  }

  process.stderr.write(
    `\n${chalk.red(`Yarn and npm resolve ${rows.length} production package(s) differently.`)}\n\n` +
      'Yarn decides what this repository builds and tests against; npm-shrinkwrap.json\n' +
      'decides what consumers receive. Every package name and every version in the\n' +
      'two production closures must match in both directions.\n\n' +
      `${formatVersionDifferences(rows)}\n`,
  );
  process.exit(1);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
