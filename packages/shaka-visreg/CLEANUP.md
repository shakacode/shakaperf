# Clean up shaka-visreg: Remove BackstopJS leftovers

## Context
shaka-visreg was ported from BackstopJS. After integrating `liveCompare` with the demo app, the package still contains ~15MB of legacy BackstopJS content (old website, examples, branding, CI configs, Docker publishing scripts) that isn't needed in the shaka-perf monorepo. The `remote` and `stop` commands are also being removed per user request.

All paths below are relative to `packages/shaka-visreg/`.

## Phase 1: Delete directories

| Directory | Why safe |
|-----------|----------|
| `old_splash_page_v2.0/` | Old BackstopJS marketing site, not referenced anywhere |
| `examples/` | BackstopJS example projects (Jenkins, Angular, React, etc.), not built or imported |
| `assets/` | BackstopJS branding (lemur images, SVGs, banners). Compare UI uses its own `compare/src/assets/` and `compare/output/assets/` |
| `.github/` | BackstopJS CI workflows. Monorepo uses `.circleci/config.yml` |
| `docker/` | Builds `backstopjs/backstopjs` Docker Hub image. `core/util/runDocker.ts` only references the image name, not this dir |
| `remote/` | Express middleware for remote BackstopJS server — removing per user request |
| `backstop_data/bitmaps_test/` | Generated test output (gitignored but leaked into repo) |
| `integrationTestDir/` | Generated integration test output (gitignored but leaked into repo) |

## Phase 2: Delete files

| File | Why safe |
|------|----------|
| `index.html` | Old BackstopJS splash page |
| `.gitlab-ci.yml` | Legacy GitLab CI |
| `.travis.yml` | Legacy Travis CI |
| `.eslintrc` | Not used (monorepo convention: no eslint) |
| `.eslintignore` | Not used |
| `.editorconfig` | BackstopJS editor config |
| `.babelrc` | Redundant — webpack config has identical inline babel presets |
| `CONTRIBUTING.md` | BackstopJS contribution guide |
| `changelog.md` | BackstopJS changelog |
| `core/command/remote.ts` | Remote command being removed |
| `core/command/stop.ts` | Stop command being removed (only stops the remote server) |
| `core/util/remote.ts` | Only used by `remote/index.cjs` |
| `test/core/util/remote_spec.ts` | Test for removed `core/util/remote.ts` |

## Phase 3: Update `core/command/index.ts`

Remove imports and all references to `remote` and `stop`:
- Remove `import * as remote from './remote.js'` and `import * as stop from './stop.js'`
- Remove `remote` and `stop` from `commandModules`, `commandNames`, and `exposedCommandNames`

## Phase 4: Update `cli/usage.ts`

Remove `remote` and `stop` from the CLI help text.

## Phase 5: Update `scripts/copy-assets.mjs`

Remove the `['remote', 'dist/remote']` entry from the assets array.

## Phase 6: Clean up `package.json`

**Remove scripts:**
- `lint`, `format`, `precommit` — eslint/prettier/lint-staged (not used)
- `integration-test` — creates `integrationTestDir/`, BackstopJS-specific
- `smoke-test`, `smoke-test-playwright`, `smoke-test-docker`, `smoke-test-playwright-docker`
- `sanity-test`, `sanity-test-playwright`, `sanity-test-docker`, `sanity-test-playwright-docker`
- `reference-test`
- `remote`, `stop` — removed commands
- `build-docker`, `build-and-load-docker`, `publish-docker`
- `build-and-publish`, `publish-npm`
- `init-docker-builder`, `burn-docker-builder`
- `success-message`, `caution-message`, `fail-message`

**Remove `lint-staged` section** (lines 51-55).

**Update metadata:**
- `repository.url` — change from `garris/backstopjs.git` to shaka-perf repo
- `author` — update from BackstopJS contributors link

**Remove devDependencies** (only needed by removed tooling):
- `eslint`, `eslint-config-semistandard`, `eslint-config-standard`, `eslint-plugin-import`, `eslint-plugin-n`, `eslint-plugin-node`, `eslint-plugin-promise`, `eslint-plugin-react`, `eslint-plugin-standard`
- `lint-staged`
- `prettier`, `prettier-eslint-cli`

**Remove dependency:**
- `super-simple-web-server` — only used by removed `remote` command

## Phase 7: Clean up `.gitignore`

Remove patterns that no longer apply:
- `compare/bower_components/**/.*`
- `examples/**/html_report/`

## Things to KEEP (confirmed used)

- `compare/` (including `compare/src/assets/` and `compare/output/`) — React diff UI, HTML report
- `cli/`, `core/` (minus remote/stop), `capture/`, `src/`, `scripts/`, `test/` (minus remote_spec)
- `core/util/getRemotePort.ts` — still used by `openReport.ts`
- `portfinder` dependency — still used by `core/util/getFreePorts.ts`
- `package.json`, `tsconfig.json`, `jest.config.cjs`, `LICENSE`, `.gitignore`

## Verification

1. `yarn build` from monorepo root — confirm tsc + copy-assets.mjs succeed
2. `yarn test` in shaka-visreg — confirm tests pass
3. `yarn install` — confirm no missing dependencies after devDep removal
