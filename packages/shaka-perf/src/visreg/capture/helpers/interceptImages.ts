/**
 * INTERCEPT IMAGES
 * Listen to all requests. If a request matches IMAGE_URL_RE
 * then stub the image with data from IMAGE_STUB_URL
 *
 * Usage in an abTest (call before page.goto to intercept initial loads):
  ```
  import { interceptImages } from 'shaka-perf/visreg/helpers';

  abTest('My Test', { startingPath: '/' }, async ({ page }) => {
    await interceptImages(page);
    await page.goto(page.url());
  });
  ```
 */

import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';

const IMAGE_URL_RE = /\.gif|\.jpg|\.png/i;
const IMAGE_STUB_URL = path.resolve(__dirname, 'imageStub.jpg');
const IMAGE_DATA_BUFFER = fs.readFileSync(IMAGE_STUB_URL);
const HEADERS_STUB = {};

export async function interceptImages(page: Page): Promise<void> {
  await page.route(IMAGE_URL_RE, route => {
    route.fulfill({
      body: IMAGE_DATA_BUFFER,
      headers: HEADERS_STUB,
      status: 200
    });
  });
}
