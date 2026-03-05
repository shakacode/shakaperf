import loadCookies from './loadCookies.js';

export default async (page, scenario, viewport, isReference, browserContext) => {
  await loadCookies(browserContext, scenario);
};
