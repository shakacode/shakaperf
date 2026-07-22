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
page, run with `SHAKAPERF_REAL_CHROME=1` AND `--headed`:

```bash
SHAKAPERF_REAL_CHROME=1 shaka-perf audit --headed --url https://example.com/
```

This drives the installed Chrome (`channel: 'chrome'`) with the automation flag
stripped and forces a visible (headed) window - headless real Chrome is still
fingerprinted and gets the un-auto-solvable interactive challenge. After each
navigation the engine polls up to ~25s for the challenge to clear. It needs a
display (a real desktop), `google-chrome` installed, and is opt-in: **never set
`SHAKAPERF_REAL_CHROME` in CI** - the default bundled Chromium is what CI uses.

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

## Polymorphic Extensibility

Variant-specific behaviour (pipeline/stage renderers, summaries, etc.)
must be configured polymorphically through factory options — no
`switch (name)` dispatchers in shared modules. See the
`polymorphic-extensibility` skill for the rule, the single allowed
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
