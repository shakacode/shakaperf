# README

This README would normally document whatever steps are necessary to get the
application up and running.

Things you may want to cover:

* Ruby version

* System dependencies

* Configuration

* Database creation

* Database initialization

* How to run the test suite

* Services (job queues, cache servers, search engines, etc.)

* Deployment instructions

* ...

## Cumulative Istanbul report

Build this demo with `SHAKA_PERF_INSTRUMENT_COVERAGE=1 yarn build`, start Rails,
then run `yarn shaka-perf audit --categories code_coverage --url http://localhost:3000`.
The configured source scope covers components and hooks; the project adapter reuses
Rspack/SWC to generate zero-hit counters for modules tests never import.
Open `audit-results/coverage/index.html` or **All Tests** in the full audit report.
Regenerate with `yarn shaka-perf audit --categories code_coverage --report-only`.
See the [coverage guide](../docs/code-coverage.md) for other layouts and Docker paths.
