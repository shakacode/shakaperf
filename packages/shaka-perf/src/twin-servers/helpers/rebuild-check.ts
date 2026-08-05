/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import type { ResolvedConfig } from '../types';
import { dockerImageExists, getImageCreatedAt as inspectImageCreatedAt } from './docker';
import { readProjectDockerignore } from './dockerignore';
import { dockerBuildDirForSide, dockerfileAbsForSide } from './project-paths';

const imageCreatedCache = new Map<string, Date | null>();

function cachedImageCreatedAt(image: string): Date | null {
  if (imageCreatedCache.has(image)) return imageCreatedCache.get(image) ?? null;
  const value = inspectImageCreatedAt(image);
  imageCreatedCache.set(image, value);
  return value;
}

/**
 * Drop the cached `.Created` timestamp for an image. Call this after a
 * rebuild so the next `decideRebuild` re-reads the timestamp instead of
 * using a stale one.
 */
export function invalidateImageCreated(image?: string): void {
  if (image) imageCreatedCache.delete(image);
  else imageCreatedCache.clear();
}

/**
 * Persistent "we attempted a rebuild" marker, written as a sibling to the
 * volume dir so it survives the volume wipe in `startContainers`. Exists
 * because BuildKit cache-hits don't bump the image's `.Created` time — when
 * a source file's mtime moves without a content change, `decideSide` would
 * otherwise flag a rebuild forever. We compare mtimes against the later of
 * the two stamps.
 */
function builtAtPath(volumeDir: string): string {
  return `${volumeDir}.built-at`;
}

export function recordBuildAttempt(volumeDir: string, at: Date = new Date()): void {
  try {
    fs.writeFileSync(builtAtPath(volumeDir), at.toISOString(), 'utf8');
  } catch {
    /* best effort — losing the marker just means one extra "needs rebuild" cycle */
  }
}

function readBuildAttempt(volumeDir: string): Date | null {
  try {
    const raw = fs.readFileSync(builtAtPath(volumeDir), 'utf8').trim();
    const t = Date.parse(raw);
    return Number.isFinite(t) ? new Date(t) : null;
  } catch {
    return null;
  }
}

/**
 * Snapshot of the build context as Docker saw it at build time. Lets
 * downstream code spot files that have been deleted since the build
 * (otherwise invisible to an mtime walk) and apply the dockerignore rules
 * that were in effect when the image was baked, even if `.dockerignore`
 * has been edited since. Stored as a sibling of the volume dir so it
 * survives `startContainers`' volume wipe.
 */
const MANIFEST_VERSION = 1;

export interface BuildManifest {
  version: typeof MANIFEST_VERSION;
  /** Verbatim `.dockerignore` content as it was at build time. */
  dockerignore: string;
  /**
   * COPY/ADD source roots parsed from the Dockerfile at build time, or
   * `null` if `parseCopySources` bailed (no COPY at all, or any uses
   * `--from=stage` / a glob). `null` means "fall back to walking the
   * whole build context."
   */
  copySources: string[] | null;
  /** Relative paths (forward slashes) of every file Docker would have copied. */
  files: string[];
}

function manifestPath(volumeDir: string): string {
  return `${volumeDir}.manifest.json`;
}

export function readBuildManifest(volumeDir: string): BuildManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath(volumeDir), 'utf8');
    const m = JSON.parse(raw) as Partial<BuildManifest>;
    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((s) => typeof s === 'string');
    if (
      m && m.version === MANIFEST_VERSION
      && typeof m.dockerignore === 'string'
      && isStringArray(m.files)
      && (m.copySources === null || isStringArray(m.copySources))
    ) {
      return m as BuildManifest;
    }
    return null;
  } catch {
    return null;
  }
}

function writeBuildManifest(volumeDir: string, manifest: BuildManifest): void {
  fs.writeFileSync(manifestPath(volumeDir), JSON.stringify(manifest), 'utf8');
}

export type RebuildTarget = 'control' | 'experiment';

export type RebuildDecision =
  | { needs: false; reason: string }
  | { needs: true; reason: string; target?: RebuildTarget };

// Transient tooling artifacts that mutate constantly while the menu is
// running: Yarn 4's install/build-state files (touched on every `yarn`
// invocation, including the one hosting this menu), and overmind's socket
// file (now pinned to /tmp, but kept here so stale on-disk copies in older
// checkouts don't keep flipping the rebuild signal to "stale").
const ALWAYS_IGNORE = [
  '.git',
  'node_modules',
  '.yarn/install-state.gz',
  '.yarn/build-state.yml',
  '.overmind.sock',
];

function buildIgnore(dockerignoreContent: string): Ignore {
  const ig = ignore();
  for (const pattern of ALWAYS_IGNORE) ig.add(pattern);
  if (dockerignoreContent) ig.add(dockerignoreContent);
  return ig;
}

export function loadDockerignore(buildDir: string, dockerfileAbs: string): Ignore {
  return buildIgnore(readProjectDockerignore(buildDir, dockerfileAbs));
}

/** Reconstruct an `Ignore` matcher from a manifest's frozen dockerignore. */
export function ignoreFromManifest(manifest: BuildManifest): Ignore {
  return buildIgnore(manifest.dockerignore);
}

