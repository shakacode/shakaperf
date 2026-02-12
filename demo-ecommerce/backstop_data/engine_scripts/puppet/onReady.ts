import type { Page } from 'puppeteer-core';
import type { Scenario, Viewport } from '../types';

module.exports = async (page: Page, scenario: Scenario, _vp: Viewport): Promise<void> => {
  console.log('SCENARIO > ' + scenario.label);
  await require('./clickAndHoverHelper')(page, scenario);

  // Wait for all images to load
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll('img'));
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve());
          img.addEventListener('error', () => resolve());
        });
      })
    );
  });

  // Wait for network to be idle
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
};
