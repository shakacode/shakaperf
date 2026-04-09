/**
 * Probe page sections and score candidate CSS selectors for visual regression tests.
 *
 * Run via mcp__claude-in-chrome__javascript_tool on the target tab AFTER the page
 * has fully loaded (networkidle + scrolling complete).
 *
 * Returns an array of scored candidate sections sorted by vertical position,
 * with overlap removed. The agent should review these candidates and apply
 * AI visual heuristics before finalizing selector choices.
 *
 * Usage:
 *   const result = await javascript_tool({ code: fs.readFileSync('probe-sections.js', 'utf8') });
 *   // result.sections = [{ selector, height, width, widthRatio, score, depth, absTop, ... }]
 */
(function () {
  const PAGE_HEIGHT = document.body.scrollHeight;
  const PAGE_WIDTH = document.body.scrollWidth || document.documentElement.clientWidth;

  // Find layout root
  const layoutRoot =
    document.querySelector('.layout-container') ||
    document.querySelector('[class*="layout"]') ||
    document.querySelector('main') ||
    document.querySelector('#app') ||
    document.body;

  const candidates = [];

  function buildSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      const classes = el.className
        .trim()
        .split(/\s+/)
        .filter(function (c) {
          return c.length > 2 && !c.startsWith('__') && !c.startsWith('css-') && !/^[a-f0-9]{6,}$/i.test(c);
        });
      if (classes.length > 0) return '.' + classes[0];
    }
    if (el.getAttribute('data-cy')) return '[data-cy="' + el.getAttribute('data-cy') + '"]';
    if (el.getAttribute('role')) return el.tagName.toLowerCase() + '[role="' + el.getAttribute('role') + '"]';
    return null;
  }

  function collectCandidates(parent, depth) {
    for (var i = 0; i < parent.children.length; i++) {
      var child = parent.children[i];
      var tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META' || tag === 'NOSCRIPT') continue;

      var rect = child.getBoundingClientRect();
      var height = rect.height;
      var width = rect.width;

      // Skip invisible or trivially small
      if (height < 20 || width < 50) continue;
      var style = window.getComputedStyle(child);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      var selector = buildSelector(child);
      if (!selector) continue;

      var matchCount = document.querySelectorAll(selector).length;
      var absTop = Math.round(rect.top + window.scrollY);
      var absBottom = Math.round(rect.bottom + window.scrollY);
      var widthRatio = +(width / PAGE_WIDTH).toFixed(3);

      // Check if element contains a heading (h1-h4) as first meaningful child
      var firstHeading = child.querySelector('h1, h2, h3, h4');
      var hasHeading = firstHeading !== null;

      // Content density
      var textLen = (child.textContent || '').trim().length;
      var imgCount = child.querySelectorAll('img, svg, canvas, video').length;

      candidates.push({
        selector: selector,
        tagName: tag.toLowerCase(),
        depth: depth,
        absTop: absTop,
        absBottom: absBottom,
        height: Math.round(height),
        width: Math.round(width),
        widthRatio: widthRatio,
        matchCount: matchCount,
        hasSemanticName: /hero|slider|nav|header|footer|sidebar|form|content|wrapper|container|section|list|map|review|amenity|amenities|calendar|banner|breadcrumb|description|gallery|search|property|rate|book|rental|show/i.test(selector),
        hasHeading: hasHeading,
        childCount: child.children.length,
        textContentLength: textLen,
        imgCount: imgCount,
        position: style.position,
      });

      // Recurse deep into the DOM to find well-scoped sections
      if (depth < 10 && child.children.length > 0 && height > 100) {
        collectCandidates(child, depth + 1);
      }
    }
  }

  collectCandidates(layoutRoot, 0);

  // Score each candidate
  candidates.forEach(function (c) {
    var score = 0;

    // SIZE: prefer 100-800px (visual section sweet spot)
    if (c.height >= 100 && c.height <= 800) score += 30;
    else if (c.height >= 50 && c.height < 100) score += 10;
    else if (c.height > 800 && c.height <= 1500) score += 15;
    else if (c.height > 1500) score -= 10; // too tall — children should be preferred

    // WIDTH: full-width main sections or sidebar-width
    if (c.widthRatio >= 0.9) score += 20;
    else if (c.width >= 300 && c.width <= 500 && (c.position === 'absolute' || c.position === 'sticky' || c.position === 'fixed')) score += 15;
    else if (c.widthRatio >= 0.5) score += 10;

    // DEPTH: shallower = more likely a top-level section
    if (c.depth === 0) score += 15;
    else if (c.depth === 1) score += 10;
    else if (c.depth === 2) score += 5;

    // SEMANTIC NAME
    if (c.hasSemanticName) score += 10;

    // HEADING: sections with headings are usually well-scoped
    if (c.hasHeading) score += 10;

    // CONTENT DENSITY
    if (c.textContentLength > 100) score += 10;
    else if (c.textContentLength > 30) score += 5;

    // IMAGES: visual content
    if (c.imgCount >= 2) score += 5;

    // UNIQUENESS
    if (c.matchCount === 1) score += 10;
    else if (c.matchCount <= 3) score += 5;
    else score -= 5;

    // CHILD ELEMENTS: containers are better than leaves
    if (c.childCount >= 3) score += 5;

    // PENALTIES
    if (c.widthRatio < 0.3 && c.position !== 'absolute' && c.position !== 'sticky' && c.position !== 'fixed') score -= 20;
    if (c.height < 50) score -= 15;
    if (c.textContentLength === 0 && c.imgCount === 0) score -= 10; // empty wrapper

    c.score = score;
  });

  // Sort by score descending
  candidates.sort(function (a, b) {
    return b.score - a.score || a.absTop - b.absTop;
  });

  // De-overlap: prefer multiple smaller sections over one giant container.
  // First pass: collect all candidates >=20 score, skipping elements >1500px tall
  // (their children should cover the same area with better granularity).
  // Second pass: if any vertical range is uncovered, allow the large parent back in.
  var selected = [];
  var coveredRanges = [];

  // Pass 1: select non-giant candidates without >50% overlap
  for (var i = 0; i < candidates.length && selected.length < 15; i++) {
    var c = candidates[i];
    if (c.score < 20) continue;
    if (c.height > 1500) continue; // skip giants in first pass

    var dominated = coveredRanges.some(function (range) {
      var overlapStart = Math.max(range.top, c.absTop);
      var overlapEnd = Math.min(range.bottom, c.absBottom);
      var overlapHeight = overlapEnd - overlapStart;
      return overlapHeight > c.height * 0.5;
    });

    if (!dominated) {
      selected.push(c);
      coveredRanges.push({ top: c.absTop, bottom: c.absBottom });
    }
  }

  // Pass 2: if a giant element covers a region with NO children selected, add it back
  for (var i = 0; i < candidates.length && selected.length < 15; i++) {
    var c = candidates[i];
    if (c.score < 20 || c.height <= 1500) continue;

    var hasChildCoverage = coveredRanges.some(function (range) {
      return range.top >= c.absTop && range.bottom <= c.absBottom;
    });

    if (!hasChildCoverage) {
      selected.push(c);
      coveredRanges.push({ top: c.absTop, bottom: c.absBottom });
    }
  }

  // Sort selected by vertical position
  selected.sort(function (a, b) {
    return a.absTop - b.absTop;
  });

  return {
    pageHeight: PAGE_HEIGHT,
    pageWidth: PAGE_WIDTH,
    layoutRoot: layoutRoot.tagName + (layoutRoot.className ? '.' + (typeof layoutRoot.className === 'string' ? layoutRoot.className.split(' ')[0] : '') : ''),
    candidateCount: candidates.length,
    sections: selected.map(function (c) {
      return {
        selector: c.selector,
        score: c.score,
        height: c.height,
        width: c.width,
        widthRatio: c.widthRatio,
        depth: c.depth,
        absTop: c.absTop,
        absBottom: c.absBottom,
        matchCount: c.matchCount,
        hasSemanticName: c.hasSemanticName,
        hasHeading: c.hasHeading,
        textContentLength: c.textContentLength,
        imgCount: c.imgCount,
        position: c.position,
        childCount: c.childCount,
      };
    }),
  };
})();
