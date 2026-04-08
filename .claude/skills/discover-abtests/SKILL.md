---
name: discover-abtests
description: Crawl a website and auto-generate .abtest.ts files for shaka-visreg visual regression testing. Use this skill whenever the user wants to discover, generate, or scaffold AB tests for a URL — even if they just say "set up tests for localhost:3020", "generate tests for this site", or "create visreg tests".
argument-hint: <url> [depth=2] [output=./ab-tests/] [mode=twin-server|single-server]
---

# discover-abtests

Crawl a target site in Chrome, probe pages interactively to understand their behavior, then generate validated `.abtest.ts` files for `shaka-visreg`.

The goal is to produce tests that _actually work_ — not just syntactically valid files. That's why each page is probed in the browser before writing any code: it avoids generating tests for interactions that don't exist, CSS overrides that don't work, or skeleton waits for elements that never appear.

## Bundled resources

| Path                         | When to use                                                                |
| ---------------------------- | -------------------------------------------------------------------------- |
| `scripts/extract-links.js`   | Run via `javascript_tool` to collect internal links from any page          |
| `scripts/probe-lazy-load.js` | Run via `javascript_tool` to test whether scrolling triggers new content   |
| `scripts/parse-report.py`    | Run after `liveCompare` to summarize pass/fail and diff % from report.json |
| `scripts/check-blank-screenshots.py` | Run after `liveCompare` to flag screenshots where 70%+ pixels are one color (blank/empty captures) |
| `references/patterns.md`     | Read when writing `.abtest.ts` files — contains code patterns for all scenarios |
| `references/api.md`          | Read when you need the full `abTest()` config API or helpers reference     |

Read these files as needed rather than trying to keep the full details in mind. The patterns and API reference are too detailed to hold mentally — just load them.

## Inputs

Parse from the user's message:

- **URL** — required (normalize bare domains like `printivity.com` → `http://printivity.com`)
- **depth** — default `2`. Depth 1 = starting page only; depth 2 = starting page + linked pages; depth 3 = one more level out
- **output directory** — default `./ab-tests/`
- **concurrency** — default `4`. Number of browser tabs for parallel link extraction in Phase 1.
- **mode** — default `twin-server`. Controls how tests run:
  - `twin-server` — compares control (e.g. `localhost:3020`) vs experiment (e.g. `localhost:3030`)
  - `single-server` — both `--controlURL` and `--experimentURL` set to the same URL; validates test structure without a real A/B pair

If no URL was provided, ask for it before proceeding.

---

## Phase 1: Crawl (links only)

Load `mcp__claude-in-chrome__tabs_context_mcp` first to get a tab, then navigate to the URL.

This phase ONLY extracts links — no probing, no testing. The goal is to build a list of pages to process.

Maintain throughout:

- `visited`: set of paths already link-extracted
- `queue`: `[{ path, depth }]`, initialized with `[{ path: '/', depth: 1 }]`
- `pageList`: ordered list of unique paths to process in Phase 2

Process the queue in BFS order, **up to `concurrency` pages in parallel**:

1. Dequeue up to `concurrency` entries not yet visited.
2. Open each in its own tab (`tabs_create_mcp` for tabs 2–N; reuse existing for first).
3. For each: navigate, mark visited, run `scripts/extract-links.js` via `javascript_tool`. If `depth < crawlDepth`, enqueue new paths as `{ path, depth: depth + 1 }`.
4. Close extra tabs after each batch.

**Hard limits**: max 40 unique paths.

Skip only these:

- External URLs (different hostname)
- Non-page paths: `tel:`, `mailto:`, anchors-only (`#section`)
- Admin panels (e.g. `/admin` — but go to `/login` normally)
- Auth callbacks (`/auth/callback`, `/oauth`)
- API routes (`/api/`, `.json` endpoints)
- Paginated duplicates (`/products?page=2` when `/products` is already queued)
- Pages that require authentication — check by navigating; if it redirects to login, skip

Do **not** skip pages just because they seem "boring" or static.

---

## Phase 2: Per-page loop

Process pages from `pageList` **one at a time, sequentially**. For each page, complete all five steps (A → B → C → D → E) before moving to the next page.

Maintain across pages:

