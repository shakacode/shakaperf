/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

type Ipv4Octets = [number, number, number, number];

function parseIpv4(address: string): Ipv4Octets | undefined {
  const match = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return undefined;

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return undefined;
  return octets as Ipv4Octets;
}

function isPublicIpv4([a, b, c]: Ipv4Octets): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function parseIpv6(address: string): number[] | undefined {
  const parts = address.split('::');
  if (parts.length > 2) return undefined;

  const hasCompression = parts.length === 2;
  const left = parts[0] === '' ? [] : parts[0].split(':');
  const right = hasCompression ? (parts[1] === '' ? [] : parts[1].split(':')) : [];
  const sections = [...left, ...right];
  const words: number[] = [];
  let leftWordCount = 0;

  for (const [index, section] of sections.entries()) {
    if (section.includes('.')) {
      if (index !== sections.length - 1 || (hasCompression && index < left.length)) return undefined;
      const ipv4 = parseIpv4(section);
      if (!ipv4) return undefined;
      words.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
    } else {
      if (!/^[\da-f]{1,4}$/.test(section)) return undefined;
      words.push(Number.parseInt(section, 16));
    }
    if (index < left.length) leftWordCount = words.length;
  }

  if (hasCompression) {
    if (words.length >= 8) return undefined;
    return [...words.slice(0, leftWordCount), ...Array(8 - words.length).fill(0), ...words.slice(leftWordCount)];
  }
  return words.length === 8 ? words : undefined;
}

function ipv4FromWords(words: number[], offset: number): Ipv4Octets {
  return [words[offset] >> 8, words[offset] & 0xff, words[offset + 1] >> 8, words[offset + 1] & 0xff];
}

function isPublicIpv6(address: string): boolean {
  const words = parseIpv6(address);
  if (!words) return false;
  if (words.every((word) => word === 0)) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return false;
  if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80) return false;
  if ((words[0] & 0xffc0) === 0xfec0 || (words[0] & 0xff00) === 0xff00) return false;

  const isIpv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const isIpv4Compatible = words.slice(0, 6).every((word) => word === 0);
  const isIpv4Translated = words.slice(0, 4).every((word) => word === 0) && words[4] === 0xffff && words[5] === 0;
  if (isIpv4Mapped || isIpv4Compatible || isIpv4Translated) return isPublicIpv4(ipv4FromWords(words, 6));
  if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 1) return false;
  if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) return isPublicIpv4(ipv4FromWords(words, 6));
  if (words[0] === 0x2002) return isPublicIpv4(ipv4FromWords(words, 1));
  return true;
}

// Pure: expects a normalized URL.hostname and rejects localhost plus non-public
// IP literals. A hostname that resolves to a private IP is out of scope for
// these best-effort fetches on a dev/CI box.
export function isPublicHost(hostname: string): boolean {
  let h = hostname.toLowerCase().replace(/\.+$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);

  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  if (h.includes(':')) return isPublicIpv6(h);

  const ipv4 = parseIpv4(h);
  if (ipv4) return isPublicIpv4(ipv4);
  return true;
}
