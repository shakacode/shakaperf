# shaka-perf

Frontend performance testing toolkit for web applications. Yarn 4 monorepo.

## Packages

- **shaka-perf** - Unified CLI for benchmarking, visual regression, and twin-servers (subcommands: `bench`, `visreg`, `twin-servers`)
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
shaka-perf bench compare        # Performance benchmarking
shaka-perf visreg compare       # Visual regression testing
shaka-perf twin-servers build   # Docker A/B testing infrastructure
```

## Code Conventions

- TypeScript strict mode, no ESLint/Prettier
- Zod for runtime validation
- PascalCase for classes/types, camelCase for functions
- Commander.js for CLIs
- In new code don't use docker compose directly, see @packages/shaka-perf/SETUP-twin-servers.md

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
