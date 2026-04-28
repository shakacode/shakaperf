import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled, overrideCSS, interceptImages } from 'shaka-perf/visreg/helpers';

const CAROUSEL_PAUSE_CSS = `
  [data-cy="marketing-carousel-track"] {
    animation: none !important;
    transform: translateX(0) !important;
  }
`;

abTest('Carousel Demo - Without stubbing or overriding CSS', {
  startingPath: '/carousel-demo',
  testTypes: ['perf'],
}, async () => {});


abTest('Carousel Demo - Pause With Override CSS', {
  startingPath: '/carousel-demo',
  testTypes: ['visreg'],
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for carousel track to be visible');
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  annotate('Override default CSS');
  await overrideCSS(page);
  annotate('Inject CSS to pause carousel animation');
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  annotate('Wait for page to settle');
  await waitUntilPageSettled(page);
});

abTest('Carousel Demo - Stub Slider Images', {
  startingPath: '/carousel-demo',
  testTypes: ['visreg'],
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, annotate }) => {
  annotate('Intercept and stub slider images');
  await interceptImages(page);
  annotate('Reload page with image interception active');
  await page.goto(page.url());
  annotate('Wait for carousel track to be visible');
  await page.waitForSelector('[data-cy="marketing-carousel-track"]', { state: 'visible' });
  annotate('Override default CSS');
  await overrideCSS(page);
  annotate('Inject CSS to pause carousel animation');
  await page.addStyleTag({ content: CAROUSEL_PAUSE_CSS });
  annotate('Wait for page to settle');
  await waitUntilPageSettled(page);
});
