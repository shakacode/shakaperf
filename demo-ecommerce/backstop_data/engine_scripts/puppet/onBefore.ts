import type { Page } from 'puppeteer-core';
import type { Scenario, Viewport } from '../types';

module.exports = async (page: Page, scenario: Scenario, _vp: Viewport): Promise<void> => {
  await require('./loadCookies')(page, scenario);
};
