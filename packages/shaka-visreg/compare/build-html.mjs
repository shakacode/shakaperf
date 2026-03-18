/**
 * Generates index.html with all assets inlined (fonts, bundle, licenses).
 * Run after webpack build to produce a self-contained HTML template.
 *
 * The only remaining external piece is config.js (test data generated per run),
 * which report.ts injects at report-write time to produce a single-file report.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, 'output');

const srcDir = resolve(__dirname, 'src');
const regularFont = readFileSync(resolve(srcDir, 'assets/fonts/lato-regular-webfont.woff2')).toString('base64');
const boldFont = readFileSync(resolve(srcDir, 'assets/fonts/lato-bold-webfont.woff2')).toString('base64');

const bundle = readFileSync(resolve(outputDir, 'index_bundle.js'), 'utf8');
const license = readFileSync(resolve(outputDir, 'index_bundle.js.LICENSE.txt'), 'utf8');

const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">

    <title>Shaka Vis Reg Report</title>

    <style>
      @font-face {
          font-family: 'latoregular';
          src: url('data:font/woff2;base64,${regularFont}') format('woff2');
          font-weight: 400;
          font-style: normal;
      }
      @font-face {
          font-family: 'latobold';
          src: url('data:font/woff2;base64,${boldFont}') format('woff2');
          font-weight: 700;
          font-style: normal;
      }

      .ReactModal__Body--open {
          overflow: hidden;
      }
      .ReactModal__Body--open .header {
        display: none;
      }

    </style>
  </head>
  <body style="background-color: #E2E7EA">
    <div id="root">

    </div>
    <script>
      function report (report) {
        window.tests = report;
      }
    </script>
    <!--SHAKA_VISREG_CONFIG-->
    <!--
${license}
    -->
    <script>${bundle}</script>
  </body>
</html>
`;

writeFileSync(resolve(outputDir, 'index.html'), html);
console.log('Generated index.html with inlined bundle and fonts');
