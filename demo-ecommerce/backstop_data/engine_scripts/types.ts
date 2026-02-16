import type { Page as PlaywrightPage, BrowserContext } from 'playwright-core';
import type { Scenario, Viewport as BackstopViewport } from 'backstopjs';

// Re-export from @types/backstopjs
export type { Scenario, KeypressSelector } from 'backstopjs';

export type Viewport = BackstopViewport & {
  label: string;
};

// Cookie type for loadCookies scripts
export interface BackstopCookie {
  name: string;
  value: string;
  domain?: string;
  url?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export type PlaywrightScriptFn = (
  page: PlaywrightPage,
  scenario: Scenario,
  viewport: Viewport,
  isReference: boolean,
  browserContext: BrowserContext
) => Promise<void>;
