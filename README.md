# shaka-perf

Performance tools monorepo for React and React on Rails apps.

## Packages

| Package                                           | Description                                                |
| ------------------------------------------------- | ---------------------------------------------------------- |
| [shaka-bundle-size](./packages/shaka-bundle-size) | Bundle size diffing and analysis using loadable components |
| [shaka-twin-server](./packages/shaka-twin-server) | Twin server for performance testing                        |
| [shaka-bench](./packages/shaka-bench)             | Benchmarking tools                                         |
| [shaka-visreg](./packages/shaka-visreg)           | Visual regression testing tools                            |

## Installation

```bash
yarn add shaka-bundle-size
yarn add shaka-twin-server
yarn add shaka-bench
yarn add shaka-visreg
```

## To get started

```bash
yarn install
yarn build
```

## Publishing a New Version

Each package is published independently using git tags. To publish a new version:

1. Update the version in the package's `package.json`
2. Commit the change
3. Create and push a git tag with the format `package-name@version`

```bash
# Example: publishing shaka-bundle-size version 1.2.0
git tag shaka-bundle-size@1.2.0
git push origin shaka-bundle-size@1.2.0
```

The GitHub Action will automatically build and publish the package to npm.

## License

MIT
