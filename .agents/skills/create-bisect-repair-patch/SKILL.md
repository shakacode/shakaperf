---
name: create-bisect-repair-patch
description: Create, inspect, edit, verify, apply, or remove managed compatibility patches for `shaka-perf bisect`. Use whenever historical candidates need frozen AB tests, build shims, seed-data setup, or other repairs, or whenever a user asks how to manage `bisect-repairs/manifest.json`. Always use the packaged `shaka-perf bisect patch` CLI; `bisect.repairs` and repository-local patch helpers are not supported.
compatibility: Requires Git, Node.js, and a shaka-perf project with twinServers configured.
---

# Manage bisect repair patches

Use the packaged CLI to create the smallest temporary compatibility change that
makes historical experiment commits measurable. The patch is an input artifact,
not a product fix: it must restore test, build, or setup compatibility without
changing the regression being classified.

Do not edit `bisect-repairs/manifest.json` or calculate hashes by hand. Do not
add `bisect.repairs` to `abtests.config.ts`. The public CLI owns the manifest,
canonical patch files, capture safety, hashes, and verification, and works when
shaka-perf is installed in another project.

## Choose a source

Use exactly one source.

Capture selected current uncommitted work:

```bash
shaka-perf bisect patch create historical-build-fix \
  --working-tree \
  --kind build \
  --purpose "Allow historical commits to build with the current toolchain" \
  --all \
  -- path/to/build.config.ts
```

Use `--all-files` instead of pathspecs only when every current change belongs in
the repair. Capture uses a temporary Git index and must leave the real index and
active checkout unchanged.

Backport changes introduced by a commit:

```bash
shaka-perf bisect patch create backport-checkout-test \
  --source-commit <ref> \
  --kind test-harness \
  --all \
  -- path/to/checkout.abtest.ts
```

The first parent is the default. Use `--parent <number>` for another merge
parent or `--root` for a root commit. The CLI records immutable source and
parent SHAs.

Import existing patch bytes:

```bash
shaka-perf bisect patch create legacy-seed-hook \
  --patch-file ./repairs/legacy-seed-hook.patch \
  --kind data \
  --at <sha> \
  --prepare-command "bin/seed-legacy" \
  --cleanup-command "bin/unseed-legacy"
```

An imported patch cannot take pathspecs. The source file remains untouched.

When choices are not known up front, run only:

```bash
shaka-perf bisect patch create <id>
```

The interactive workflow explains and prompts for every missing source,
metadata, selector, command, and confirmation.

## Choose the selector

- `--all` applies to every experiment SHA measured by the session, including
  endpoints, queued target groups, and merge-investigation candidates.
- `--from <ref> --through <ref>` is an inclusive first-parent interval.
  `--through` alone starts at the session good SHA.
- Repeated `--at <ref>` values select exact, possibly disjoint commits.

Selectors are mutually exclusive. Prefer the narrowest selector that covers
the incompatibility. Patch kind is reporting metadata only; never introduce
kind-specific or merge-phase-specific runtime behavior.

For a data repair, pair durable preparation with deterministic cleanup unless
the effective rebuild strategy recreates that state for every candidate.

## Verify and inspect

Verify the configured selector, or constrain verification to a concrete graph:

```bash
shaka-perf bisect patch verify <id>
shaka-perf bisect patch verify <id> <good-ref> <bad-ref>
shaka-perf bisect patch verify <id> <good-ref> <bad-ref> --investigate-merges
```

Verification uses disposable detached worktrees. At each selected SHA the
patch must either apply and reverse cleanly or already exist in committed
content. The active experiment checkout must remain untouched.

Inspect registrations with:

```bash
shaka-perf bisect patch list --verbose
shaka-perf bisect patch show <id>
shaka-perf bisect patch show <id> --patch
```

Use `--json` for agent or script consumption.

## Change an existing registration

Review all metadata interactively, with current values prefilled:

```bash
shaka-perf bisect patch update <id>
```

Update never changes patch bytes. Replace bytes with `edit`, using the same
three sources accepted by create:

```bash
shaka-perf bisect patch edit <id> --working-tree -- path/to/file
shaka-perf bisect patch edit <id> --source-commit <ref> -- path/to/file
shaka-perf bisect patch edit <id> --patch-file ./replacement.patch
```

Manually inspect a registered patch in the experiment checkout:

```bash
shaka-perf bisect patch apply <id> --check
shaka-perf bisect patch apply <id>
shaka-perf bisect patch apply <id> --reverse
```

Manual apply does not run preparation or cleanup commands and intentionally
leaves working-tree changes until reversed.

Remove a registration with interactive confirmation, or explicitly confirm a
noninteractive removal:

```bash
shaka-perf bisect patch remove <id>
shaka-perf bisect patch remove <id> --yes
```

Use `--keep-file` only when the user deliberately wants the now-unregistered
artifact retained.

## Hand off

Run `patch show`, `patch verify`, and the narrowest relevant project test.
Report the ID, kind, selector, managed artifact, hash, source provenance,
verification SHAs, commands, and tests run. Patch-management commands do not
create Git commits; when the user requests commits, keep the patch artifact and
manifest update together in one focused commit.

A fresh bisect snapshots manifest artifacts into its results. Resume uses the
snapshot, so edits to the source manifest affect only a new run. Mid-run repair
capture remains a later iteration; do not imply that a stopped candidate can
yet register a repair and resume with it.
