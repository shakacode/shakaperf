# Compare Bisect Report-Only Design

## Goal

Add `shaka-perf compare bisect --report-only` so a saved compare-bisect run can
regenerate `compare-bisect-results/bisect-report.html` without checking out Git
commits, rebuilding the experiment application, acquiring the twin-server
lease, or running comparison engines.

## Command Contract

```bash
shaka-perf compare bisect --report-only
```

Report-only mode uses the latest run in the existing
`compare-bisect-results` directory. It does not accept or resolve good and bad
refs. Supplying either positional ref with `--report-only` is an error because
the saved session is authoritative.

Normal bisect options that influence measurement, including categories,
filters, endpoint overrides, current-result reuse, dry-run, and good-ref
validation, are not applied in report-only mode. The command loads the current
AB-test configuration only to recreate the compare pipeline stages and report
metadata needed by the renderer.

## Persisted Report Payload

Normal compare-bisect runs atomically write both:

- `compare-bisect-results/bisect-report.json`
- `compare-bisect-results/bisect-report.html`

The JSON sidecar contains the validated, lightweight `BisectReportData` payload
used to render the HTML. Artifacts are already converted to portable data URIs,
so report-only does not depend on files retained under individual commit result
directories.

The JSON sidecar is the only runtime input for report-only. The implementation
does not parse an existing HTML report as a fallback. Missing, malformed, or
schema-invalid JSON fails with a clear message and leaves any existing HTML
untouched.

## Report-Only Data Flow

1. Resolve the configured `compare-bisect-results` directory.
2. Read and validate `session.json` using a focused Node-side bisect-session
   schema introduced with this feature.
3. Read and validate `bisect-report.json` using a focused Node-side report
   payload schema that matches the report shell's bisect contract.
4. Preserve the persisted test cards and portable artifacts from the sidecar.
5. Rebuild the bisect report model from the latest session and persisted cards,
   so updated target state is reflected even if the prior HTML is stale.
6. Refresh generated metadata, mark `meta.reportOnly` as `true`, and render with
   the current report shell.
7. Atomically replace `bisect-report.json`, then atomically replace
   `bisect-report.html`.
8. Print the regenerated report path.

No part of this path prepares a Git range, reads a build manifest, acquires a
twin-server bisect session, checks out a commit, refreshes a server, or invokes
the compare pipeline engines.

## Current-Report Migration

The current demo report predates the JSON sidecar. As a one-time repository
artifact for development and acceptance testing, extract its embedded report
payload and write a compatible
`demo-ecommerce/compare-bisect-results/bisect-report.json`.

This migration is not shipped as a general HTML compatibility path. Future
runs create the sidecar directly, and report-only requires it.

## Atomicity and Errors

JSON and HTML writes use temporary sibling files followed by rename. Validation
happens before either output is replaced. If JSON validation or HTML rendering
fails, the existing report remains available.

Report-only emits focused errors for:

- positional refs supplied with `--report-only`;
- missing `session.json`;
- invalid or unsupported session data;
- missing `bisect-report.json`; and
- invalid or unsupported report payload data.

## Testing

Add focused tests proving that:

- the CLI forwards `--report-only` and rejects positional refs;
- report-only regenerates HTML and marks report metadata correctly;
- persisted cards and artifacts survive regeneration;
- updated session target state is reflected in the regenerated report;
- normal runs atomically write the JSON sidecar with the HTML report;
- invalid or missing inputs do not replace an existing HTML report; and
- report-only never calls Git preparation, twin-server lifecycle operations,
  rebuilds, or comparison engines.

Run the focused bisect tests, the complete relevant package test suite,
`yarn build`, and `git diff --check`.
