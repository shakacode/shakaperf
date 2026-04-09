import { abTest, TestType } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-perf/visreg/helpers';

abTest('Homepage', {
  startingPath: '/',
  options: {
    visreg: {
      selectors: [
        '[data-cy="hero-section"]',
        '[data-cy="features-section"]',
        'document',
      ],
      delay: 50,
      misMatchThreshold: 0.01,
    },
  },
}, async ({ page, annotate, testType }) => {
  annotate('Wait for homepage to settle');

  if (testType === TestType.VisualRegression) {
    await waitUntilPageSettled(page);
  }
});
