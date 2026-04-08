---
name: discover-abtests
description: Crawl a website and auto-generate .abtest.ts files for shaka-visreg visual regression testing. Use this skill whenever the user wants to discover, generate, or scaffold AB tests for a URL — even if they just say "set up tests for localhost:3020", "generate tests for this site", or "create visreg tests".
argument-hint: <url> [depth=2] [output=./ab-tests/]
---

# discover-abtests

Crawl a target site in Chrome, probe pages interactively to understand their behavior, then generate validated `.abtest.ts` files for `shaka-visreg`.

The goal is to produce tests that *actually work* — not just syntactically valid files. That's why Phase 1 involves probing in the browser before writing any code: it avoids generating tests for interactions that don't exist, CSS overrides that don't work, or skeleton waits for elements that never appear.

## Inputs

Parse from the user's message:
- **URL** — required (normalize bare domains like `printivity.com` → `http://printivity.com`)
- **depth** — default `2`. Depth 1 = starting page only; depth 2 = starting page + linked pages; depth 3 = one more level out
- **output directory** — default `./ab-tests/`

If no URL was provided, ask for it before proceeding.

---

## Phase 1: Crawl and probe

Load `mcp__claude-in-chrome__tabs_context_mcp` first to get a tab, then navigate to the URL.

Maintain two structures:
- `visited`: set of paths already crawled
- `queue`: `[{ path, depth }]`, initialized with `[{ path: '/', depth: 1 }]`

Process the queue in BFS order. For each entry:

**1. Skip** if path is already in `visited` or `depth > crawlDepth`.

**2. Navigate** to the page, mark path as visited.

**3. Extract internal links** via `mcp__claude-in-chrome__javascript_tool`:
```js
[...document.querySelectorAll('a[href]')]
  .map(a => {
    try { return new URL(a.getAttribute('href'), window.location.href).pathname; } catch { return null; }
  })
  .filter(p => p && !p.startsWith('#'))
  .filter((p, i, arr) => arr.indexOf(p) === i)
```
If `depth < crawlDepth`, enqueue new paths as `{ path, depth: depth + 1 }`.

**4. Probe the page** — try each technique you're considering *before* writing any test code. This saves time: you won't write skeleton waits for spinners that don't exist, or carousel pauses for animations that are already static.

- **CSS animation overrides**: inject via `mcp__claude-in-chrome__javascript_tool` and screenshot to confirm it stopped
  ```js
  const s = document.createElement('style');
  s.textContent = `[data-cy="carousel"] { animation: none !important; transform: translateX(0) !important; }`;
  document.head.appendChild(s);
  ```
  Only include in the test if the screenshot shows the element frozen.

- **CTA clicks**: use `mcp__claude-in-chrome__find` to confirm the element exists, then click and verify the expected navigation or state change happened. Only include if the click produced a visible effect.

