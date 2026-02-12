/**
 * INTERCEPT IMAGES
 * Listen to all requests. If a request matches IMAGE_URL_RE
 * then stub the image with data from IMAGE_STUB_URL
 *
 * Use this in an onBefore script E.G.
  ```
  import interceptImages from './interceptImages';

  export default async function onBefore(page, scenario) {
    await interceptImages(page, scenario);
  }
  ```
 */

import fs from 'fs';
import path from 'path';
import type { Page, HTTPRequest } from 'puppeteer-core';
import type { Scenario } from '../types';

const IMAGE_URL_RE = /\.gif|\.jpg|\.png/i;
const IMAGE_STUB_URL = path.resolve(__dirname, '../../imageStub.jpg');
const IMAGE_DATA_BUFFER = fs.readFileSync(IMAGE_STUB_URL);
const HEADERS_STUB = {};

export default async function interceptImages(page: Page, _scenario: Scenario): Promise<void> {
  const intercept = async (request: HTTPRequest) => {
    if (IMAGE_URL_RE.test(request.url())) {
      await request.respond({
        body: IMAGE_DATA_BUFFER,
        headers: HEADERS_STUB,
        status: 200
      });
    } else {
      await request.continue();
    }
  };

  await page.setRequestInterception(true);
  page.on('request', intercept);
}
