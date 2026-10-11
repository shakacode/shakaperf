/**
 * Extract unique internal link pathnames from the current page.
 *
 * Run in the target page via Claude mcp__claude-in-chrome__javascript_tool,
 * Playwright browser_evaluate, or a permitted equivalent browser adapter.
 * Returns an array of pathname strings (deduped, no hash fragments).
 *
 * Usage (Claude javascript_tool input; adapt to the selected browser API):
 *   const links = await javascript_tool({ code: fs.readFileSync('extract-links.js', 'utf8') });
 */
[...document.querySelectorAll('a[href]')]
  .map(a => {
    try { return new URL(a.getAttribute('href'), window.location.href).pathname; } catch { return null; }
  })
  .filter(p => p && !p.startsWith('#'))
  .filter((p, i, arr) => arr.indexOf(p) === i);