- `claimedSections`: map of `selector → path` — when a section appears on multiple pages, only the first page to claim it gets a test for it
- `knownLoadingSelectors`: set of CSS selectors for spinners/skeletons/loading indicators discovered on any page so far. Grows as new ones are found.

### Step A — Probe the page

Navigate to the page in Chrome. Complete all probing steps _in sequence_ before writing any code.

**A1. Check for lazy-loaded content** (always, every page):
Use `scripts/probe-lazy-load.js`. Wait for `networkidle` first — probing during an in-flight API call gives false results. Then scroll incrementally using **real mouse scroll actions** (not `window.scrollTo` in JS) — IntersectionObserver-based lazy loaders only fire on genuine scroll events. Scroll 10 ticks at a time via `mcp__claude-in-chrome__scroll`, wait 500ms between each, until `window.scrollY + window.innerHeight >= document.body.scrollHeight`. Wait 2 more seconds, compare image count and scroll height to baseline. Record the result.

**A2. Wait for loading indicators to clear** (always, every page):
Check for spinners, skeleton screens, loading indicators. Use `javascript_tool` to look for: `aria-label="Loading"`, `role="progressbar"`, class names containing `skeleton`, `spinner`, `loading`, `placeholder`. Add any found to `knownLoadingSelectors` and wait for them to disappear. Also check all selectors already in `knownLoadingSelectors`. Do not proceed until all loading indicators are gone.

**A3. CSS animation overrides** (if you see moving elements): inject via `javascript_tool` and screenshot to confirm it stopped. Only include in tests if the screenshot shows the element frozen.

**A4. Page height**: run `document.body.scrollHeight` (after real scrolling in A1). If >~3000px, plan CSS section selectors instead of `'document'`.

**A5. Catalog interactive elements**: find all buttons, form fields, checkboxes, dropdowns, tabs, and modals on the page. Use `javascript_tool` to query for `button`, `a[href]`, `input`, `select`, `textarea`, `[role="tab"]`, `[aria-expanded]`, `[data-toggle]`, etc.

**A6. Test interactions**: click each interactive element and document what happens:
- Button opens a modal or drawer? → record the modal's content and selectors
- Checkbox changes visible state? → record
- Link navigates to another page? → record the destination
- Form has fields? → record field selectors and types
- Tab reveals content? → record
- Anything produces validation errors? → record

**A7. Probe inside modals/expanded UI**: when clicking reveals new UI (modal, drawer, expanded panel), probe THAT UI for its own interactive elements — buttons, forms, links within the modal. No hard depth limit — keep going as long as new testable UI appears. If interacting with the new UI reveals yet more UI, probe that too.

**A8. Check responsive behavior**: note any elements with `display: none` at certain breakpoints. When you find selectors missing on smaller viewports, open a Chrome tab resized to that viewport size and probe the page at that size to discover viewport-specific tests (e.g., mobile-only navigation, collapsed menus, different layouts).

**A9. Record findings** for this page:

- Path, human-readable name
- `data-cy` attributes, `id`s, and stable structural landmarks
- Skeleton/spinner CSS selectors to wait for
- Which interactions were confirmed working vs. tried and failed
- What new UI appeared from interactions (modals, drawers, expanded sections) and what's inside them
- Whether lazy load was confirmed (from A1), loading indicators found (from A2), any animations
- Viewport-specific notes (elements hidden at breakpoints, mobile-only elements)
- **Shared section deduplication**: for each selector, check `claimedSections`:
  - Not claimed → add to this page's plan, register it
  - Already claimed → exclude, record `{ selector, skippedOn, alreadyCoveredBy }`
- **Product/detail pages**: only claim the unique top section (configurator, carousel). Don't claim shared lower sections (reviews, FAQ, footer).

### Step B — Write TODO comments with all probing findings

Read `references/patterns.md` before writing any test code — it has the correct pattern for each scenario.

Create/open the `.abtest.ts` file for this page (e.g., `homepage.abtest.ts`). Write `abTest()` stubs with `// TODO:` comments describing each planned test. Document ALL findings from probing so nothing is lost:

