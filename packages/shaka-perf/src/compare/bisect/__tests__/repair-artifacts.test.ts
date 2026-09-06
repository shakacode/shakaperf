/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PreparedGitRange } from '../git';
import type { BisectPatchManifestEntry } from '../patch-manifest';
import {
  prepareManifestRepairs,
  repairArtifactPath,
  verifyPersistedRepairArtifacts,
  writePreparedRepairArtifacts,
} from '../repair-artifacts';

describe('bisect repair artifacts', () => {
  let rootDir: string;
  let repoDir: string;
  let configDirectory: string;
  let resultsDirectory: string;
  let range: PreparedGitRange;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-bisect-repairs-'));
    repoDir = path.join(rootDir, 'repo');
    configDirectory = path.join(rootDir, 'project-config');
    resultsDirectory = path.join(rootDir, 'compare-bisect-results');
    fs.mkdirSync(repoDir);
    fs.mkdirSync(configDirectory);
    git(['init', '--initial-branch=main']);
    git(['config', 'user.email', 'repairs@example.com']);
    git(['config', 'user.name', 'Repair Tests']);
    const good = commit('good');
    const middle = commit('middle');
    const bad = commit('bad');
    range = {
      goodSha: good,
      badSha: bad,
      orderedCommits: [good, middle, bad],
      commitSubjects: { [good]: 'good', [middle]: 'middle', [bad]: 'bad' },
      commitParents: { [good]: [], [middle]: [good], [bad]: [middle] },
      originalExperiment: { branch: 'main', sha: bad },
    };
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('resolves manifest-relative patches and inclusive primary intervals', async () => {
    writePatch();

    const prepared = await prepareManifestRepairs({
      patches: [repair({
        appliesTo: { from: range.orderedCommits[1]!, through: 'HEAD' },
      })],
      manifestDirectory: configDirectory,
      experimentDir: repoDir,
      range,
      registeredAt: '2026-07-27T00:00:00.000Z',
      rebuildContainer: false,
    });

    expect(prepared.repairs).toEqual([expect.objectContaining({
      id: 'compat',
      filename: 'patches/compat.patch',
      order: 0,
      appliesToAll: false,
      applicableShas: range.orderedCommits.slice(1),
      registeredAt: '2026-07-27T00:00:00.000Z',
    })]);
    expect(prepared.artifacts[0]?.contents.toString()).toBe('patch bytes\n');
  });

  it('freezes explicit refs to unique immutable SHAs outside interval semantics', async () => {
    writePatch();
    const prepared = await prepareManifestRepairs({
      patches: [repair({
        appliesTo: { commits: ['HEAD', range.badSha, range.goodSha] },
      })],
      manifestDirectory: configDirectory,
      experimentDir: repoDir,
      range,
      registeredAt: 'registered',
      rebuildContainer: false,
    });

    expect(prepared.repairs[0]?.applicableShas).toEqual([range.badSha, range.goodSha]);
    expect(prepared.repairs[0]?.appliesToAll).toBe(false);
  });

  it('persists an all selector without limiting it to the primary range', async () => {
    writePatch();
    const prepared = await prepareManifestRepairs({
      patches: [repair({ appliesTo: { all: true } })],
      manifestDirectory: configDirectory,
      experimentDir: repoDir,
      range,
      registeredAt: 'registered',
      rebuildContainer: false,
    });

    expect(prepared.repairs[0]).toMatchObject({
      appliesToAll: true,
      applicableShas: [],
    });
  });

  it('rejects reversed intervals and unsafe data setup', async () => {
    writePatch();
    await expect(prepareManifestRepairs({
      patches: [repair({
        appliesTo: { from: range.badSha, through: range.goodSha },
      })],
      manifestDirectory: configDirectory,
      experimentDir: repoDir,
      range,
      registeredAt: 'registered',
      rebuildContainer: false,
    })).rejects.toThrow(/interval is reversed/i);

    await expect(prepareManifestRepairs({
      patches: [repair({
        kind: 'data',
        prepareCommands: [{ description: 'Seed', command: 'bin/seed' }],
      })],
      manifestDirectory: configDirectory,
      experimentDir: repoDir,
      range,
      registeredAt: 'registered',
      rebuildContainer: false,
    })).rejects.toThrow(/needs cleanupCommands/i);
  });

  it('atomically snapshots repairs and validates their persisted hashes', async () => {
    writePatch();
    const prepared = await prepareManifestRepairs({
      patches: [repair()],
      manifestDirectory: configDirectory,
      experimentDir: repoDir,
      range,
      registeredAt: 'registered',
      rebuildContainer: false,
    });
    fs.mkdirSync(path.join(resultsDirectory, 'patches'), { recursive: true });
    fs.writeFileSync(path.join(resultsDirectory, 'patches', 'stale.patch'), 'stale');

    writePreparedRepairArtifacts(resultsDirectory, prepared.artifacts);
    expect(fs.existsSync(path.join(resultsDirectory, 'patches', 'stale.patch'))).toBe(false);
    expect(() => verifyPersistedRepairArtifacts(resultsDirectory, prepared.repairs)).not.toThrow();

    fs.writeFileSync(path.join(resultsDirectory, 'patches', 'compat.patch'), 'changed');
    expect(() => verifyPersistedRepairArtifacts(resultsDirectory, prepared.repairs))
      .toThrow(/artifact "compat" changed/i);
  });

  it('rejects a patch whose bytes do not match the manifest hash', async () => {
    writePatch('changed patch bytes\n');
    await expect(prepareManifestRepairs({
      patches: [repair()],
      manifestDirectory: configDirectory,
      experimentDir: repoDir,
      range,
      registeredAt: 'registered',
      rebuildContainer: false,
    })).rejects.toThrow(/hash does not match manifest/i);
  });

  it('rejects persisted filenames outside the patch artifact directory', () => {
    expect(() => repairArtifactPath(resultsDirectory, '../escape.patch')).toThrow(/invalid/i);
    expect(() => repairArtifactPath(resultsDirectory, 'patches/not-a-patch.txt')).toThrow(/invalid/i);
  });

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' }).trim();
  }

  function commit(label: string): string {
    fs.writeFileSync(path.join(repoDir, `${label}.txt`), `${label}\n`);
    git(['add', `${label}.txt`]);
    git(['commit', '-m', label]);
    return git(['rev-parse', 'HEAD']);
  }

  function writePatch(contents = PATCH_BYTES): void {
    fs.writeFileSync(path.join(configDirectory, 'compat.patch'), contents);
  }
});

const PATCH_BYTES = 'patch bytes\n';
const PATCH_HASH = createHash('sha256').update(PATCH_BYTES).digest('hex');

function repair(
  overrides: Partial<BisectPatchManifestEntry> = {},
): BisectPatchManifestEntry {
  return {
    id: 'compat',
    kind: 'build',
    purpose: 'Keep historical commits buildable',
    filename: 'compat.patch',
    sha256: PATCH_HASH,
    source: { kind: 'patch-file', importedFromBasename: 'compat.patch' },
    appliesTo: { through: 'HEAD' },
    prepareCommands: [],
    cleanupCommands: [],
    ...overrides,
  };
}
