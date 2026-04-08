---
name: discover-abtests
description: Crawl a website and auto-generate .abtest.ts files for shaka-visreg visual regression testing. Use this skill whenever the user wants to discover, generate, or scaffold AB tests for a URL — even if they just say "set up tests for localhost:3020", "generate tests for this site", or "create visreg tests".
argument-hint: <url> [depth=2] [output=./ab-tests/] [mode=twin-server|single-server]
---

# discover-abtests

Crawl a target site in Chrome, probe pages interactively to understand their behavior, then generate validated `.abtest.ts` files for `shaka-visreg`.

The goal is to produce tests that _actually work_ — not just syntactically valid files. That's why Phase 1 involves probing in the browser before writing any code: it avoids generating tests for interactions that don't exist, CSS overrides that don't work, or skeleton waits for elements that never appear.

## Bundled resources

| Path                         | When to use                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `scripts/extract-links.js`   | Run via `javascript_tool` to collect internal links from any page          |
| `scripts/probe-lazy-load.js` | Run via `javascript_tool` to test whether scrolling triggers new content   |
| `scripts/parse-report.py`    | Run after `liveCompare` to summarize pass/fail and diff % from report.json |
| `references/patterns.md`     | Read when writing `.abtest.ts` files — contains all 5 code patterns        |
| `references/api.md`          | Read when you need the full `abTest()` config API or helpers reference     |

Read these files as needed rather than trying to keep the full details in mind. The patterns and API reference are too detailed to hold mentally — just load them.

## Inputs

Parse from the user's message:

- **URL** — required (normalize bare domains like `printivity.com` → `http://printivity.com`)
- **depth** — default `2`. Depth 1 = starting page only; depth 2 = starting page + linked pages; depth 3 = one more level out
- **output directory** — default `./ab-tests/`
- **concurrency** — default `4`. Number of browser tabs to probe in parallel.
- **mode** — default `twin-server`. Controls how tests run:
  - `twin-server` — compares control (e.g. `localhost:3020`) vs experiment (e.g. `localhost:3030`)
  - `single-server` — both `--controlURL` and `--experimentURL` set to the same URL; validates test structure without a real A/B pair

If no URL was provided, ask for it before proceeding.

---

## Phase 1: Crawl and probe

Load `mcp__claude-in-chrome__tabs_context_mcp` first to get a tab, then navigate to the URL.

Maintain throughout the crawl:

- `visited`: set of paths already crawled
- `queue`: `[{ path, depth }]`, initialized with `[{ path: '/', depth: 1 }]`
- `claimedSections`: map of `selector → path` — when a section appears on multiple pages, only the first page to claim it gets a test for it
- `knownLoadingSelectors`: set of CSS selectors for spinners, skeletons, and loading indicators discovered on any page so far (e.g. `[data-cy="spinner"]`, `.skeleton`, `[aria-label="Loading"]`). Grows as new ones are found. On every subsequent page, wait for all of these to be absent before proceeding with probing or navigation.

Process the queue in BFS order, **probing up to `concurrency` pages in parallel**. Each batch:

1. Dequeue up to `concurrency` entries not yet visited.
2. Open each in its own tab (`tabs_create_mcp` for tabs 2–N; reuse existing for first).
3. Run steps below on all tabs concurrently, then merge `claimedSections` before next batch.
4. Close extra tabs after each batch.

For each page in the batch:

**1. Skip** if already visited or `depth > crawlDepth`.

**2. Navigate** and mark visited.

**3. Extract internal links** — run `scripts/extract-links.js` via `javascript_tool`. If `depth < crawlDepth`, enqueue new paths as `{ path, depth: depth + 1 }`.

**4. Probe the page** — complete all steps below _in sequence_ beginning with step 4a: scrolling for lazy-loaded-content, _before_ navigating away. Do not skip steps or defer them to a later visit.

**4a. Check for lazy-loaded content** (always, every page):
Use `scripts/probe-lazy-load.js`. Wait for `networkidle` first — probing during an in-flight API call gives false results. Then scroll incrementally using **real mouse scroll actions** (not `window.scrollTo` in JS) — IntersectionObserver-based lazy loaders only fire on genuine scroll events; a JS jump bypasses them. Scroll 10 ticks at a time via `mcp__claude-in-chrome__scroll`, wait 500ms between each, until `window.scrollY + window.innerHeight >= document.body.scrollHeight`. Wait 2 more seconds, compare image count and scroll height to baseline. Record the result. Only add scroll logic to the generated test if content actually increased.

