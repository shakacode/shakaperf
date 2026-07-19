/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Pure: reject hosts that point at the machine itself or a private network -
// the obvious SSRF targets (loopback, RFC1918, CGNAT, link-local incl. the
// 169.254.169.254 cloud-metadata endpoint). IP-literal only; a hostname that
// DNS-resolves to a private IP is out of scope for these best-effort fetches.
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  if (h.includes(':')) {
    // IPv6 literal: loopback ::1, unique-local fc00::/7, link-local fe80::/10.
    return !(h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h));
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}
