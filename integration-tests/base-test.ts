import { test as base } from '@playwright/test';
import { loud } from './helpers';

export const test = base.extend({});

test.beforeEach(async ({}, testInfo) => {
  loud(`TEST: ${testInfo.title}`);
});

export { expect } from '@playwright/test';