const MAX_CHANGES = 10;

interface ChangedFile {
  relPath: string;
  /** Modification mtime in ms; undefined for deletions (manifest has no mtimes). */
  mtime?: number;
  deleted?: boolean;
}

/**
 * Parse a Dockerfile and return the list of source paths (relative to the
 * build context) that get copied into the image via `COPY` / `ADD`.
 *
 * Skips:
 *  - `COPY --from=<stage> …` — copies from a previous build stage, not the
 *    host filesystem, so it's invisible to mtime checks.
 *  - Any directive with a glob (`*`, `?`, `[`); we'd need full glob
 *    expansion to be correct, and the caller falls back to walking the
 *    whole build context when this returns `null`.
 *
 * Returns `null` if no usable sources were found (no COPY at all, or every
 * COPY uses a stage / glob) — caller treats that as "fall back to full
 * build-context walk", which is the conservative answer.
 */
function parseCopySources(dockerfileAbs: string): string[] | null {
  let content: string;
  try {
    content = fs.readFileSync(dockerfileAbs, 'utf8');
  } catch {
    return null;
  }

  // Collapse backslash line continuations.
  const logical = content.replace(/\\\r?\n/g, ' ');
  const sources = new Set<string>();
  let sawCopy = false;
  let bailOnGlob = false;

  for (const rawLine of logical.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('#')) continue;
    const match = line.match(/^(COPY|ADD)\s+(.+)$/i);
    if (!match) continue;
    sawCopy = true;

    const tokens = match[2].split(/\s+/).filter(Boolean);
    let fromStage = false;
    while (tokens.length > 0 && tokens[0].startsWith('--')) {
      if (tokens[0].startsWith('--from=')) fromStage = true;
      tokens.shift();
    }
    if (fromStage) continue;
    if (tokens.length < 2) continue;
    tokens.pop(); // destination

    for (const src of tokens) {
      if (/[*?[]/.test(src)) {
        bailOnGlob = true;
        break;
      }
      sources.add(src);
    }
    if (bailOnGlob) break;
  }

  if (!sawCopy || bailOnGlob) return null;
  return [...sources];
}

function collectChangedFiles(buildDir: string, ig: Ignore, since: Date, roots: string[]): ChangedFile[] {
  const sinceMs = since.getTime();
  const found: ChangedFile[] = [];

  function consider(abs: string, isFile: boolean): void {
    if (!isFile) return;
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch {
      return;
    }
    if (mtimeMs <= sinceMs) return;
    found.push({ relPath: path.relative(buildDir, abs), mtime: mtimeMs });
  }

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(buildDir, abs);
      const checkPath = entry.isDirectory() ? `${rel}/` : rel;
      if (ig.ignores(checkPath)) continue;

      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        consider(abs, true);
      }
    }
  }

  for (const root of roots) {
    const abs = path.resolve(buildDir, root);
    // Stay inside the build context — paths like "../foo" can't be in the
    // image, so skip them rather than walking the user's home tree.
    if (!isInside(abs, buildDir)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    const rel = path.relative(buildDir, abs);
    if (rel !== '' && ig.ignores(stat.isDirectory() ? `${rel}/` : rel)) continue;
    if (stat.isDirectory()) {
      walk(abs);
    } else if (stat.isFile()) {
      consider(abs, true);
    }
  }

  return found;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Walk the build context the same way `collectChangedFiles` does, but collect
 * every non-ignored file path instead of filtering by mtime. Returns
 * POSIX-style relative paths so the manifest is stable across OSes.
 */
function listBuildContextFiles(buildDir: string, ig: Ignore, roots: string[]): string[] {
  const out: string[] = [];
  const pushRel = (abs: string): void => {
    out.push(path.relative(buildDir, abs).split(path.sep).join('/'));
  };

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(buildDir, abs);
      const checkPath = entry.isDirectory() ? `${rel}/` : rel;
      if (ig.ignores(checkPath)) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) pushRel(abs);
    }
  }

  for (const root of roots) {
    const abs = path.resolve(buildDir, root);
    if (!isInside(abs, buildDir)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    const rel = path.relative(buildDir, abs);
    if (rel !== '' && ig.ignores(stat.isDirectory() ? `${rel}/` : rel)) continue;
    if (stat.isDirectory()) walk(abs);
    else if (stat.isFile()) pushRel(abs);
  }

  return out;
}

/**
 * Derive and persist the manifest for `side`. Call after a successful
 * build so deletion checks and auto-sync's frozen rules stay in sync with
 * what Docker actually baked into the image.
 */
