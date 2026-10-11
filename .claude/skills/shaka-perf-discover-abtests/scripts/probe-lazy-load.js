/**
 * Probe whether scrolling triggers lazy-loaded content on the current page.
 *
 * Run via Claude Chrome, a permitted Codex browser adapter, Playwright,
 * or equivalent browser tools AFTER the page's initial network requests have
 * settled (wait for networkidle first — probing while an API call is still in
 * flight gives misleading results).
 *
 * IMPORTANT: Use real mouse scroll actions, NOT window.scrollTo() or
 * window.scrollBy() in JS. Many sites use IntersectionObserver-based lazy
 * loaders that only fire on genuine scroll events — JS jumps bypass them and
 * give false negatives.
 *
 * Full probe sequence:
 *
 *   // Step 1 — capture baseline
 *   run STEP1 in the page via Claude javascript_tool, Playwright browser_evaluate, or equivalent
 *
 *   // Step 2 — scroll down incrementally using mouse scroll actions
 *   //   Loop: scroll down 10 ticks via Claude mcp__claude-in-chrome__scroll, documented Codex
 *   //   CUA scrolling, Playwright page.mouse.wheel(), or equivalent user input,
 *   //   wait 500ms, check (window.scrollY + window.innerHeight >= document.body.scrollHeight)
 *   //   Repeat until at the bottom.
 *
 *   // Step 3 — wait 2s, then capture after-state
 *   run STEP2 in the page via Claude javascript_tool, Playwright browser_evaluate, or equivalent
 *
 *   // If after.imageCount > before.imageCount or after.scrollHeight > before.scrollHeight
 *   // → lazy loading confirmed, add scroll pattern to the test.
 */

// STEP 1: capture baseline (run before scrolling)
const STEP1 = `({
  imageCount: document.querySelectorAll('img').length,
  scrollHeight: document.body.scrollHeight
})`;

// STEP 2: check if we've reached the bottom (run after each scroll batch)
const AT_BOTTOM = `(window.scrollY + window.innerHeight >= document.body.scrollHeight)`;

// STEP 3: capture after-state (run ~2s after reaching the bottom)
const STEP2 = `({
  imageCount: document.querySelectorAll('img').length,
  scrollHeight: document.body.scrollHeight
})`;
