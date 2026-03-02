/**
 * OVERRIDE CSS
 * Apply this CSS to the loaded page, as a way to override styles.
 *
 * Use this in an onReady script E.G.
  ```
  export default async function(page, scenario) {
    const { default: overrideCSS } = await import('./overrideCSS.js');
    await overrideCSS(page, scenario);
  }
  ```
 *
 */

const BACKSTOP_TEST_CSS_OVERRIDE = `
  html {
    background-image: none;
  }
`;

export default async (page, scenario) => {
  // inject arbitrary css to override styles
  await page.addStyleTag({
    content: BACKSTOP_TEST_CSS_OVERRIDE
  });

  console.log('BACKSTOP_TEST_CSS_OVERRIDE injected for: ' + scenario.label);
};
