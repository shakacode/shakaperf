HTML report resource bundle
====

This directory contains the source files for the shaka-perf visreg report UI.

To build the React project run...

```
yarn build-compare
```

This will generate `/compare/output/index_bundle.js` and `/compare/output/index.html`.

`index_bundle.js` contains all styles, JS, and the diverged diff worker (with `diff.js` and `diverged.js` inlined as source strings for a blob worker).

`index.html` has nearly everything inlined:
- Base64-encoded Lato fonts
- The full `index_bundle.js` bundle
- Third-party license text (from `index_bundle.js.LICENSE.txt`)

The only external dependency is `config.js` (test data generated per run).

In normal shaka-perf visreg operation, `index.html` is copied and `config.js` is generated into the HTML report directory during a test flow (e.g. when running `shaka-perf visreg compare`). See `/core/command/report.ts` `writeBrowserReport()` for details.

The report output consists of just 2 files:
- `index.html` — self-contained HTML with inlined fonts, bundle, and licenses
- `config.js` — test data (generated per run)

For local development, `src/index.html` provides a lightweight HTML with external `<script src>` references, used by `webpack-dev-server`.