export function recordBuildManifest(config: ResolvedConfig, side: RebuildTarget): void {
  const buildDir = dockerBuildDirForSide(config, side);
  if (!fs.existsSync(buildDir)) return;
  const dockerfileAbs = dockerfileAbsForSide(config, side);
  const dockerignoreContent = readProjectDockerignore(buildDir, dockerfileAbs);
  const ig = buildIgnore(dockerignoreContent);
  const copySources = parseCopySources(dockerfileAbs);
  const roots = copySources ?? ['.'];
  const files = listBuildContextFiles(buildDir, ig, roots);
  try {
    writeBuildManifest(config.volumes[side], {
      version: MANIFEST_VERSION,
      dockerignore: dockerignoreContent,
      copySources,
      files,
    });
  } catch (err) {
    // The build itself succeeded — warn, don't fail. But this isn't "best
    // effort": without a manifest, decideSide can't detect deletions and
    // performAutoSync silently skips every delete event, so the user needs
    // to know the safety net is gone until next successful build.
    console.warn(`[twin-servers] Failed to record manifest for ${side} at ${config.volumes[side]}.manifest.json: ${(err as Error).message}`);
    console.warn(`[twin-servers] Deletion detection and auto-sync deletes for ${side} are disabled until the next successful build.`);
  }
}

type SideOutcome =
  | { needs: false; reason: string }
  | { needs: true; side: RebuildTarget; reason?: string; changes: ChangedFile[] };

/**
 * Decide whether a single side (experiment or control) needs a rebuild by
 * comparing its image's `.Created` timestamp against the newest non-ignored
 * file mtime in its build context.
 *
 * The build context is whichever directory `docker build` would consume: the
 * matching path under `experimentDir` or `controlDir`, derived from the local
 * `projectDir` -> `dockerBuildDir` relationship (mirroring how
 * `buildDockerCmd` resolves it in `commands/build.ts`).
 */
function decideSide(
  config: ResolvedConfig,
  side: RebuildTarget,
): SideOutcome {
  const image = config.images[side];

  if (!dockerImageExists(image)) {
    return { needs: true, side, reason: `image ${image} missing`, changes: [] };
  }

  const created = cachedImageCreatedAt(image);
  if (!created) {
    return { needs: true, side, reason: `cannot read created time for ${image}`, changes: [] };
  }
  // BuildKit cache-hits leave image.Created unchanged even after a "rebuild",
  // so fall back to our own marker (written after every build attempt) when
  // it's newer.
  const builtAt = readBuildAttempt(config.volumes[side]);
  const since = builtAt && builtAt > created ? builtAt : created;

  const buildDir = dockerBuildDirForSide(config, side);

  if (!fs.existsSync(buildDir)) {
    // Build dir missing — we can't run the mtime check, and we can't
    // safely assume a rebuild is needed either (image-missing already
    // returns `needs:true` above, so this branch only fires when the
    // image exists but the source tree doesn't — e.g. user wiped
    // controlDir intentionally). Leave the image alone; the clone
    // prompt in `build` only runs on the image-missing path.
    return { needs: false, reason: `${side} build dir ${buildDir} missing — skipping mtime check` };
  }

  // Prefer the manifest's frozen rules end-to-end (dockerignore + COPY
  // roots) over re-parsing the live Dockerfile, so post-build edits don't
  // make the mtime walk and the deletion check disagree about which paths
  // are in the image. Falls back to live parsing when no manifest exists
  // (older builds, or first run after upgrade).
  const manifest = readBuildManifest(config.volumes[side]);
  const dockerfileAbs = dockerfileAbsForSide(config, side);
  const ig = manifest ? ignoreFromManifest(manifest) : loadDockerignore(buildDir, dockerfileAbs);
  const copySources = manifest ? manifest.copySources : parseCopySources(dockerfileAbs);
  const roots = copySources ?? ['.'];

  const modified = collectChangedFiles(buildDir, ig, since, roots);
  modified.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));

  // Deletions are invisible to the mtime walk above — cross-check the manifest.
  const deletions: ChangedFile[] = [];
  if (manifest) {
    for (const rel of manifest.files) {
      if (!fs.existsSync(path.join(buildDir, rel))) {
        deletions.push({ relPath: rel, deleted: true });
      }
    }
  }

  const changes = [...modified, ...deletions];
  if (changes.length === 0) {
    return { needs: false, reason: `${side}: no changes` };
  }
  return { needs: true, side, changes };
}

function formatSideChanges(outcome: { side: RebuildTarget; reason?: string; changes: ChangedFile[] }): string {
  if (outcome.reason) return outcome.reason;
  const shown = outcome.changes
    .slice(0, MAX_CHANGES)
    .map((c) => (c.deleted ? `${c.relPath} (deleted)` : c.relPath));
  const extra = outcome.changes.length - MAX_CHANGES;
  if (extra > 0) shown.push(`+${extra} more`);
  return `${outcome.side}: ${shown.join(', ')}`;
}

export async function decideRebuild(config: ResolvedConfig): Promise<RebuildDecision> {
  const experiment = decideSide(config, 'experiment');
  const control = decideSide(config, 'control');

  if (experiment.needs && control.needs) {
    return { needs: true, reason: `${formatSideChanges(experiment)}; ${formatSideChanges(control)}` };
  }
  if (experiment.needs) {
    return { needs: true, target: 'experiment', reason: formatSideChanges(experiment) };
  }
  if (control.needs) {
    return { needs: true, target: 'control', reason: formatSideChanges(control) };
  }
  return { needs: false, reason: `${experiment.reason}; ${control.reason}` };
}
