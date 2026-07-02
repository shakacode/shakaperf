/**
 * Extract unique internal link pathnames from the current page.
 *
 * Run via mcp__claude-in-chrome__javascript_tool on the target tab.
 * Returns an array of pathname strings (deduped, no hash fragments).
 *
 * Usage:
 *   const links = await javascript_tool({ code: fs.readFileSync('extract-links.js', 'utf8') });
 */
[...document.querySelectorAll('a[href]')]
  .map(a => {
    try { return new URL(a.getAttribute('href'), window.location.href).pathname; } catch { return null; }
  })
  .filter(p => p && !p.startsWith('#'))
  .filter((p, i, arr) => arr.indexOf(p) === i);