**4b. Wait for loading indicators to clear** (always, every page):
Check the page for any spinners, skeleton screens, or loading indicators. Use `javascript_tool` to look for common patterns: elements with `aria-label="Loading"`, `role="progressbar"`, class names containing `skeleton`, `spinner`, `loading`, `placeholder`. If you find any, add their selectors to `knownLoadingSelectors` and wait for them to disappear (`waitForSelector` with `state: 'hidden'`) before proceeding. Also check all selectors already in `knownLoadingSelectors` — wait for each to be absent on this page too. Do not navigate away until all loading indicators are gone.

**4c. CSS animation overrides** (if you see moving elements): inject via `javascript_tool` and screenshot to confirm it stopped. Only include in the test if the screenshot shows the element frozen.

**4d. CTA clicks** (if you see interactive elements): use `find` to confirm the element exists, click, and verify the effect. Only include if the click produced a visible result.

**4e. Page height**: run `document.body.scrollHeight` and record it but only do that after real scrolling in step 4a. If >~3000px, plan named section selectors instead of `'document'`.

**5. Record** for each page:

- Path, human-readable name
- `data-cy` attributes, `id`s, and stable structural landmarks
- Which interactions/CSS overrides were confirmed working vs. tried and failed
- Whether lazy load was confirmed (from 4a), loading indicators found (from 4b), any animations
- **Shared section deduplication**: for each selector identified, check `claimedSections`:
  - Not claimed → add to this page's plan, register it
  - Already claimed → exclude from this page's plan, record `{ selector, skippedOn, alreadyCoveredBy }`
- **Product/detail pages**: only claim the unique top section (configurator, carousel). Don't claim shared lower sections (reviews, FAQ, footer).

**Hard limits**: max 40 unique paths.

Skip only these:

- External URLs (third-party links in a different hostname)
- Non-page paths: phone numbers (`tel:`), mailto links, anchors-only (`#section`)
- Admin panels (e.g. `/admin` but go to `/login` normally)
- Auth callbacks (e.g. `/auth/callback`, `/oauth`)
- API routes (e.g. `/api/`, `.json` endpoints)
- Paginated duplicates (e.g. `/products?page=2` when `/products` is already queued)
- Pages that require authentication to view — check by navigating and seeing if it redirects to login

Do **not** skip pages just because they seem "boring" or static.

---

## Phase 2: Generate test files

Read `references/patterns.md` before writing any `.abtest.ts` files — it has the correct pattern for each scenario (simple snapshot, selectors, interaction, lazy-load, carousel).

For each meaningful page or interaction, create one `.abtest.ts` file named `kebab-case-page-name.abtest.ts`. Group multiple `abTest()` calls into one file when they share the same `startingPath`.

**Threshold guidance**: `misMatchThreshold: 0.01` for static pages; `0.05` for pages with dynamic content. Don't generate tests for flows requiring auth.

### Annotation

Always call `annotate('description')` immediately before each action. When a test fails, the report shows **"Failed while \<description\>"** — without annotations the error is a raw stack trace.

Annotate waits, clicks, scrolls, and state changes. Don't annotate every trivial `await`.

---

## Phase 3: Write files

Write each `.abtest.ts` to the output directory using the Write tool.

---

## Phase 4: Validate and fix

For each file, run it and fix failures. Stop after 3 attempts — mark as "needs manual review" if still failing.

**Important**: `shaka-visreg` must be run from the directory containing `visreg.config.ts`. If the user specified an app directory, `cd` there first.

**Run command depends on mode:**

_Twin-server mode_:

```bash
cd <app-directory> && yarn shaka-visreg liveCompare --testFile ab-tests/filename.abtest.ts
```

_Single-server mode_:

```bash
cd <app-directory> && yarn shaka-visreg liveCompare --testFile ab-tests/filename.abtest.ts --controlURL <url> --experimentURL <url>
```

**Read results** using two techniques:

**1. Parse report.json** — run `scripts/parse-report.py` from the app directory:

```bash
python3 .claude/skills/discover-abtests/scripts/parse-report.py
```

**2. Inspect screenshots visually** — use the Read tool on `.png` files directly. This is the fastest way to tell whether a failure is a broken test or a real A/B diff:

