Deploy packages to npm by bumping versions, pushing commits, and creating git tags.

Git tags trigger npm publish via CI. Packages that depend on `shaka-shared` (shaka-visreg, shaka-bench, shaka-bundle-size, shaka-twin-servers) need it published first.

## Rules

1. **Push commits before tags.** A tag pointing to a commit that doesn't exist on the remote will cause CI to check out stale code.
2. **Deploy `shaka-shared` first** if it's in the deploy set. Other packages depend on it — if you publish them before `shaka-shared`, their installs will fail because they reference a `shaka-shared` version that doesn't exist on npm yet.
3. **Wait for each publish workflow to succeed** before pushing tags for dependent packages. Use `gh run watch <id> --exit-status` to wait.
4. **One version bump per package per deploy.** Don't re-bump a version that was already tagged — bump to a new version instead.

## Steps

1. Ask which packages to deploy (if not specified via $ARGUMENTS). Valid packages: shaka-shared, shaka-visreg, shaka-bench, shaka-bundle-size, shaka-twin-servers.

2. For each package, read its `packages/<name>/package.json` to get the current version, then bump the patch version.

3. Commit all version bumps together. Push the branch.

4. If `shaka-shared` is being deployed:
   a. Create and push the `shaka-shared@<version>` tag
   b. Wait for the publish workflow to complete successfully
   c. Only then proceed to the remaining packages

5. Create and push tags for the remaining packages (these can be pushed together since they don't depend on each other).

6. Watch all remaining publish workflows and report results.

## Tag format

Tags must follow the pattern: `<package-name>@<version>` (e.g., `shaka-visreg@0.0.8`)