```typescript
import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

// TODO: Hero section snapshot
// - selector: [data-cy="hero"] or .hero-section
// - wait for: .skeleton (found in A2) to disappear
// - threshold: 0.05 (dynamic hero image)
abTest('Homepage Hero', { startingPath: '/', options: { visreg: {} } }, async () => {});

// TODO: Click "Contact Us" button → modal opens
// - confirmed in A6: clicking button.contact-cta opens modal .contact-modal
// - inside modal (A7): form with name, email, message fields
// - .contact-cta is display:none on phone viewport (A8)
// - need desktop-only viewports
abTest('Homepage Contact Modal', { startingPath: '/', options: { visreg: {} } }, async () => {});

// TODO: Fill contact form inside modal
// - fields: input[name="name"], input[name="email"], textarea[name="message"]
// - depends on: opening the modal first (chained interaction)
abTest('Homepage Contact Form Fill', { startingPath: '/', options: { visreg: {} } }, async () => {});
```

Use this coverage checklist to ensure you're not missing tests:

1. **Hero/header** — what the user sees first
2. **Key content sections** — each major section on tall pages
3. **Footer** (when important)
4. **Interactive: clicks** — buttons that open modals, expand sections, navigate
5. **Interactive: modals** — probe and test elements inside modals/drawers too
6. **Interactive: forms** — fill fields and capture the filled state
7. **Interactive: validation** — submit empty required forms to capture error states
8. **Interactive: chained** — click → new UI → interact with the new UI

### Threshold guidance

- `0.01` — static content (legal pages, about text, documentation)
- `0.05` — standard pages (hero images, structured layouts)
- `0.1` — highly dynamic content (listing cards, deal cards, pages with varying image counts)

Never raise a threshold to hide a real failure — fix the root cause.

### Annotation

Always call `annotate('description')` immediately before each action. When a test fails, the report shows **"Failed while \<description\>"** — without annotations the error is a raw stack trace.

Annotate waits, clicks, scrolls, fills, and state changes. Don't annotate every trivial `await`.

### Step C — Implement and validate tests one at a time

Implement each TODO stub directly in the real `.abtest.ts` file, then validate it using `--filter` to run only that test by name:

1. **Implement** the TODO stub — replace the empty `async () => {}` with the real test body
2. **Run** with `--filter` to execute only this test (the filter is a regex matched against the test name):

   _Twin-server mode_:
   ```bash
   cd <app-directory> && yarn shaka-visreg liveCompare --testFile ab-tests/<page>.abtest.ts --filter "Homepage Hero"
   ```

   _Single-server mode_:
   ```bash
   cd <app-directory> && yarn shaka-visreg liveCompare --testFile ab-tests/<page>.abtest.ts --filter "Homepage Hero" --controlURL <url> --experimentURL <url>
   ```

3. **Quick check**: read the screenshot to verify real content was captured (not blank)
4. **If pass** → move on to the next TODO stub
5. **If fail** → debug and fix (up to 3 attempts), then mark NEEDS REVIEW if still failing

**Important**: `shaka-visreg` must be run from the directory containing `visreg.config.ts`. If the user specified an app directory, `cd` there first.

**After every test run**, execute these checks:

**1. Parse report.json**:

```bash
python3 .claude/skills/discover-abtests/scripts/parse-report.py
```

**2. Check for blank screenshots** — use `--report` to scope to the screenshots from this run:

```bash
python3 .claude/skills/discover-abtests/scripts/check-blank-screenshots.py --report visreg_data/html_report/report.json
```

The script flags screenshots where 70%+ of pixels share one color — a strong signal the capture got an empty container, unhydrated page, or missed lazy-loaded content. Exit code 1 means blanks were found.

A test that passes (0 diff) can still be broken if both control and experiment captured a blank page. **Do not dismiss blank flags as false positives without visually confirming the screenshot shows real content.** A tall page with 90%+ same-color pixels almost certainly has missing lazy-loaded content, even if probing didn't detect lazy loading — probing only counts `<img>` tags; sites also lazy-load entire content sections via IntersectionObserver on `<div>` containers.

When blanks are flagged, **read the screenshot with the Read tool** before deciding. Then fix:
- Hero/header with empty space below → add scrolling + `waitForLoadState('networkidle')` (the blank screenshot is ground truth, even if probing said "no lazy loading")
- Selector targets an empty container → wait for content to load, or use a different selector
- Element is `display:none` on some viewports → split into viewport-scoped tests

**3. Inspect screenshots visually** — use the Read tool on `.png` files:

