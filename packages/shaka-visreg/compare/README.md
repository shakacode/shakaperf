HTML report resource bundle
====

This directory contains the source files for the shaka-visreg report UI.

To build the React project run...

```
yarn build-compare
```

This will generate `/compare/output/index_bundle.js` and `/compare/output/index.html`.

`index_bundle.js` contains all styles, JS, and the diverged diff worker (with `diff.js` and `diverged.js` inlined as source strings for a blob worker).

`index.html` includes base64-inlined Lato fonts — no external font files are needed.

In normal shaka-visreg operation these files will be copied into the correct HTML report directory during a test flow (e.g. when running `shaka-visreg liveCompare`) after bitmap generation has completed. See: `/core/command/report.ts` writeBrowserReport() method for details.

The report output consists of just 3 files:
- `index.html` — self-contained HTML with inlined fonts
- `index_bundle.js` — React app with inlined worker scripts
- `config.js` — test data (generated per run)
