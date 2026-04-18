import type { ReportData } from './types';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAH0lEQVR42mNk+M9Qz4ABMI4qHFU4qnBU4ajCUYWUKAQAJWcD/Vm6BdMAAAAASUVORK5CYII=';

export const SAMPLE_DATA: ReportData = {
  meta: {
    title: 'demo-ecommerce · compare',
    generatedAt: new Date().toISOString(),
    controlUrl: 'http://localhost:3020',
    experimentUrl: 'http://localhost:3030',
    durationMs: 287_400,
    cwd: '/Users/dev/projects/demo-ecommerce',
    categories: ['visreg', 'perf'],
  },
  tests: [
    {
      id: 'homepage',
      name: 'Homepage',
      filePath: 'ab-tests/homepage.abtest.ts',
      startingPath: '/',
      controlUrl: 'http://localhost:3020/',
      experimentUrl: 'http://localhost:3030/',
      code: "abTest('Homepage', {\n  startingPath: '/',\n  options: { visreg: { selectors: ['[data-cy=\"hero-section\"]'] } },\n}, async ({ page, annotate }) => {\n  annotate('Wait for homepage to settle');\n  await waitUntilPageSettled(page);\n});",
      status: 'regression',
      durationMs: 14_200,
      categories: [
        {
          category: 'visreg',
          status: 'visual_change',
          visreg: [
            {
              viewportLabel: 'desktop',
              selector: '[data-cy="hero-section"]',
              controlImage: TINY_PNG,
              experimentImage: TINY_PNG,
              diffImage: TINY_PNG,
              misMatchPercentage: 4.2,
              diffPixels: 18_400,
              threshold: 0.1,
            },
          ],
        },
        {
          category: 'perf',
          status: 'regression',
          perf: {
            metrics: [
              { label: 'duration', controlMs: 1240, experimentMs: 1480, pValue: 0.012, hlDiffMs: 240, significant: true },
              { label: 'fcp', controlMs: 580, experimentMs: 620, pValue: 0.18, hlDiffMs: 40, significant: false },
            ],
            controlLighthouseHref: '#',
            experimentLighthouseHref: '#',
            timelineHref: '#',
            diffHrefs: [{ label: 'network', href: '#' }],
          },
        },
      ],
    },
    {
      id: 'cart',
      name: 'Cart',
      filePath: 'ab-tests/cart.abtest.ts',
      startingPath: '/cart',
      controlUrl: 'http://localhost:3020/cart',
      experimentUrl: 'http://localhost:3030/cart',
      code: "abTest('Cart', { startingPath: '/cart' }, async ({ page }) => {\n  await waitUntilPageSettled(page);\n});",
      status: 'improvement',
      durationMs: 11_800,
      categories: [
        {
          category: 'perf',
          status: 'improvement',
          perf: {
            metrics: [
              { label: 'duration', controlMs: 1020, experimentMs: 880, pValue: 0.008, hlDiffMs: -140, significant: true },
            ],
            controlLighthouseHref: '#',
            experimentLighthouseHref: '#',
            timelineHref: '#',
            diffHrefs: [],
          },
        },
      ],
    },
    {
      id: 'product-detail',
      name: 'Product Detail',
      filePath: 'ab-tests/product-detail.abtest.ts',
      startingPath: '/products/1',
      controlUrl: 'http://localhost:3020/products/1',
      experimentUrl: 'http://localhost:3030/products/1',
      code: "abTest('Product Detail', { startingPath: '/products/1' }, async ({ page }) => {\n  await waitUntilPageSettled(page);\n});",
      status: 'no_difference',
      durationMs: 9_400,
      categories: [
        { category: 'visreg', status: 'no_difference', visreg: [] },
        { category: 'perf', status: 'no_difference', perf: { metrics: [], controlLighthouseHref: null, experimentLighthouseHref: null, timelineHref: null, diffHrefs: [] } },
      ],
    },
  ],
};
