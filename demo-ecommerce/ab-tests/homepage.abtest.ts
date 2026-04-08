import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

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
}, async ({ page, annotate }) => {
  annotate('Wait for homepage to settle');
  await waitUntilPageSettled(page);
});
