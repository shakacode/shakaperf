import loadCookies from './loadCookies.js';

export default async (_page, scenario, _viewport, _isReference, browserContext) => {
  await loadCookies(browserContext, scenario);
};
