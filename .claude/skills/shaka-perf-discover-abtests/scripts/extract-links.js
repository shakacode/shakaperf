/**
 * Extract unique internal link pathnames from the current page.
 *
 * Run in the target page via Claude mcp__claude-in-chrome__javascript_tool,
 * or agent-browser --session "$AB_SESSION" eval --stdin.
 * Returns an array of pathname strings (deduped, no hash fragments).
 *
 * Usage:
 *   shaka-perf discover-abtests extract-links |
 *     agent-browser --session "$AB_SESSION" eval --stdin
 * For Claude, pass the printed source to javascript_tool in the selected tab
 * using the session's documented parameters. Preserve its returned links.
 */
[...document.querySelectorAll('a[href]')]
  .map(a => {
    try { return new URL(a.getAttribute('href'), window.location.href).pathname; } catch { return null; }
  })
  .filter(p => p && !p.startsWith('#'))
  .filter((p, i, arr) => arr.indexOf(p) === i);
