import { abTest } from 'shaka-shared';
import { waitForAllImages, waitForFontsReady, waitForNoMutations } from 'shaka-perf/visreg/helpers';

const CHANGED_PAGE_VISREG_OPTIONS = {
  viewports: ['desktop', 'phone'],
  visreg: {
    selectors: ['document'],
    readyTimeout: 60_000,
    delay: 250,
    misMatchThreshold: 0.01,
    maxNumDiffPixels: 50,
  },
};

async function primeLazyImages(page) {
  await page.evaluate(`
    (async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const step = Math.max(window.innerHeight, 500);
      const maxY = document.documentElement.scrollHeight - window.innerHeight;

      for (let y = 0; y <= maxY; y += step) {
        window.scrollTo(0, y);
        await delay(100);
      }

      window.scrollTo(0, 0);
    })()
  `);
}

async function waitForVisualReady(page) {
  await Promise.all([
    waitForAllImages(page),
    waitForFontsReady(page),
    waitForNoMutations(page),
  ]);
}

abTest(
  'HiChee home',
  {
    startingPath: '/',
    testTypes: ['visreg', 'perf'],
    options: {
      ...CHANGED_PAGE_VISREG_OPTIONS,
      visreg: {
        ...CHANGED_PAGE_VISREG_OPTIONS.visreg,
        readySelector: '[data-test-id="home-searchbar"], [data-test-id="home-searchbar-mobile"]',
      },
    },
  },
  async ({ page, annotate, testType }) => {
    if (testType !== 'visreg') return;

    annotate('wait for home searchbar');
    await page.waitForSelector('[data-test-id="home-searchbar"], [data-test-id="home-searchbar-mobile"]', {
      state: 'visible',
      timeout: 60_000,
    });
    await waitForVisualReady(page);
    await primeLazyImages(page);
    await waitForVisualReady(page);
  },
);

abTest(
  'HiChee FAQ',
  {
    startingPath: '/faq',
    testTypes: ['visreg', 'perf'],
    options: {
      ...CHANGED_PAGE_VISREG_OPTIONS,
      visreg: {
        ...CHANGED_PAGE_VISREG_OPTIONS.visreg,
        readySelector: 'body',
      },
    },
  },
  async ({ page, annotate, testType }) => {
    if (testType !== 'visreg') return;

    annotate('wait for FAQ heading');
    await page.getByText('How can we help you?').waitFor({ state: 'visible', timeout: 60_000 });
    await waitForVisualReady(page);
  },
);
