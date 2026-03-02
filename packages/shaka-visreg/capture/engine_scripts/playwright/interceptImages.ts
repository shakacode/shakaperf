/**
 * INTERCEPT IMAGES
 * Listen to all requests. If a request matches IMAGE_URL_RE
 * then stub the image with data from IMAGE_STUB_URL
 *
 * Use this in an onBefore script E.G.
  ```
  export default async function(page, scenario) {
    const { default: interceptImages } = await import('./interceptImages.js');
    interceptImages(page, scenario);
  }
  ```
 *
 */

import fs from 'node:fs';
import path from 'node:path';

const IMAGE_URL_RE = /\.gif|\.jpg|\.png/i;
const IMAGE_STUB_URL = path.resolve(import.meta.dirname, '../../imageStub.jpg');
const IMAGE_DATA_BUFFER = fs.readFileSync(IMAGE_STUB_URL);
const HEADERS_STUB = {};

export default async function (page, scenario) {
  page.route(IMAGE_URL_RE, route => {
    route.fulfill({
      body: IMAGE_DATA_BUFFER as any,
      headers: HEADERS_STUB,
      status: 200
    });
  });
}