- `visreg_data/html_report/experiment_screenshot/`
- `visreg_data/html_report/reference_screenshot/`
- `visreg_data/html_report/experiment_screenshot/failed_diff_*.png`

Always look at screenshots before deciding on a fix. Do not rely on diff percentage alone.

### Step D — Full-file validation

After all TODO stubs are implemented:

1. Run `shaka-visreg liveCompare --testFile ab-tests/<page>.abtest.ts` with ALL tests in the file
2. Run `parse-report.py` and `check-blank-screenshots.py`
3. If tests that passed individually now fail in combination → debug and fix (timing issues, shared state, etc.)

### Step E — Coverage comparison (loop until covered)

1. Open the visreg HTML report (`visreg_data/html_report/index.html`) in Chrome
2. Open the live page in another Chrome tab
3. Go through the report images and compare with the live page to find:
   - Missing page sections (important content not captured by any test)
   - Missing interactions (buttons, forms, modals that should be tested but aren't)
   - Blank or mostly-white screenshots (missing lazy content)
4. **If gaps found** → go back to Step B: add new TODO stubs for the missing coverage, then implement them through Steps C-D, and repeat Step E
5. **If coverage is satisfactory** → move to the next page

### Acceptance criteria

A test only counts as PASS when **all** of the following are met:

| #   | Criterion                                                                             | Fix if failing                                                                                |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | No loading indicators (spinners, skeletons) visible                                   | Add `waitForLoadState('networkidle')` and/or `waitUntilPageSettled`                           |
| 2   | No mid-animation carousels — frames frozen at deterministic position                  | Add CSS override confirmed in probing                                                         |
| 3   | No missing lazy-loaded content                                                        | Add scroll + networkidle + scroll-to-top. Blank screenshot check is ground truth — add scrolling even if probing didn't detect it |
| 4   | Thresholds appropriate — `0.01` static, `0.05` dynamic, `0.1` very dynamic            | Fix root cause                                                                                |
| 5   | All selectors resolve without timeout                                                 | Inspect DOM in Chrome, use a more reliable selector                                           |
| 6   | Every non-trivial action is annotated                                                 | Add missing `annotate(...)` calls                                                             |
| 7   | No auth-gated content (login page/access denied in screenshot)                        | Remove the test                                                                               |
| 8   | No unconfirmed interactions — every click/scroll/CSS override validated in probing     | Remove unconfirmed action                                                                     |
| 9   | No blank screenshots (verified by `check-blank-screenshots.py --report`)              | If 70%+ same color: add scroll/networkidle for lazy content, switch selector, or split by viewport |

**Before attempting any fix, look at the diff screenshot.** Two failure types:

1. **Test infrastructure failure** — broken test. Fix it.
2. **Real A/B difference** — test is working correctly. Don't fix — mark PASS (A/B diff).

### Common fixes

| Symptom                                        | Fix                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| UI change on one server only                   | Real A/B diff — mark PASS (A/B diff), do not raise threshold                  |
| Skeleton/spinner visible                       | `waitForLoadState('networkidle')`                                             |
| Content missing (lazy)                         | scroll + networkidle + scroll-to-top — blank screenshot is ground truth       |
| Carousel moving                                | CSS override from probing                                                     |
| Selector timeout                               | Inspect DOM in Chrome, use more reliable selector                             |
| High diff on dynamic content                   | `hideSelectors`/`removeSelectors` or wait for settle — do not raise threshold |
| Selector not found on some viewports           | Element is `display:none` at that breakpoint — split into viewport-scoped tests (see patterns.md) |
| Blank/near-blank screenshot (70%+ same color)  | Missing lazy content, empty container, or wrong selector — add scroll/networkidle or pick a different selector |
| `Cannot type text into input[type=number]`     | Use numeric-only strings: `'5551234567'` not `'555-123-4567'`                 |
| `button:has-text("X")` matches multiple        | Use `page.getByLabel()`, `page.getByRole()`, or more specific CSS selector    |
| `Timeout 60000ms on page.goto`                 | Server too slow — page takes too long to respond                              |
| `size: isDifferent`                            | Dynamic content changes height between renders; often unfixable in single-server mode, mark NEEDS REVIEW |
| `strict mode violation`                        | Multiple elements match — use `.first()` or more specific selector            |

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
