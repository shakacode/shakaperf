Deploy packages to npm by bumping versions, pushing commits, and creating git tags.

Git tags trigger npm publish via CI. Packages that depend on `shaka-shared` (shaka-perf, shaka-bundle-size) need it published first.

## Rules

1. **Push commits before tags.** A tag pointing to a commit that doesn't exist on the remote will cause CI to check out stale code.
2. **Deploy `shaka-shared` first** if it's in the deploy set. Other packages depend on it — if you publish them before `shaka-shared`, their installs will fail because they reference a `shaka-shared` version that doesn't exist on npm yet.
3. **Wait for each publish workflow to succeed** before pushing tags for dependent packages. Use `gh run watch <id> --exit-status` to wait.
4. **One version bump per package per deploy.** Don't re-bump a version that was already tagged — bump to a new version instead.
5. **Stamp BREAKING_CHANGES.md.** If it has an **Unreleased** section with entries, this release ships breaking changes — record the released version there (see step 3).
6. **Surface breaking changes in the release.** When the Unreleased section had entries, annotate that package's tag with a summary of them so the change is visible at release time, not just in the file (see steps 5–6). Tag a release with no breaking changes as a lightweight tag as before.

## Steps

1. Ask which packages to deploy (if not specified via $ARGUMENTS). Valid packages: shaka-shared, shaka-perf, shaka-bundle-size.

2. For each package, read its `packages/<name>/package.json` to get the current version, then bump the patch version.

3. Update [BREAKING_CHANGES.md](../../BREAKING_CHANGES.md): if its **Unreleased** section has any entries, rename that heading to `## <package>@<version>` (or the shared version being released) with today's date, and update the "Current version:" line at the bottom to the versions just bumped. If **Unreleased** is empty, only update the "Current version:" line. Include this edit in the version-bump commit.

4. Commit all version bumps together (including the BREAKING_CHANGES.md update). Push the branch.

5. If `shaka-shared` is being deployed:
   a. Create and push the `shaka-shared@<version>` tag
   b. Wait for the publish workflow to complete successfully
   c. Only then proceed to the remaining packages

6. Create and push tags for the remaining packages (these can be pushed together since they don't depend on each other).

   When this release ships breaking changes (the package's Unreleased section had entries in step 3), make its tag an **annotated** tag whose message summarizes the breaking changes and their fixes, drawn from the section you just stamped:

   ```bash
   git tag -a shaka-perf@<version> -m "$(BREAKING CHANGES summary — what broke + how to fix, from BREAKING_CHANGES.md)"
   ```

   A release with no breaking changes stays a lightweight tag (`git tag <package>@<version>`).

7. Watch all remaining publish workflows and report results.

## Tag format

Tags must follow the pattern: `<package-name>@<version>` (e.g., `shaka-perf@0.0.1`)
