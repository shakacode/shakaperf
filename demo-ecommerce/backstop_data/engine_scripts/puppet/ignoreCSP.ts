/**
 * IGNORE CSP HEADERS
 * Listen to all requests. If a request matches scenario.url
 * then fetch the request again manually, strip out CSP headers
 * and respond to the original request without CSP headers.
 * Allows `ignoreHTTPSErrors: true` BUT... requires `debugWindow: true`
 *
 * see https://github.com/GoogleChrome/puppeteer/issues/1229#issuecomment-380133332
 * this is the workaround until Page.setBypassCSP lands... https://github.com/GoogleChrome/puppeteer/pull/2324
 *
 * Use this in an onBefore script E.G.
  ```
  import ignoreCSP from './ignoreCSP';

  export default async function onBefore(page, scenario) {
    await ignoreCSP(page, scenario);
  }
  ```
 */

import https from 'https';
import type { Page, HTTPRequest } from 'puppeteer-core';
import type { Scenario } from '../types';

const agent = new https.Agent({
  rejectUnauthorized: false
});

export default async function ignoreCSP(page: Page, scenario: Scenario): Promise<void> {
  const intercept = async (request: HTTPRequest, targetUrl: string) => {
    const requestUrl = request.url();

    // FIND TARGET URL REQUEST
    if (requestUrl === targetUrl) {
      const cookiesList = await page.cookies(requestUrl);
      const cookies = cookiesList.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      const headers = Object.assign({}, request.headers(), { cookie: cookies });

      const options: RequestInit = {
        headers: headers as HeadersInit,
        body: request.postData(),
        method: request.method(),
        redirect: 'follow',
        // @ts-expect-error - agent is valid for node-fetch
        agent
      };

      const result = await fetch(requestUrl, options);
      const buffer = Buffer.from(await result.arrayBuffer());

      const cleanedHeaders: Record<string, string> = {};
      result.headers.forEach((value, key) => {
        cleanedHeaders[key] = value;
      });
      cleanedHeaders['content-security-policy'] = '';

      await request.respond({
        body: buffer,
        headers: cleanedHeaders,
        status: result.status
      });
    } else {
      await request.continue();
    }
  };

  await page.setRequestInterception(true);
  page.on('request', req => {
    intercept(req, scenario.url);
  });
}
