import clickAndHoverHelper from './clickAndHoverHelper.js';

export default async (page, scenario, viewport, isReference, browserContext) => {
  console.log('SCENARIO > ' + scenario.label);
  await clickAndHoverHelper(page, scenario);

  // add more ready handlers here...
};
