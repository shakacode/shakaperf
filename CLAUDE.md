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
shaka-perf troubleshoot         # Debug ONE test at ONE viewport: browsers stay open on any error, attachable over CDP
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

`troubleshoot` is `compare` narrowed to one test at one viewport, leaving the
browsers open for inspection over CDP (it never finishes and yields no numbers —
use `compare` to measure). To run it and attach to the browsers, see
`shaka-perf troubleshoot --help`; details in
@packages/shaka-perf/README-troubleshoot.md.

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
`--headed` across the real-Chrome audit browsers. The one identity difference
from the default mode: a headed non-mobile real-Chrome context keeps Chrome's
native user agent (it has to look like the operator's own browser to an
interactive challenge), on Playwright contexts, Lighthouse
(`emulatedUserAgent: false`), and the raw agent-readiness fetch alike. Every
other context sends the viewport's device identity, exactly as in the default
mode (see "Viewport identity" below). After each Playwright navigation the
engine polls up to ~25s for the challenge to clear. Sites that admit only a
mobile identity can still block the desktop audit row. The standalone
Lighthouse accessibility score is omitted in real-Chrome mode because it cannot
share the interactive challenge state; the Playwright accessibility scan still
runs.
Both paths require `google-chrome` and are opt-in: **never set
`SHAKAPERF_REAL_CHROME` in CI** - CI should use the default browser
configuration.

### Viewport identity (user agent)

Every test at every viewport sends the user agent of the device that viewport
stands for, on every engine: Playwright contexts (visreg, code coverage,
accessibility, agent readiness), Lighthouse's `emulatedUserAgent`, the bench
worker's Chrome `--user-agent` launch flag, and the raw agent-readiness fetch.
The device is guessed from the viewport's label: `tablet`, `phone` / `mobile`,
or `desktop` anywhere in it (`phone-tall` is a phone); any other label falls
back to `formFactor` (mobile is a phone). Phones and tablets also get
`hasTouch`. The strings are Chrome's own for each device (`Mobile Safari` on
phones, an Android tablet without the `Mobile` token, macOS on desktop), with
the Chrome major rewritten to the launched browser so the client hints agree.
`Viewport.userAgent` sends an exact string instead, verbatim. The module is
`src/browser-user-agent.ts` (strings, derivation) plus `src/device-identity.ts`
(the `newContext` options). Playwright derives the platform, platform-version,
and architecture client hints from the UA override and the mobile hint from
`isMobile`; only the brand list stays browser-controlled. Non-Chromium engines
(`playwrightOptions.browser: 'firefox' | 'webkit'`) keep their own identity. A
`lighthouseConfig.emulatedUserAgent` override still wins for Lighthouse.

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

## Pull requests

Push back against mixing different concerns in the same PR. Gravitate toward `gh stack`.
When splitting the PRs, squash first, and split by functionality, not by commit history.

Split a branch into a single `gh stack`, even when its pieces are unrelated:
separate PRs against `main` complicate QA. Order the stack so each PR sits
above anything it depends on or edits heavily. See `gh stack --help`.

When asked to implement something, keep your edits in the main workspace on top of the stack tip, not in your scratchpad:
your changes have to be reviewable, don't be shy.

When committing some changes in functionality related to older PR in the stack, do it in the branch for
the older PR and then `gh sync` and return to the tip of the stack.

The main two points is to keep your changes reviewable locally before they are commited, and keeping `gh stack` well organized when they are commited. So if you end up with some changes in unrelated PRs in the stack, or if you commit something anauthorized before you showed it to the dev, that's going to be your failure to follow this guidance.

## Publishing

See @.claude/commands/deploy.md
