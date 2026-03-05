import type { Scenario, Viewport } from '../types.js';

export default class BackstopException {
  msg: string;
  scenario: Scenario;
  viewport: Viewport;
  originalError: Error;

  constructor (msg: string, scenario: Scenario, viewport: Viewport, originalError: Error) {
    this.msg = msg;
    this.scenario = scenario;
    this.viewport = viewport;
    this.originalError = originalError;
  }

  toString () {
    return 'BackstopException: ' +
      this.scenario.label + ' on ' +
      this.viewport.label + ': ' +
      this.originalError.toString();
  }
}
