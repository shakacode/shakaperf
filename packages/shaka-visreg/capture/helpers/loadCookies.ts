import fs from 'fs';
import type { BrowserContext } from 'playwright';
import type { Scenario, VisregCookie } from '../../core/types';

export async function loadCookies(browserContext: BrowserContext, scenario: Scenario): Promise<void> {
  let cookies: VisregCookie[] = [];
  const cookiePath = scenario.cookiePath;

  // Read Cookies from File, if exists
  if (cookiePath && fs.existsSync(cookiePath)) {
    cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
  }

  // Add cookies to browser
  await browserContext.addCookies(cookies);

  console.log('Cookie state restored with:', JSON.stringify(cookies, null, 2));
}
