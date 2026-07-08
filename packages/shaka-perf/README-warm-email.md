# Warm email + client report

Two commands that run over a SAVED audit-results directory (the output of
`shaka-perf audit`). They do not measure anything themselves - they re-read
`report.json`, each page's `audit.json`, and the screencast timeline artifacts.

```bash
# Client-facing single-file HTML report (filmstrips + plain language)
shaka-perf client-report --results ./audit-results [--out report.html]

# Email draft + the client report in one run
shaka-perf warm-email --results ./audit-results --client ./client.yaml
```

## The two-renderer model

The same saved audit feeds two reports:

- `self-contained-performance-report.html` - the full technical diagnostic
  (waterfalls, Lighthouse internals, every metric). For us.
- `client-report.html` - the client lens. Drops all technical depth and tells
  each page's story in plain language for a non-technical site owner. This is
  the file you deploy to `<client>.shakaperf.com` and link to in the email.

## client-report

### Design

`client-report` renders the current product-owner-first report: a one-line
"bottom line", three status tiles (Mobile speed / Accessibility / AI
visibility), and three tabs whose cards lead with a plain-language verdict before
any numbers. It reuses the saved audit data (frames, video, a11y crops + scores,
agent factors, and the per-page AI summaries) - no new metrics are collected.

Narrative copy (the bottom line + each tab's verdict) is written by a `claude`
pass (model `sonnet`, one call, cached to
`<results>/client-narrative.json`; `--no-ai-narrative` to skip), with a
deterministic built-in fallback so the report always renders. The cache stores
only the plain AI text; the report is recomposed from the current data each
render, so a re-audit that adds a tab is reflected without stale copy. Delete
`client-narrative.json` (or `client-narrative-v2.json` for audits created before
this rename) to refresh the AI verdict copy. Existing `client-narrative-v2.json`
caches are still read during the transition. The report pulls the Hanken Grotesk
web font from Google Fonts (with a `system-ui` fallback if that CDN is
unreachable); it is otherwise self-contained.

Renders one card per page (worst ~5 in full, the rest as a one-line list):

- An adaptive headline: the problem THIS page actually has (slow main content,
  layout jumps, blank screen, late first paint, sluggish input), worst first.
- A load video: the page's screencast trimmed to the meaningful load window,
  compressed and inlined. Built only when `ffmpeg` is on PATH; silently
  omitted otherwise. It carries time-synced ON-VIDEO captions that narrate the
  load as it plays - blank screen, first content, the biggest piece landing
  (with its seconds), a layout jump, loaded. The cues and their timings are
  derived deterministically from the same story beats as the filmstrip (the
  video clock is navigation-relative, so a cue's time maps straight to
  `video.currentTime`). A `claude` pass - ON by default, model `haiku`, one call
  per report - then rewrites only the WORDS into tighter, page-specific phrasing
  (the timings and beat order never change). The AI rewrite is best-effort: a
  missing/slow/failed `claude`, or output that doesn't line up, leaves the
  built-in captions in place, so report generation never depends on it. Pass
  `--no-ai-captions` for a `claude`-free, fully reproducible report (with the AI
  pass on, the wording varies run to run). The rewrite times out after 180s by
  default; set `SHAKAPERF_CAPTION_TIMEOUT_MS` (milliseconds) to raise it for a
  large multi-page report that keeps falling back.
- A collapsible frame-by-frame strip with the story beats always present:
  blank start, first content (nearest frame to FCP), the LCP frame, the
  settled end, and the biggest layout shifts with their moved regions drawn
  as boxes. Frames come from `artifacts/timeline_frames.json` (written by the
  `build_annotated_timeline` stage); audits without timeline frames still
  render, just without strips.
- Page weight, speed score, CLS when notable, and the audit's AI summary
  sentence.

When the saved audit ran the `accessibility` category, the report grows a second
**Accessibility** tab next to Performance (when no page has a11y data the bytes
are identical to a Performance-only report). Each card shows the Lighthouse
accessibility score, severity counts, cropped screenshot frames of the problem
spots, and a plain-language summary + "what to change" list. The score is
written at audit time; the summary/fixes are a report-time `claude` pass - ON by
default, model `sonnet`, one call per report - that rewrites the raw axe findings
into client language and persists them to `<id>/accessibility-client.json`
(`{ score, summary, fixes }`) plus a site-level `accessibility-site.json`
(`{ summary }`). It is cached: a page whose sidecar already has a summary is
reused, not regenerated, so a re-render over the same audit makes no `claude`
call. To refresh the site summary alone, delete `accessibility-site.json`. To
regenerate a page's summary, clear the `summary`/`fixes` keys from its
`<id>/accessibility-client.json` (deleting the whole file also drops the
audit-time `score`, which only a fresh audit re-writes). Best-effort like the captions: a
missing/slow/failed `claude` leaves the cards on a plain-language issue list
built from the same labels as the crop captions (never the raw axe text). Pass
`--no-ai-a11y` for a `claude`-free run.

On a very tall page the inline screenshot cannot be encoded (AVIF caps each side
at 16384px), so its card renders the score, counts, and summary but no cropped
problem-spot frames - the rest of the card is unaffected.

The report also grows a third **Agent Ready** tab measuring how legible the site
is to AI agents and answer engines (ChatGPT, Claude, Perplexity, Google AI
Overviews) - the data comes from the audit's `agent-readiness` stage (always on
under the `audit` category), so a plain `shaka-perf audit` produces it; with no
agent data on disk the bytes stay identical to before. The stage captures each
page twice - the raw HTML the server sends (a no-JS fetch) and the rendered DOM -
and writes `<id>/agent-readiness.json`. The report scores four categories
(content reachable without JavaScript 40%, crawler access 25%, machine-readable
structure 20%, semantic HTML 15%) into a 0-100 directional diagnostic, with two
honesty gates: a near-empty no-JS shell or a robots.txt that blocks every crawler
caps the score at "poor". The site-level robots.txt / sitemap.xml / llms.txt are
fetched once at report time (same bounded, SSRF-guarded pattern as the favicon).
A report-time `claude` pass (model `sonnet`, cached, `--no-ai-agent` to skip)
rewrites the findings into a plain-language summary + "what to change" list to
`<id>/agent-ready-client.json` and a site `agent-ready-site.json`; without it the
cards fall back to the already-plain line items. The defensible-claims rules live
in `src/audit/stages/agent_readiness/METHODOLOGY.md`.

