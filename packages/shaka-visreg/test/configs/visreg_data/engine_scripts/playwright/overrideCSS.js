/**
 * OVERRIDE CSS
 * Apply this CSS to the loaded page, as a way to override styles.
 *
 * Use this in an onReady script E.G.
  ```
  module.exports = async function(page, scenario) {
    await require('./overrideCSS')(page, scenario);
  }
  ```
 *
 */

const VISREG_TEST_CSS_OVERRIDE = `
  html {
    background-image: none;
  }
`;

module.exports = async (page, scenario) => {
  // inject arbitrary css to override styles
  await page.addStyleTag({
    content: VISREG_TEST_CSS_OVERRIDE
  });

  console.log('VISREG_TEST_CSS_OVERRIDE injected for: ' + scenario.label);
};
