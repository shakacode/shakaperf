# Writing Good AB Tests

## What to do when the component you want to capture is below the viewport? Avoid scrolling. 

1. Script an interaction only when the interaction *is* the test. On a virtualized page this is not a style preference: as sections mount, estimated heights are replaced by measured ones and `scrollHeight` moves under you (18,669 → 8,940 px on a real menu page), so fraction-based scrolling overshoots and unmounts everything you meant to assert on.
2. Use 'desktop-tall', 'phone-tall', 'tablet-tall' viewports.
3. Set display:none to elements above the desired component.

### BAD — scroll to compensate for a shrinking page

```typescript
for (let step = 1; step <= 8; step += 1) {
  await page.evaluate((f) => window.scrollTo(0, document.documentElement.scrollHeight * f), step / 8);
  await page.waitForTimeout(200);
}
await page.waitForSelector('.dish-card', { state: 'visible' }); // page has scrolled past every card
```

### GOOD — measure at a tall viewport removing content you don't want

```typescript
const TALL: [string, ...string[]] = ['desktop-tall', 'phone-tall'];
const MENU_CHROME = '#navbar, #page-header';

abTest(
  'Menu page',
  {
    startingPath: '/menus/dinner-menu',
    visregSelectors: ['viewport'],
    config: { perf: { viewports: TALL }, visreg: { viewports: TALL } },
  },
  async ({ page }) => {
    await addDisplayNone(page, MENU_CHROME);
    await waitUntilPageSettled(page);
    await page.waitForSelector('.dish-card', { state: 'visible' });
  },
);
```

Register the tall viewports in `shared.viewportDefinitions` first, and set `viewports` for **every category the test runs** — each reads its own, so a visreg-only override silently leaves a `perf` run on the short viewport.
