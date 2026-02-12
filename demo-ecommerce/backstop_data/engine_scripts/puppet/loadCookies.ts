import fs from 'fs';
import type { Page } from 'puppeteer-core';
import type { Scenario, BackstopCookie } from '../types';

interface PuppeteerCookie {
  name: string;
  value: string;
  url?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export default async function loadCookies(page: Page, scenario: Scenario): Promise<void> {
  let cookies: BackstopCookie[] = [];
  const cookiePath = scenario.cookiePath;

  // READ COOKIES FROM FILE IF EXISTS
  if (cookiePath && fs.existsSync(cookiePath)) {
    cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
  }

  // MUNGE COOKIE DOMAIN
  const mungedCookies: PuppeteerCookie[] = cookies.map(cookie => {
    const result: PuppeteerCookie = {
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    };

    if (cookie.domain) {
      if (cookie.domain.startsWith('http://') || cookie.domain.startsWith('https://')) {
        result.url = cookie.domain;
      } else {
        result.url = 'https://' + cookie.domain;
      }
    }

    return result;
  });

  // SET COOKIES
  await Promise.all(
    mungedCookies.map(cookie => page.setCookie(cookie))
  );

  console.log('Cookie state restored with:', JSON.stringify(mungedCookies, null, 2));
}
