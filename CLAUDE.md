# shaka-perf

Frontend performance testing toolkit for web applications. Yarn 4 monorepo.

## Packages

- **shaka-perf** - Unified CLI for benchmarking, visual regression, and twin-servers (commands: `perf-*`, `visreg-*`, `servers`)
- **shaka-bundle-size** - Bundle size diffing with S3 baseline storage
- **shaka-shared** - Shared utilities used by shaka-perf and shaka-bundle-size
- **demo-ecommerce** - Rails + React demo app

## Commands

```bash
yarn install    # Install dependencies
yarn build      # Build all packages (tsc)
```

### shaka-perf CLI

```bash
shaka-perf compare              # Unified visreg + perf comparison + single-file HTML report
shaka-perf servers              # Docker A/B testing infrastructure (auto build+start)
shaka-perf client-report        # Client-facing mobile-speed report from a saved audit-results dir
shaka-perf warm-email           # Warm outreach email draft + client report from a saved audit
shaka-perf cold-email           # Reply delivering what a cold campaign email promised, from a saved audit
```

`client-report`, `warm-email`, and `cold-email` are post-processing over a
saved `shaka-perf audit` output; see @packages/shaka-perf/README-warm-email.md
and @packages/shaka-perf/README-cold-email.md.

The unified `compare` command reads `abtests.config.ts` (sections: `shared`,
`visreg`, `perf`, `twinServers`). Use `--categories visreg,perf` to control
what runs. Output is a single self-contained `compare-results/report.html`
the React shell lives at `packages/shaka-perf/report-shell/` (Vite +
vite-plugin-singlefile, all assets inlined as base64).

### Auditing bot-protected sites (real-Chrome mode)

A site behind a Cloudflare/Turnstile bot wall serves the headless audit a "Just a
moment..." / "Verify you are human" challenge instead of the real page. When that
happens the report says "Could not measure - bot protection" (it never presents
challenge-page data as the site's). To actually get through and measure the real
page, run with real-Chrome mode enabled. The default path is headed:

```bash
SHAKAPERF_REAL_CHROME=1 shaka-perf audit --url https://example.com/
```

This drives the installed Chrome (`channel: 'chrome'`) with the automation flag
stripped. Interactive Turnstile challenges can still require this visible path,
which needs a display. In real-Chrome mode, `--headed` is redundant: all audit
browsers are headed unless `SHAKAPERF_REAL_CHROME_HEADLESS=1` is set.

Some managed challenges auto-pass real Chrome in headless mode. For those sites,
opt in explicitly without `--headed`:

```bash
SHAKAPERF_REAL_CHROME=1 SHAKAPERF_REAL_CHROME_HEADLESS=1 shaka-perf audit --url https://example.com/
```

`SHAKAPERF_REAL_CHROME_HEADLESS=1` takes precedence if it is combined with
`--headed` across the real-Chrome audit browsers. Performance Lighthouse and
Playwright apply viewport-matched identities to mobile contexts and non-mobile
headless contexts; a headed non-mobile context keeps Chrome's native identity.
On the viewport-matched paths, Lighthouse normalizes only the Chrome version
milestone to the host browser and keeps the literal platform token. On the
headed non-mobile path it sends no UA override. Playwright derives the
platform, platform-version, and architecture client hints from its UA override,
and sets the mobile hint from the context's `isMobile` option. It forces the
model hint to an empty value; only the brand list remains browser-controlled.
After each Playwright navigation the engine polls up to ~25s for the challenge
to clear.
Sites that admit only a mobile identity can still block the desktop audit row.
In real-Chrome mode, Lighthouse uses a viewport-matched emulated identity for
mobile contexts and explicit-headless non-mobile contexts; a headed non-mobile
context keeps Chrome's native identity. An explicit
`lighthouseConfig.emulatedUserAgent` override wins in either case. Baselines
recorded without real-Chrome mode are unaffected.
The raw agent-readiness fetch uses the same native identity as a headed
non-mobile real-Chrome context, so its score can differ from default-mode
results on sites that vary markup by user agent. On that path the audited host
receives the operator's native browser identity instead of the neutral raw-fetch
identity. The standalone Lighthouse accessibility score is omitted in
real-Chrome mode because it cannot share the interactive challenge state; the
Playwright accessibility scan still runs.
Both paths require `google-chrome` and are opt-in: **never set
`SHAKAPERF_REAL_CHROME` in CI** - CI should use the default browser
configuration.

## Breaking changes

Any change that can break an existing consumer's `.abtest.ts` files or
`abtests.config.ts` — a removed/renamed `abTest()` option, a moved or
renamed config field, a changed default — MUST be logged in
[BREAKING_CHANGES.md](./BREAKING_CHANGES.md) under its **Unreleased** section,
with the exact fix for affected tests. `/deploy` stamps that section with the
version on publish.

## Code Conventions

- TypeScript strict mode, no ESLint/Prettier
- Zod for runtime validation
- PascalCase for classes/types, camelCase for functions
- Commander.js for CLIs
- In new code don't use docker compose directly, see @packages/shaka-perf/SETUP-twin-servers.md

## Architecture Review

Variant-specific behaviour (pipeline/stage renderers, summaries, etc.)
must be configured polymorphically through factory options — no
`switch (name)` dispatchers in shared modules. See the
`review-architecture` skill for the rule, the single allowed
exception, and a review checklist.

## Package Structure

```
packages/shaka-perf/src/
├── cli.ts              # Root CLI entry point
├── index.ts            # Barrel exports
├── bench/              # Benchmarking domain
│   ├── cli/            # CLI commands, config, helpers
│   ├── core/           # Lighthouse benchmarking engine
│   └── stats/          # Statistical analysis
├── visreg/             # Visual regression domain
│   ├── cli/            # CLI commands
│   ├── core/           # Comparison engine
│   └── capture/        # Screenshot capture helpers
└── twin-servers/       # Docker A/B infrastructure
    ├── commands/       # CLI commands
    ├── helpers/        # Docker, git, shell utilities
    ├── config.ts       # Config loading
    └── types.ts        # Zod schemas
```

## Publishing

Git tags trigger npm publish: `git tag package-name@version && git push origin --tags`
