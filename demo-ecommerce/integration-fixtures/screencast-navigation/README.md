# Screencast navigation continuity

Manual audit fixture for the recorder's navigation recovery. It loads the demo,
performs a full same-origin navigation to a product, then navigates to a second
local origin. `127.0.0.1` and `localhost` are different sites, so
`--site-per-process` exercises a renderer swap. Each page paints a labeled color
marker, waits 3.5 seconds (past the recorder retry window), then changes the
marker through a real click. The video should contain INITIAL, SAME ORIGIN,
CROSS ORIGIN, and each label's green AFTER CLICK state.

Build the workspace and demo assets from the repository root:

```sh
nvm use
yarn build
yarn --cwd demo-ecommerce build:prod:consumer
```

Start Rails in one terminal (uses the existing development database; run
`bundle exec rails db:prepare db:seed` first if needed):

```sh
cd demo-ecommerce
RAILS_ENV=development bundle exec rails server -b 127.0.0.1 -p 3067 -P tmp/pids/screencast-investigation.pid
```

Start the second origin in another terminal, from this fixture directory:

```sh
node second-origin.cjs
```

Run the audit from this fixture directory. The default viewports cover desktop
and phone; `--viewport desktop` or `--viewport phone` selects one.

```sh
yarn shaka-perf audit --stages audit,build_annotated_timeline --debug-show-all-frames
```

Open `audit-results/full-report.html` or the per-viewport
`audit-results/*/artifacts/screencast.mp4`. For an initial-navigation-only check,
run this from `demo-ecommerce`:

```sh
yarn shaka-perf audit --url http://127.0.0.1:3067 --filter '^Homepage$' --stages audit,build_annotated_timeline
```
