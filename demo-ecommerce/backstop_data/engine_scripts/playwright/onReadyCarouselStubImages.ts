import type { BrowserContext, Page } from 'playwright-core';
import type { Scenario, Viewport } from 'shaka-visreg/core/types';
import interceptImages from './interceptImages';
import overrideCSS from './overrideCSS';
import { waitUntilPageSettled } from './onReady';

const CAROUSEL_PAUSE_CSS = `
  [data-cy="marketing-carousel-track"] {
    animation: none !important;
    transform: translateX(0) !important;
  }
`;

async function onReadyCarouselStubImages(
  page: Page,
  scenario: Scenario,
  _viewport: Viewport,
  _isReference: boolean,
  _browserContext: BrowserContext
): Promise<void> {
  console.log('SCENARIO > ' + scenario.label);

  await interceptImages(page, scenario);
  await page.goto(scenario.url);
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  await overrideCSS(page, scenario);
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  await waitUntilPageSettled(page);
}

export default onReadyCarouselStubImages;
