# shaka-perf

Frontend performance testing toolkit for web applications. Yarn 4 monorepo.

## Packages

- **shaka-bundle-size** - Bundle size diffing with S3 baseline storage
- **shaka-twin-servers** - Docker-based A/B testing infrastructure
- **shaka-bench** - Benchmarking (placeholder)
- **shaka-visreg** - Visual regression testing (placeholder)
- **demo-ecommerce** - Rails + React demo app

## Commands

```bash
yarn install    # Install dependencies
yarn build      # Build all packages (tsc)
```

## Integration tests
When messing with docker setup and/or logs, run `integration-tests/run-integration-tests-and-compare-logs.sh`
This updates the baseline log in-place. Review changes with `git diff integration-tests/baseline-output.log`
If there are regressions in the logs, check up with the user and address them.

## Code Conventions

- TypeScript strict mode, no ESLint/Prettier
- Zod for runtime validation
- PascalCase for classes/types, camelCase for functions
- Commander.js for CLIs
- In new code don't use docker compose directly, see @packages/shaka-twin-servers/README.md

## Package Structure

```
packages/shaka-[name]/src/
├── cli.ts      # CLI entry point
├── types.ts    # Types + Zod schemas
├── config.ts   # Config loading
├── commands/   # CLI commands
└── helpers/    # Utilities
```

## Publishing

Git tags trigger npm publish: `git tag package-name@version && git push origin --tags`
