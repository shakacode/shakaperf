/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { isPublicHost } from '../public-host';

describe('isPublicHost', () => {
  it('accepts public hostnames and public IPs', () => {
    for (const h of ['example.com', 'www.sunhub.com', '8.8.8.8', '1.2.3.4', 'fcbarcelona.com']) {
      expect(isPublicHost(h)).toBe(true);
    }
  });

  it('rejects loopback, private, CGNAT, link-local and metadata addresses', () => {
    for (const h of [
      'localhost',
      'foo.localhost',
      '127.0.0.1',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '100.64.0.1',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '[::1]',
      'fc00::1',
      'fd12::1',
      'fe80::1',
    ]) {
      expect(isPublicHost(h)).toBe(false);
    }
  });

  it('does not reject a public 172.x outside the private block', () => {
    expect(isPublicHost('172.15.0.1')).toBe(true);
    expect(isPublicHost('172.32.0.1')).toBe(true);
  });
});