- **Skeleton/spinner waits + lazy loading**: if you see loading indicators, first wait for the page's initial network requests to finish before probing for lazy loading. Scrolling while an API call is still in flight won't tell you anything useful. Use this sequence:
  1. Wait for `networkidle` (use the browser's network tab or check spinner count going to 0) before starting the lazy-load probe
  2. Record the image count and `document.body.scrollHeight` before scrolling
  3. Scroll to the bottom: `window.scrollTo(0, document.body.scrollHeight)`
  4. Wait ~2 seconds, then check image count and scroll height again
  5. If either increased, scrolling triggered a lazy load — the test needs to scroll

  Only add scroll logic to the generated test if you confirmed that scrolling actually triggered new content to load. If nothing changed, don't add it.

**5. Record** for each page:
- Path, human-readable name
- `data-cy` attributes and stable selectors found
- Which interactions/CSS overrides were confirmed working vs. tried and failed
- Whether the page has dynamic content, loading states, or animations

**Hard limits**: max 30 unique paths. Skip: admin panels, auth callbacks, API routes, paginated duplicates (e.g. `/products?page=2` when `/products` is already queued).

---

## Phase 2: Generate test files

For each meaningful page or interaction, create one `.abtest.ts` file named `kebab-case-page-name.abtest.ts`.

Group multiple `abTest()` calls into one file when they share the same `startingPath`.

**Threshold guidance**: `misMatchThreshold: 0.01` for static pages; `0.1` for pages with dynamic content. Don't generate tests for: login pages, checkout flows requiring auth, 404s, or pages that errored.

### Patterns

**Simple snapshot** (most pages):
```typescript
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Page Name', {
  startingPath: '/path',
  options: { visreg: { delay: 50, misMatchThreshold: 0.1 } },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
```

**With specific selectors** (when notable sections exist):
```typescript
abTest('Page Name', {
  startingPath: '/path',
  options: { visreg: { selectors: ['[data-cy="hero"]', 'document'], delay: 50, misMatchThreshold: 0.01 } },
}, async ({ page }) => {
  await waitUntilPageSettled(page);
});
```

**Interaction test** (click confirmed working in Phase 1):
```typescript
import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Click [Button] on [Page]', {
  startingPath: '/start',
  options: { visreg: { misMatchThreshold: 0.1, maxNumDiffPixels: 5 } },
}, async ({ page, testType }) => {
  await page.waitForSelector('[data-cy="element"]');
  await page.click('text=Button Text');
  await page.waitForURL('**/expected-path');
  if (testType === TestType.VisualRegression) {
    await waitUntilPageSettled(page);
  }
});
```

**Page with lazy-loaded content** (scroll confirmed to trigger new content in Phase 1):
```typescript
abTest('Page Name', {
  startingPath: '/path',
  options: { visreg: { delay: 50, misMatchThreshold: 0.1 } },
}, async ({ page }) => {
  // Scroll to bottom triggers the lazy load, networkidle waits for it to finish.
  // Scroll back to top so the screenshot starts from the top of the page.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitUntilPageSettled(page);
});
```

**Carousel/animation** (CSS override confirmed in Phase 1):
```typescript
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled, overrideCSS } from 'shaka-visreg/helpers';

const PAUSE_CSS = `
  [data-cy="carousel-track"] { animation: none !important; transform: translateX(0) !important; }
`;

abTest('Carousel on [Page]', {
  startingPath: '/path',
  options: { visreg: { delay: 50, misMatchThreshold: 0.1 } },
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="carousel-track"]', { state: 'visible' });
  await overrideCSS(page);
  await page.addStyleTag({ content: PAUSE_CSS });
  await waitUntilPageSettled(page);
});
```

---

## Phase 3: Write files

Write each `.abtest.ts` to the output directory using the Write tool.

---

## Phase 4: Validate and fix

For each file, run it and fix failures. Stop after 3 attempts — mark as "needs manual review" if still failing.

**Important**: `shaka-visreg` must be run from the directory containing `visreg.config.ts` (the app directory, e.g. `demo-ecommerce/`). If the user specified an app directory, `cd` there first. The output directory for test files should be relative to that same directory.

**Run:**
```bash
cd <app-directory> && yarn shaka-visreg liveCompare --testFile ab-tests/filename.abtest.ts
```

Use `--testFile` (not `--testPathPattern`) when pointing at a specific file path.

**Read results** from `visreg_data/html_report/report.json`.

**Before attempting any fix, look at the diff screenshot** (`visreg_data/html_report/experiment_screenshot/failed_diff_*.png`) to determine the failure cause. There are two fundamentally different failure types:

1. **Test infrastructure failure** — the test itself is broken (timeout, wrong selector, flaky timing). Fix the test.
2. **Real A/B difference** — the test ran correctly and detected a genuine difference between control and experiment. Do not fix — this is the test doing its job.

**Common fixes:**

| Symptom | Fix |
|---|---|
| Diff shows a UI change (new element, layout shift, copy change) on one server but not the other | This is a real A/B diff — the test is working correctly. Mark as **PASS (A/B diff)** and note what changed. Do not raise the threshold to suppress it. |
| Skeleton/spinner still visible | Use `await page.waitForLoadState('networkidle')` — waiting for a spinner selector to hide times out on slow servers and is fragile |
| Content missing (lazy-loaded) | `scrollTo(bottom)` + `waitForLoadState('networkidle')` + `scrollTo(0,0)` — only add if scroll triggered new content during Phase 1 probing |
| Lazy images not loaded | Same as above — scroll + networkidle is more reliable than increasing `delay` |
| Carousel still moving | Add CSS override (see pattern above) |
| Selector timeout | Inspect DOM in Chrome, use a more reliable selector |
| High diff on dynamic content | Increase `misMatchThreshold` or `maxNumDiffPixels` |
| Mismatch on one viewport only | Add viewport-specific selector wait or raise threshold for that viewport |

---

## Final summary

After all files are validated, print:

```
## Discovered AB Tests

| File | Tests | Status | Notes |
|------|-------|--------|-------|
| homepage.abtest.ts | 2 | PASS | |
| cart.abtest.ts | 1 | PASS (A/B diff) | Experiment has new checkout button |
| products.abtest.ts | 1 | NEEDS REVIEW | Selector timeout on phone viewport |

Statuses:
- **PASS** — no diff, both servers identical
- **PASS (A/B diff)** — test ran correctly and detected a real difference between control and experiment
- **NEEDS REVIEW** — test infrastructure issue (flaky, timeout, selector broken)

Total: N files, M tests (X passing, Y A/B diffs detected, Z needs review)
Output: ./ab-tests/
```

Then ask: "Would you like me to dig into any failing tests or add interactions for specific elements?"
