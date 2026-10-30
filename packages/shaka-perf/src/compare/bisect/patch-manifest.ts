/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

export const DEFAULT_BISECT_PATCHES_MANIFEST = 'bisect-repairs/manifest.json';

const PatchCommandSchema = z.object({
  description: z.string().trim().min(1, 'description is required'),
  command: z.string().trim().min(1, 'command is required'),
}).strict();

const CommitSelectorSchema = z.object({
  commits: z.array(z.string().trim().min(1)).nonempty(),
}).strict();

const IntervalSelectorSchema = z.object({
  from: z.string().trim().min(1).optional(),
  through: z.string().trim().min(1),
}).strict();

const AllSelectorSchema = z.object({
  all: z.literal(true),
}).strict();

const WorkingTreeSourceSchema = z.object({
  kind: z.literal('working-tree'),
  headSha: z.string().trim().min(1),
  paths: z.array(z.string().trim().min(1)).nonempty(),
}).strict();

const SourceCommitSourceSchema = z.object({
  kind: z.literal('source-commit'),
  sha: z.string().trim().min(1),
  parentSha: z.string().trim().min(1),
  paths: z.array(z.string().trim().min(1)),
}).strict();

const PatchFileSourceSchema = z.object({
  kind: z.literal('patch-file'),
  importedFromBasename: z.string().trim().min(1),
}).strict();

export const BisectPatchIdSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  'patch id must be a filesystem-safe identifier',
);

export const BisectPatchManifestEntrySchema = z.object({
  id: BisectPatchIdSchema,
  kind: z.enum(['test-harness', 'build', 'data', 'other']),
  purpose: z.string().trim().min(1, 'purpose cannot be empty').optional(),
  filename: z.string().regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.patch$/,
    'filename must be a safe manifest-relative .patch filename',
  ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hexadecimal characters'),
  source: z.discriminatedUnion('kind', [
    WorkingTreeSourceSchema,
    SourceCommitSourceSchema,
    PatchFileSourceSchema,
  ]),
  appliesTo: z.union([
    CommitSelectorSchema,
    IntervalSelectorSchema,
    AllSelectorSchema,
  ]),
  prepareCommands: z.array(PatchCommandSchema).default([]),
  cleanupCommands: z.array(PatchCommandSchema).default([]),
}).strict();

export const BisectPatchManifestSchema = z.object({
  version: z.literal(1),
  patches: z.array(BisectPatchManifestEntrySchema),
}).strict().superRefine((manifest, ctx) => {
  const ids = new Set<string>();
  const filenames = new Set<string>();
  for (const [index, patch] of manifest.patches.entries()) {
    if (ids.has(patch.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patches', index, 'id'],
        message: `duplicate patch id "${patch.id}"`,
      });
    }
    ids.add(patch.id);
    if (filenames.has(patch.filename)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patches', index, 'filename'],
        message: `duplicate patch filename "${patch.filename}"`,
      });
    }
    filenames.add(patch.filename);
  }
});

export type BisectPatchManifestEntry = z.infer<typeof BisectPatchManifestEntrySchema>;
export type BisectPatchManifest = z.infer<typeof BisectPatchManifestSchema>;
export type BisectPatchSource = BisectPatchManifestEntry['source'];
export type BisectPatchSelector = BisectPatchManifestEntry['appliesTo'];

export interface LoadedBisectPatchManifest {
  path: string;
  directory: string;
  manifest: BisectPatchManifest;
}

export function resolveBisectPatchManifestPath(options: {
  configDirectory: string;
  configuredPath?: string;
}): string {
  return path.resolve(
    options.configDirectory,
    options.configuredPath ?? DEFAULT_BISECT_PATCHES_MANIFEST,
  );
}

export function loadBisectPatchManifest(options: {
  configDirectory: string;
  configuredPath?: string;
}): LoadedBisectPatchManifest {
  const manifestPath = resolveBisectPatchManifestPath(options);
  if (!fs.existsSync(manifestPath)) {
    if (options.configuredPath) {
      throw new Error(`Cannot read bisect patch manifest at ${manifestPath}`);
    }
    return {
      path: manifestPath,
      directory: path.dirname(manifestPath),
      manifest: { version: 1, patches: [] },
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse bisect patch manifest at ${manifestPath}`, {
      cause: error,
    });
  }

  const parsed = BisectPatchManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    const location = first.path.length > 0 ? ` at ${first.path.join('.')}` : '';
    throw new Error(
      `Invalid bisect patch manifest ${manifestPath}${location}: ${first.message}`,
    );
  }
  return {
    path: manifestPath,
    directory: path.dirname(manifestPath),
    manifest: parsed.data,
  };
}
