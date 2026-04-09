# Selectors strategy

How to choose the CSS selectors that a visreg test will screenshot. Read this during Phase 2 Step A4 (page sections probing) and any time you need to re-evaluate a selector that produced a bad screenshot.

## How to choose selectors

1. **CSS selectors (preferred)** — `selectors: ['.section-class']` captures the element's bounding box thanks to `useBoundingBoxViewportForSelectors: true` in `visreg.config.ts`. The engine automatically calls `scrollIntoViewIfNeeded()` before capture, so manual scroll calls are only needed to trigger lazy loading, not for positioning.

2. **Viewport + scroll (fallback)** — only use `selectors: ['viewport']` if no CSS selector can target the section. See the scroll-to-section pattern in `patterns.md`.

3. **Short pages (<2000px)** — a single `'document'` capture is enough.

4. **Tall pages (>2000px)** — run `scripts/probe-sections.js` to find scored candidates, then apply AI visual heuristics to pick the best selectors.

## Finding selectors for tall pages

Use a two-strategy approach:

**Strategy 1 — Algorithmic probe** (`scripts/probe-sections.js`):
Run via `javascript_tool` after the page loads. It walks the DOM, scores elements by size, width, depth, semantic name, heading inclusion, content density, and uniqueness. Elements >1000px tall are penalized so their children get picked. Returns up to 15 non-overlapping candidates.

**Strategy 2 — AI visual analysis**:
Scroll through the page and identify natural visual sections a user would recognize. For each, find the closest DOM element that wraps it. Evaluate: "If I capture just this element, will the screenshot show recognizable, self-contained UI?"

## Good selector characteristics (what to pick)

- Height 100-800px (a meaningful visual chunk)
- Full-width (>90% of page) for main sections; 300-500px for sidebars
- Shallow in DOM (close to layout root)
- Semantic class name (`hero-slider`, `review-list`, not `_a3f2b`)
- Unique — `querySelectorAll` returns exactly 1 element
- Contains real text/images, not just empty wrappers
- **Includes its heading** — if an `<h2>` sits above, try the parent
- **"Tells a story"** — screenshot makes sense on its own

## Bad selector characteristics (what to avoid)

- Height < 50px — too granular, captures a fragment (e.g., a specs strip)
- `whitePixelPercent > 90%` after capture — mostly empty space
- Width = 0 at some viewports — causes `clip.width = 0` engine error
- Content renders in a child, not the selected element (common with `-container` wrappers)
- Height > 1000px — too tall, split into sub-sections
- **"Would a designer draw a box here?"** — if no, it's not a real section

## Two-column layouts (content + sidebar)

- Capture content column and sidebar as **separate tests**
- Sidebar test should have `viewports: [desktop]` (sidebars typically hidden/repositioned on mobile)
- Detect sidebars: elements with `position: absolute/sticky/fixed` narrower than 50% page width

## Post-capture validation

After running each test, check `parse-report.py` output:

- `whitePixelPercent > 90` → selector captures too much empty space. Try child or sibling.
- `isBottomSeventyPercentWhite = true` → content concentrated at top
- `hadEngineError` with `clip.width = 0` → add viewport restrictions
- **Always read the first screenshot** of a new selector — whitespace metrics alone can miss "technically not blank but visually useless" captures

When a locator might match multiple elements, use `.first()`:

```typescript
await page.locator('.section-class').first().scrollIntoViewIfNeeded();
```
