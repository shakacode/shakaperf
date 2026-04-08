import { abTest } from 'shaka-shared';
import { waitUntilPageSettled } from 'shaka-visreg/helpers';

abTest('Product Detail', {
  startingPath: '/products/1',
  options: {
    visreg: {
      delay: 50,
      misMatchThreshold: 0.1,
    },
  },
}, async ({ page, annotate }) => {
  annotate('Wait for product detail page to settle');
  await waitUntilPageSettled(page);
});
