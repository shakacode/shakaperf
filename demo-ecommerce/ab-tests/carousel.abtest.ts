import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from '../visreg_data/engine_scripts/playwright/onReady.ts';
import overrideCSS from '../visreg_data/engine_scripts/playwright/overrideCSS.ts';
import interceptImages from '../visreg_data/engine_scripts/playwright/interceptImages.ts';

const CAROUSEL_PAUSE_CSS = `
  [data-cy="marketing-carousel-track"] {
    animation: none !important;
    transform: translateX(0) !important;
  }
`;

abTest('Carousel Demo - Pause With Override CSS', {
  startingPath: '/carousel-demo',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page }) => {
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  await overrideCSS(page);
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  await waitUntilPageSettled(page);
});

abTest('Carousel Demo - Stub Slider Images', {
  startingPath: '/carousel-demo',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page }) => {
  await interceptImages(page);
  await page.goto(page.url());
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  await overrideCSS(page);
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  await waitUntilPageSettled(page);
});
