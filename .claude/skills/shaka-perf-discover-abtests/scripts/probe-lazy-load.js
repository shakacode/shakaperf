/**
 * Probe whether scrolling triggers lazy-loaded content on the current page.
 *
 * Run via Claude Chrome javascript_tool or agent-browser eval --stdin in the
 * selected page AFTER the page's initial network requests have
 * settled (wait for networkidle first — probing while an API call is still in
 * flight gives misleading results).
 *
 * IMPORTANT: Use incremental mouse wheel input and waits. IntersectionObserver
 * reacts to intersection changes from user or JavaScript scrolling; large jumps
 * can skip intermediate lazy-loading states. agent-browser scroll uses JavaScript
 * scrolling, so use its mouse wheel command for this workflow.
 *
 * Full probe sequence:
 *
 *   // Step 1 — capture baseline
 *   evaluate the STEP1 expression string via Claude javascript_tool or agent-browser eval --stdin
 *   Save its returned result as before; declarations alone do not execute it.
 *
 *   // Step 2 — scroll down incrementally using mouse scroll actions
 *   //   Loop: use Claude mcp__claude-in-chrome__computer with its scroll action,
 *   //   or agent-browser --session "$AB_SESSION" mouse wheel 500,
 *   //   wait 500ms, then evaluate the AT_BOTTOM expression string.
 *   //   Repeat until at the bottom.
 *
 *   // Step 3 — wait 2s, then capture after-state
 *   evaluate the STEP2 expression string and save its returned result as after.
 *   Use a fresh function scope for each phase.
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
