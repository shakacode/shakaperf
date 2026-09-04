# README

This README would normally document whatever steps are necessary to get the
application up and running.

Things you may want to cover:

* Ruby version

* System dependencies

* Configuration

* Database creation

* Database initialization

* How to run the test suite

* Services (job queues, cache servers, search engines, etc.)

* Deployment instructions

* ...

## Screenshot coverage

`shaka-perf audit --categories code_coverage` drains the client bundle's
istanbul coverage (the rspack config instruments every build) and writes a
visibility map per test and viewport. With `codeCoverage.screenshotCoveragePlugin:
'react19'` set in `abtests.config.ts`, each map row also names the app source line
that rendered the element — read from React's development-build debug info
(`fiber._debugStack`) and resolved through the bundle's source map. That join is
what the `shaka-perf-coverage` skill's `save` reads to write screenshot coverage
next to the code coverage of each source.

Twin-servers serve production builds, which carry neither the debug info nor
readable source maps, so run the coverage audit against a development build:

```bash
# Locally: development Rails + a static development bundle (source maps included).
# Needs the demo's gems (`bundle install`), a `yarn` on PATH (`corepack enable`),
# and a seeded dev database (`bin/rails db:prepare db:seed`).
bin/dev static                       # Procfile.dev-static-assets, port 3000
RAILS_PORT=3010 bin/dev static       # when something else holds port 3000
shaka-perf audit --categories code_coverage --url http://localhost:3000

# Or inside the experiment twin-server: rebuild its bundle in development mode,
# restart, and point the audit at the experiment URL. The next `servers build`
# or code sync restores the production bundle.
shaka-perf servers run-cmd experiment "NODE_ENV=development bin/shakapacker"
shaka-perf servers start-servers
shaka-perf audit --categories code_coverage --url http://localhost:<EXPERIMENT_PORT>
```

Against a production build the audit still writes the maps; their header says
`0 of N elements located` and why. Then:

```bash
node .claude/skills/shaka-perf-coverage/coverage-baseline.ts save "components/.*"
```
