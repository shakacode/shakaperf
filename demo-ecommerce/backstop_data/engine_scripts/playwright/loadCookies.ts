import fs from 'fs';
import type { BrowserContext } from 'playwright-core';
import type { Scenario, BackstopCookie } from '../types';

module.exports = async (browserContext: BrowserContext, scenario: Scenario): Promise<void> => {
  let cookies: BackstopCookie[] = [];
  const cookiePath = scenario.cookiePath;

  // Read Cookies from File, if exists
  if (cookiePath && fs.existsSync(cookiePath)) {
    cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
  }

  // Add cookies to browser
  await browserContext.addCookies(cookies);

  console.log('Cookie state restored with:', JSON.stringify(cookies, null, 2));
};