- `visreg_data/html_report/experiment_screenshot/`
- `visreg_data/html_report/reference_screenshot/`
- `visreg_data/html_report/experiment_screenshot/failed_diff_*.png`

Always look at screenshots before deciding on a fix. Do not rely on diff percentage alone.

### Acceptance criteria

A test only counts as PASS when **all** of the following are met:

| #   | Criterion                                                                             | Fix if failing                                                                                |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | No loading indicators (spinners, skeletons) visible                                   | Add `waitForLoadState('networkidle')` and/or `waitUntilPageSettled`                           |
| 2   | No mid-animation carousels — frames frozen at deterministic position                  | Add CSS override confirmed in Phase 1                                                         |
| 3   | No missing lazy-loaded content                                                        | Add scroll + networkidle + scroll-to-top (only if Phase 1 confirmed it)                       |
| 4   | Thresholds appropriate — `0.01` static, `0.05` dynamic. Never raise to hide a failure | Fix root cause                                                                                |
| 5   | All selectors resolve without timeout                                                 | Inspect DOM in Chrome, use a more reliable selector                                           |
| 6   | Every non-trivial action is annotated                                                 | Add missing `annotate(...)` calls                                                             |
| 7   | No auth-gated content (login page/access denied in screenshot)                        | Remove the test                                                                               |
| 8   | No unconfirmed interactions — every click/scroll/CSS override validated in Phase 1    | Remove unconfirmed action                                                                     |
| 9   | No empty or near-blank screenshots — must show recognizable UI                        | Check for unhydrated containers, missing scroll, or `overrideCSS` stripping background images |

**Before attempting any fix, look at the diff screenshot.** Two failure types:

1. **Test infrastructure failure** — broken test. Fix it.
2. **Real A/B difference** — test is working correctly. Don't fix — mark PASS (A/B diff).

**Common fixes:**

| Symptom                      | Fix                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------- |
| UI change on one server only | Real A/B diff — mark PASS (A/B diff), do not raise threshold                  |
| Skeleton/spinner visible     | `waitForLoadState('networkidle')`                                             |
| Content missing (lazy)       | scroll + networkidle + scroll-to-top (Phase 1 confirmed only)                 |
| Carousel moving              | CSS override from Phase 1                                                     |
| Selector timeout             | Inspect DOM in Chrome, use more reliable selector                             |
| High diff on dynamic content | `hideSelectors`/`removeSelectors` or wait for settle — do not raise threshold |

---

## Final summary

After all files are validated, print the report below **and** write it to `{output}/DISCOVERY_REPORT.md`.

The "Coverage decisions" section is important — it makes deduplication reasoning transparent so the user can verify nothing was accidentally omitted.

```markdown
## Discovered AB Tests

| File               | Tests | Status          | Notes                              |
| ------------------ | ----- | --------------- | ---------------------------------- |
| homepage.abtest.ts | 2     | PASS            |                                    |
| cart.abtest.ts     | 1     | PASS (A/B diff) | Experiment has new checkout button |
| products.abtest.ts | 1     | NEEDS REVIEW    | Selector timeout on phone viewport |

Statuses:

- **PASS** — no diff, both servers identical
- **PASS (A/B diff)** — test ran correctly and detected a real difference
- **NEEDS REVIEW** — test infrastructure issue (flaky, timeout, broken selector)

Total: N files, M tests (X passing, Y A/B diffs detected, Z needs review)
Output: ./ab-tests/

## Coverage decisions

### Shared sections (tested once)

| Section                    | Tested on            | Skipped on                |
| -------------------------- | -------------------- | ------------------------- |
| `[data-cy="testimonials"]` | `homepage.abtest.ts` | product pages, about page |
| `footer`                   | `homepage.abtest.ts` | all other pages           |

### Pages scoped to unique content only

| Page               | Selector used                      | Reason                                                |
| ------------------ | ---------------------------------- | ----------------------------------------------------- |
| `/products/widget` | `[data-cy="product-configurator"]` | Lower sections covered by representative product page |

### Skipped pages

| Path        | Reason               |
| ----------- | -------------------- |
| `/admin`    | Auth required        |
| `/checkout` | Multi-step auth flow |
```

Then ask: "Would you like me to dig into any failing tests or adjust any of the coverage decisions?"
