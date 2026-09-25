/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import {
  DESKTOP_TALL_VIEWPORT,
  DESKTOP_VIEWPORT,
  PHONE_TALL_VIEWPORT,
  PHONE_VIEWPORT,
  TABLET_TALL_VIEWPORT,
  TABLET_VIEWPORT,
} from 'shaka-shared';
import {
  DESKTOP_USER_AGENT,
  PHONE_USER_AGENT,
  TABLET_USER_AGENT,
  deviceClassOf,
  matchUserAgentChromeVersion,
  userAgentForViewport,
} from '../browser-user-agent';
import { deviceContextOptions, viewportUserAgent } from '../device-identity';

const orig = process.env.SHAKAPERF_REAL_CHROME;
const origHeadless = process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
afterEach(() => {
  if (orig === undefined) delete process.env.SHAKAPERF_REAL_CHROME;
  else process.env.SHAKAPERF_REAL_CHROME = orig;
  if (origHeadless === undefined) delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
  else process.env.SHAKAPERF_REAL_CHROME_HEADLESS = origHeadless;
});

describe('deviceClassOf', () => {
  it('names every canonical viewport by its label', () => {
    expect(deviceClassOf(PHONE_VIEWPORT)).toBe('phone');
    expect(deviceClassOf(TABLET_VIEWPORT)).toBe('tablet');
    expect(deviceClassOf(DESKTOP_VIEWPORT)).toBe('desktop');
    expect(deviceClassOf(PHONE_TALL_VIEWPORT)).toBe('phone');
    expect(deviceClassOf(TABLET_TALL_VIEWPORT)).toBe('tablet');
    expect(deviceClassOf(DESKTOP_TALL_VIEWPORT)).toBe('desktop');
  });

  it('reads the device out of a custom label, case-insensitively', () => {
    expect(deviceClassOf({ label: 'Tablet Landscape', formFactor: 'mobile' })).toBe('tablet');
    expect(deviceClassOf({ label: 'mobile-narrow', formFactor: 'mobile' })).toBe('phone');
    expect(deviceClassOf({ label: 'wide-desktop', formFactor: 'desktop' })).toBe('desktop');
    expect(deviceClassOf({ label: 'tablet', formFactor: 'desktop' })).toBe('tablet');
  });

  it('falls back to formFactor when the label names no device', () => {
    expect(deviceClassOf({ label: 'narrow', formFactor: 'mobile' })).toBe('phone');
    expect(deviceClassOf({ label: 'wide', formFactor: 'desktop' })).toBe('desktop');
  });
});

describe('userAgentForViewport', () => {
  it('maps each device class to Chrome on that device', () => {
    expect(userAgentForViewport(PHONE_VIEWPORT)).toBe(PHONE_USER_AGENT);
    expect(userAgentForViewport(TABLET_VIEWPORT)).toBe(TABLET_USER_AGENT);
    expect(userAgentForViewport(DESKTOP_VIEWPORT)).toBe(DESKTOP_USER_AGENT);
  });

  it('gives phones the Mobile token and tablets the Android platform without it', () => {
    expect(PHONE_USER_AGENT).toMatch(/Android.*\) .*Chrome\/\d+.* Mobile Safari/);
    expect(TABLET_USER_AGENT).toMatch(/Android/);
    expect(TABLET_USER_AGENT).not.toContain('Mobile');
    expect(DESKTOP_USER_AGENT).not.toMatch(/Android|Mobile/);
  });

  it('returns an explicit viewport user agent verbatim', () => {
    expect(userAgentForViewport({ ...PHONE_VIEWPORT, userAgent: 'custom-ua' })).toBe('custom-ua');
  });
});

describe('matchUserAgentChromeVersion', () => {
  it('replaces the Chrome major for a valid dotted browser version', () => {
    expect(matchUserAgentChromeVersion(DESKTOP_USER_AGENT, '150.0.0.0')).toContain('Chrome/150.0.0.0');
    expect(matchUserAgentChromeVersion(PHONE_USER_AGENT, '150.0.7339.41')).toMatch(/Chrome\/150\.0\.0\.0 Mobile/);
  });

  it.each([undefined, '', 'abc', '150'])(
    'keeps the template for an unusable browser version (%p)',
    (browserVersion) => {
      expect(matchUserAgentChromeVersion(DESKTOP_USER_AGENT, browserVersion)).toBe(DESKTOP_USER_AGENT);
    },
  );
});

describe('deviceContextOptions', () => {
  it('sends the device identity in the default mode, with touch for phones and tablets', () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    expect(deviceContextOptions(PHONE_VIEWPORT, '150.0.0.0')).toEqual({
      userAgent: expect.stringMatching(/Chrome\/150\.0\.0\.0 Mobile Safari/),
      hasTouch: true,
    });
    expect(deviceContextOptions(TABLET_VIEWPORT, '150.0.0.0')).toEqual({
      userAgent: expect.stringMatching(/Android.*Chrome\/150\.0\.0\.0 Safari/),
      hasTouch: true,
    });
    expect(deviceContextOptions(DESKTOP_VIEWPORT, '150.0.0.0')).toEqual({
      userAgent: expect.stringMatching(/Macintosh.*Chrome\/150\.0\.0\.0 Safari/),
    });
  });

  it('keeps the template version when the browser version is unknown', () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    expect(deviceContextOptions(DESKTOP_VIEWPORT).userAgent).toBe(DESKTOP_USER_AGENT);
  });

  it('sends an explicit viewport user agent verbatim, without a version rewrite', () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    expect(viewportUserAgent({ ...PHONE_VIEWPORT, userAgent: 'Chrome/1.0 custom' }, '150.0.0.0'))
      .toBe('Chrome/1.0 custom');
  });

  it('leaves another engine on its own identity', () => {
    delete process.env.SHAKAPERF_REAL_CHROME;
    expect(deviceContextOptions(PHONE_VIEWPORT, '18.2.0.0', false)).toEqual({});
  });

  it('keeps the native identity only on the headed real-Chrome desktop path', () => {
    process.env.SHAKAPERF_REAL_CHROME = '1';
    delete process.env.SHAKAPERF_REAL_CHROME_HEADLESS;
    expect(deviceContextOptions(DESKTOP_VIEWPORT, '150.0.0.0')).toEqual({});
    expect(deviceContextOptions(PHONE_VIEWPORT, '150.0.0.0').hasTouch).toBe(true);
    process.env.SHAKAPERF_REAL_CHROME_HEADLESS = '1';
    expect(deviceContextOptions(DESKTOP_VIEWPORT, '150.0.0.0').userAgent).toMatch(/Chrome\/150\.0\.0\.0 Safari/);
  });
});
