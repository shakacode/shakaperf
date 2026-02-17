import type { Page } from 'playwright-core';
import type { Scenario, KeypressSelector } from '../types';

export default async function clickAndHoverHelper(page: Page, scenario: Scenario): Promise<void> {
  const hoverSelector = scenario.hoverSelectors || scenario.hoverSelector;
  const clickSelector = scenario.clickSelectors || scenario.clickSelector;
  const keyPressSelector = scenario.keyPressSelectors || scenario.keyPressSelector;
  const scrollToSelector = scenario.scrollToSelector;
  const postInteractionWait = scenario.postInteractionWait;

  if (keyPressSelector) {
    const selectors = ([] as KeypressSelector[]).concat(keyPressSelector);
    for (const keyPressSelectorItem of selectors) {
      await page.waitForSelector(keyPressSelectorItem.selector);
      await page.fill(keyPressSelectorItem.selector, keyPressSelectorItem.keyPress);
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

  if (postInteractionWait) {
    const waitValue = typeof postInteractionWait === 'string'
      ? parseInt(postInteractionWait, 10)
      : postInteractionWait;

    if (waitValue > 0) {
      await page.waitForTimeout(waitValue);
    } else if (typeof postInteractionWait === 'string') {
      await page.waitForSelector(postInteractionWait);
    }
  }

  if (scrollToSelector) {
    await page.waitForSelector(scrollToSelector);
    await page.evaluate((selector: string) => {
      document.querySelector(selector)?.scrollIntoView();
    }, scrollToSelector);
  }
}
