import fs from 'node:fs';
import type { BrowserContext, Scenario, BackstopCookie } from '../../../core/types.js';

export default async (browserContext: BrowserContext, scenario: Scenario) => {
  let cookies: BackstopCookie[] = [];
  const cookiePath = scenario.cookiePath;

  // Read Cookies from File, if exists
  if (cookiePath && fs.existsSync(cookiePath)) {
    cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  }

  // Add cookies to browser
  browserContext.addCookies(cookies);

  console.log('Cookie state restored with:', JSON.stringify(cookies, null, 2));
};
