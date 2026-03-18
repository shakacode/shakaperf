HTML report resource bundle
====

This directory contains the source files for the shaka-visreg report UI.

To build the React project run...

```
yarn build-compare
```

This will generate `/compare/output/index_bundle.js` and `/compare/output/index.html`.

`index_bundle.js` contains all styles, JS, and the diverged diff worker (with `diff.js` and `diverged.js` inlined as source strings for a blob worker).

`index.html` is a fully self-contained HTML template with everything inlined:
- Base64-encoded Lato fonts
- The full `index_bundle.js` bundle
- Third-party license text (from `index_bundle.js.LICENSE.txt`)
- A `<!--SHAKA_VISREG_CONFIG-->` placeholder for test data

At report-write time (`/core/command/report.ts` `writeBrowserReport()`), the placeholder is replaced with an inline `<script>` containing the test config data, producing a **single `index.html` file** as the complete report.

For local development, `src/index.html` provides a lightweight HTML with external `<script src>` references, used by `webpack-dev-server`.
