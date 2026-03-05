import clickAndHoverHelper from './clickAndHoverHelper.js';

export default async (page, scenario, _viewport, _isReference, _browserContext) => {
  console.log('SCENARIO > ' + scenario.label);
  await clickAndHoverHelper(page, scenario);

  // add more ready handlers here...
};
