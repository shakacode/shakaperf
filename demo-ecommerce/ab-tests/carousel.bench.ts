import fs from 'node:fs';
import path from 'node:path';
import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from '../visreg_data/engine_scripts/playwright/onReady.ts';

const CAROUSEL_PAUSE_CSS = `
  [data-cy="marketing-carousel-track"] {
    animation: none !important;
    transform: translateX(0) !important;
  }
`;

const OVERRIDE_CSS = `
  html {
    background-image: none;
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
  await page.addStyleTag({ content: OVERRIDE_CSS });
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  await waitUntilPageSettled(page);
});

const IMAGE_STUB_PATH = path.resolve('visreg_data/imageStub.jpg');
const IMAGE_DATA_BUFFER = fs.existsSync(IMAGE_STUB_PATH) ? fs.readFileSync(IMAGE_STUB_PATH) : Buffer.alloc(0);
const IMAGE_URL_RE = /\.(gif|jpg|png)$/i;

abTest('Carousel Demo - Stub Slider Images', {
  startingPath: '/carousel-demo',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page }) => {
  await page.route(IMAGE_URL_RE, route => {
    route.fulfill({ body: IMAGE_DATA_BUFFER, headers: {}, status: 200 });
  });
  await page.goto(page.url());
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  await page.addStyleTag({ content: OVERRIDE_CSS });
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  await waitUntilPageSettled(page);
});
