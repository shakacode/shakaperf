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
    for (const h of [
      'example.com',
      'www.sunhub.com',
      '8.8.8.8',
      '1.2.3.4',
      'fcbarcelona.com',
      '172.15.0.1',
      '172.32.0.1',
      '198.20.0.1',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
      '64:ff9b:1::808:808',
      '2002:808:808::',
      '::ffff:0:808:808',
    ]) {
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

  it('rejects IPv6 site-local and multicast ranges', () => {
    expect(isPublicHost('fec0::1')).toBe(false);
    expect(isPublicHost('ff02::1')).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 addresses for non-public IPv4 ranges', () => {
    for (const h of ['::ffff:127.0.0.1', '::ffff:192.168.1.1', '::ffff:0a00:1']) {
      expect(isPublicHost(h)).toBe(false);
    }
  });

  it('rejects IPv4 transition IPv6 addresses for non-public IPv4 ranges', () => {
    for (const h of ['64:ff9b::a9fe:a9fe', '64:ff9b:1::a9fe:a9fe', '2002:a9fe:a9fe::', '::ffff:0:7f00:1']) {
      expect(isPublicHost(h)).toBe(false);
    }
  });

  it('rejects malformed IPv6 literals', () => {
    expect(isPublicHost('::1%lo0')).toBe(false);
    expect(isPublicHost('10.0.0.1::')).toBe(false);
  });

  it('rejects unspecified IPv6 spellings', () => {
    expect(isPublicHost('::')).toBe(false);
    expect(isPublicHost('0:0:0:0:0:0:0:0')).toBe(false);
  });

  it('rejects localhost with a trailing dot', () => {
    expect(isPublicHost('localhost.')).toBe(false);
    expect(isPublicHost('LOCALHOST.')).toBe(false);
    expect(isPublicHost('localhost..')).toBe(false);
  });

  it('rejects reserved, documentation, benchmark, and multicast IPv4 ranges', () => {
    for (const h of [
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '198.18.0.1',
      '198.19.255.255',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isPublicHost(h)).toBe(false);
    }
  });

  it('accepts addresses adjacent to documentation ranges', () => {
    expect(isPublicHost('192.0.1.1')).toBe(true);
    expect(isPublicHost('198.51.99.1')).toBe(true);
    expect(isPublicHost('203.0.112.1')).toBe(true);
  });
});
