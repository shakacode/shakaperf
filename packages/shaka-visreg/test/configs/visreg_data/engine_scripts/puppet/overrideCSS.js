const VISREG_TEST_CSS_OVERRIDE = 'html {background-image: none;}';

module.exports = async (page, scenario) => {
  // inject arbitrary css to override styles
  await page.evaluate(`window._styleData = '${VISREG_TEST_CSS_OVERRIDE}'`);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.type = 'text/css';
    const styleNode = document.createTextNode(window._styleData);
    style.appendChild(styleNode);
    document.head.appendChild(style);
  });

  console.log('VISREG_TEST_CSS_OVERRIDE injected for: ' + scenario.label);
};
