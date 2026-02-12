import type { Page } from 'puppeteer-core';
import type { Scenario, KeypressSelector } from '../types';

module.exports = async (page: Page, scenario: Scenario): Promise<void> => {
  const hoverSelector = scenario.hoverSelectors || scenario.hoverSelector;
  const clickSelector = scenario.clickSelectors || scenario.clickSelector;
  const keyPressSelector = scenario.keyPressSelectors || scenario.keyPressSelector;
  const scrollToSelector = scenario.scrollToSelector;
  const postInteractionWait = scenario.postInteractionWait;

  if (keyPressSelector) {
    const selectors = ([] as KeypressSelector[]).concat(keyPressSelector);
    for (const keyPressSelectorItem of selectors) {
      await page.waitForSelector(keyPressSelectorItem.selector);
      await page.type(keyPressSelectorItem.selector, keyPressSelectorItem.keyPress);
    }
  }

  if (hoverSelector) {
    const selectors = ([] as string[]).concat(hoverSelector);
    for (const hoverSelectorIndex of selectors) {
      await page.waitForSelector(hoverSelectorIndex);
      await page.hover(hoverSelectorIndex);
    }
  }

  if (clickSelector) {
    const selectors = ([] as string[]).concat(clickSelector);
    for (const clickSelectorIndex of selectors) {
      await page.waitForSelector(clickSelectorIndex);
      await page.click(clickSelectorIndex);
    }
  }

  if (postInteractionWait && typeof postInteractionWait === 'number') {
    await new Promise<void>(resolve => {
      setTimeout(resolve, postInteractionWait);
    });
  }

  if (scrollToSelector) {
    await page.waitForSelector(scrollToSelector);
    await page.evaluate((selector: string) => {
      document.querySelector(selector)?.scrollIntoView();
    }, scrollToSelector);
  }
};
