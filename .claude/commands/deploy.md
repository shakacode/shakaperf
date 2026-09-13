Deploy packages to npm by bumping versions, merging them to main through a PR, and creating git tags.

Git tags trigger npm publish via CI. Packages that depend on `shaka-shared` (shaka-perf, shaka-bundle-size) need it published first.

`main` is protected: every commit must arrive through a pull request, but the
ruleset requires no approvals (CODEOWNERS only covers `.github/` and the bot
configs), so a version-bump PR can be merged by its author right away. Tags
are not restricted.

## Rules

1. **Tag only commits that are on `main`.** CI checks out the tagged commit, so it must exist on the remote — and a tag placed on a PR branch commit points at an orphan once the PR is squash-merged. Merge first, pull, then tag the merge commit.
2. **Deploy `shaka-shared` first** if it's in the deploy set. Other packages depend on it — if you publish them before `shaka-shared`, their installs will fail because they reference a `shaka-shared` version that doesn't exist on npm yet.
3. **Wait for each publish workflow to succeed** before pushing tags for dependent packages. Use `gh run watch <id> --exit-status` to wait.
4. **One version bump per package per deploy.** Don't re-bump a version that was already tagged — bump to a new version instead.
5. **Stamp BREAKING_CHANGES.md.** If it has an **Unreleased** section with entries, this release ships breaking changes — record the released version there (see step 3).
6. **Keep `shaka-perf` and `shaka-shared` on the same version only when they are published together** — a solo release bumps just that package and lets the versions diverge. Shipping them together again re-aligns them: the one left behind jumps straight to the shared version (e.g. `shaka-shared` 0.2.1 → 0.2.4).
7. **Surface breaking changes in the release.** When the Unreleased section had entries, annotate that package's tag with the list of them so the change is visible at release time, not just in the file (see steps 5–6). The list is mechanical — one line per `###` heading of the stamped section, no rewording, no verbatim body text. Tag a release with no breaking changes as a lightweight tag as before.
8. **STOP THE DEPLOYMENT if the shrinkwrap refresh moves anything but the released versions.** A tag ships whatever `npm install` re-resolved (step 5c) straight to consumers, unreviewed. Report it and wait for the human — don't commit, don't tag, don't fix it.

## Steps

1. Ask which packages to deploy (if not specified via $ARGUMENTS). Valid packages: shaka-shared, shaka-perf, shaka-bundle-size.

   Start from a fresh `main` (`git checkout main && git pull`) and create the release branch: `git checkout -b deploy/<package>@<version>` (use the shared version when several ship together).

2. For each package, read its `packages/<name>/package.json` to get the current version, then bump the patch version. When `shaka-shared` and `shaka-perf` ship together, bump `shaka-perf`'s patch and set `shaka-shared` to the same version (rule 6). Leave `shaka-perf`'s `"shaka-shared"` range alone — step 5c bumps it.

3. Update [BREAKING_CHANGES.md](../../BREAKING_CHANGES.md): if its **Unreleased** section has any entries, rename that heading to `## <package>@<version>` (or the shared version being released) with today's date, and update the "Current version:" line at the bottom to the versions just bumped. If **Unreleased** is empty, only update the "Current version:" line. Include this edit in the version-bump commit.

4. Commit all version bumps together (including the BREAKING_CHANGES.md update) and land them on `main` through a PR:

   ```bash
   git push -u origin deploy/<package>@<version>
   gh pr create --title "Release <package>@<version>" --body "<packages + versions being released>"
   gh pr merge --squash --delete-branch   # no approval is required
   git checkout main && git pull
   ```

   Confirm `git log -1` on `main` is the release commit before tagging anything.

5. If `shaka-shared` is being deployed:
   a. Create the `shaka-shared@<version>` tag on the `main` merge commit and push it
   b. Wait for the publish workflow to complete successfully
   c. On a second branch (`deploy/shaka-perf@<version>-shrinkwrap`), bump `shaka-perf`'s `"shaka-shared"` range to `^<new version>`, then regenerate `packages/shaka-perf/npm-shrinkwrap.json` (`yarn install`). Without the range bump the pin silently stays on the old version; before `shaka-shared` is published the range can't resolve.

      Inspect the refresh BEFORE committing:

      ```bash
      git diff -- packages/shaka-perf/npm-shrinkwrap.json
      ```

      12 lines, six values: `version`, `packages[""].version`, `packages[""].dependencies["shaka-shared"]`, and `.version` / `.resolved` / `.integrity` under `packages["node_modules/shaka-shared"]` — all naming the released versions.

      **Any other line: STOP THE DEPLOYMENT** (rule 8). Report what changed and wait.

      Then commit both files and land them the same way as step 4 (push, `gh pr create`, `gh pr merge --squash --delete-branch`, `git checkout main && git pull`). CI on `main` stays red between the two merges (`yarn security-checks` still sees the old `shaka-shared`); the publish workflow is unaffected — its gate is scoped to the `shaka-perf` tag.
   d. Only then proceed to the remaining packages

   Before tagging `shaka-perf`, run `yarn security-checks` — it fails if `npm-shrinkwrap.json` (shipped in the tarball, pins the graph for consumers) has drifted from `yarn.lock`, if a dependency gained an unreviewed install hook, or if a pinned version has a known high/critical advisory.

6. Create and push tags for the remaining packages on the current `main` commit (these can be pushed together since they don't depend on each other).

   When this release ships breaking changes (the package's Unreleased section had entries in step 3), make its tag an **annotated** tag listing them (rule 7): a title line, a pointer to the stamped section, and one numbered line per `###` heading of that section, copied as-is:

   ```bash
   git tag -a shaka-perf@<version> -m "$(cat <<'MSG'
   shaka-perf <version> — BREAKING CHANGES

   Full details and migration snippets: BREAKING_CHANGES.md § <version>.

   1. <first ### heading>
   2. <second ### heading>
   MSG
   )"
   ```

   A release with no breaking changes stays a lightweight tag (`git tag <package>@<version>`).

7. Watch all remaining publish workflows and report results.

## Tag format

Tags must follow the pattern: `<package-name>@<version>` (e.g., `shaka-perf@0.0.1`)
