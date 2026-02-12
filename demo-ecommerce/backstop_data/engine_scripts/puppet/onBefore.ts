import type { Page } from 'puppeteer-core';
import type { Scenario, Viewport } from '../types';
import loadCookies from './loadCookies';

async function onBefore(page: Page, scenario: Scenario, _vp: Viewport): Promise<void> {
  await loadCookies(page, scenario);
}

export default onBefore;
module.exports = onBefore;
