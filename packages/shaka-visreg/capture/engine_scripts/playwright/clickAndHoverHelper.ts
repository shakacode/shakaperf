import type { PlaywrightPage, Scenario, KeypressSelector } from '../../../core/types.js';

export default async (page: PlaywrightPage, scenario: Scenario) => {
  const hoverSelector = scenario.hoverSelectors || scenario.hoverSelector;
  const clickSelector = scenario.clickSelectors || scenario.clickSelector;
  const keyPressSelector = scenario.keyPressSelectors || scenario.keyPressSelector;
  const scrollToSelector = scenario.scrollToSelector;
  const postInteractionWait = scenario.postInteractionWait; // selector [str] | ms [int]

  if (keyPressSelector) {
    for (const keyPressSelectorItem of ([] as KeypressSelector[]).concat(keyPressSelector)) {
      await page.waitForSelector(keyPressSelectorItem.selector);
      const keys = Array.isArray(keyPressSelectorItem.keyPress) ? keyPressSelectorItem.keyPress : [keyPressSelectorItem.keyPress];
      for (const key of keys) {
        await page.type(keyPressSelectorItem.selector, key);
      }
    }
  }

  if (hoverSelector) {
    for (const hoverSelectorIndex of ([] as string[]).concat(hoverSelector)) {
      await page.waitForSelector(hoverSelectorIndex);
      await page.hover(hoverSelectorIndex);
    }
  }

  if (clickSelector) {
    for (const clickSelectorIndex of ([] as string[]).concat(clickSelector)) {
      await page.waitForSelector(clickSelectorIndex);
      await page.click(clickSelectorIndex);
    }
  }

  if (postInteractionWait) {
    if (parseInt(String(postInteractionWait)) > 0) {
      await page.waitForTimeout(Number(postInteractionWait));
    } else {
      await page.waitForSelector(String(postInteractionWait));
    }
  }

  if (scrollToSelector) {
    await page.waitForSelector(scrollToSelector);
    await page.evaluate((scrollToSelector: string) => {
      document.querySelector(scrollToSelector)!.scrollIntoView();
    }, scrollToSelector);
  }
};