The output is a single self-contained HTML file (frames inlined as AVIF,
video as base64), typically ~1-2 MB - deployed as a standalone page at
`<client>.shakaperf.com`.

Dual-viewport audits (the default config runs desktop + phone) render only
the phone rows - the report's copy and numbers are phone-framed. Pages whose
audit failed are listed as "We couldn't measure this page" and excluded from
the counts.

`--out` defaults to `<results>/client-report.html`.

## warm-email

Reads the audit plus a free-form client notes file (`--client`, yaml/markdown/
text - who they are, the relationship, names), synthesizes the cross-page perf
picture, and asks the `claude` CLI to draft a short, warm, no-pitch outreach
email. Also writes `client-report.html` so there is a report to deploy and
link to from the draft.

- Requires the `claude` CLI on PATH (same execution pattern as the audit's
  ai_summary stage). `--model` defaults to `sonnet`.
- Output is a markdown draft (`--out`, default `<results>/../warm-email-draft.md`)
  with CLIENT / DETAILS / SUBJECT / BODY / LINK sections. It is a draft by
  design: review it, then copy the BODY into your mail client yourself. The
  BODY signs off with a `<YOUR NAME> | <YOUR TITLE> | ShakaCode` signature
  placeholder and links the report via a `https://<CLIENT>.shakaperf.com`
  placeholder - fill in your name/title and swap in the deployed URL before
  sending.
- The draft then runs through the built-in critique/revise polish loop: two
  panel phases (three professional critics, then three client critics - one
  sub-agent call per critic, run in parallel), rounds alternate Opus and
  Sonnet until no HIGH-priority fixes remain (cap `--polish-rounds` per phase,
  default 3), then one cross-vendor codex pass (skipped with a warning if the
  codex CLI is missing). Identical for every operator; `--no-polish` skips it.
  See README-cold-email.md ("Built-in polish pass") for the full description.
- `--print-prompt` dumps the generation prompt to stderr for debugging (printed
  before the claude call, so it works when generation fails too).

## Module layout

`src/warm-email/`: `synthesis.ts` (cross-page scorecard over the saved
artifacts), `client-report.ts` (report orchestration, artifact IO, frame and
a11y crop preparation, and `buildClientReportModel`), `client-report-renderer.ts`
(the pure templating module over that model), `client-report-model/` (pure
model helpers such as performance problem/status policy),
`client-report-narrative.ts` (the verdict copy: deterministic builder + AI
overlay merge + prompt/parse), `client-report-narrative-ai.ts` (the optional
`claude` narrator), `caption-ai.ts` (the optional `claude` caption rewriter),
`a11y-summary-ai.ts` (the optional `claude` accessibility summary/fixes
rewriter), `generate.ts`
(claude draft generation), `program.ts` / `client-report-program.ts` (CLI
commands). The per-page score/summary sidecar writers live in
`src/audit/stages/accessibility/client-sidecar.ts`. The shared polish loop lives
in `src/email-polish/polish.ts`. Pure logic is unit-tested in
`src/warm-email/__tests__/client-report.test.ts`,
`src/warm-email/__tests__/client-report-a11y.test.ts`,
`src/warm-email/__tests__/caption-ai.test.ts`,
`src/warm-email/__tests__/a11y-summary-ai.test.ts`,
`src/warm-email/__tests__/client-report-renderer.test.ts` (the narrative builder +
renderer), and `src/email-polish/__tests__/polish.test.ts`.
