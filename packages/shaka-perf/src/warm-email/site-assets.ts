/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { isPublicHost } from '../net/public-host';
import { escapeHtml as esc } from './html-escape';

// The audited site's own favicon, inlined when it is a plausible icon so the
// hosted report's browser tab shows the client's logo. Best-effort: rejected
// or unavailable responses omit the icon link.

const FAVICON_MAX_BYTES = 512 * 1024;
const MAX_REDIRECT_HOPS = 5;

// Pure: fetched favicon bytes + content-type -> an inline data URI, or null
// when unusable. Guards an empty body and an absurdly large file (it inlines
// into the HTML, so cap it). The content-type is attacker-controlled (it comes
// from the audited site), so only a clean `image/<subtype>` token is accepted -
// anything with a quote, angle bracket, or space could otherwise break out of
// the href attribute faviconLinkTag puts it in. Known byte signatures take
// precedence over the header because the header may be wrong; a clean image
// header is only a fallback for icon formats we do not sniff. Text error bodies
// never use that fallback.
export function faviconDataUri(bytes: Uint8Array, contentType: string | null): string | null {
  if (bytes.length === 0 || bytes.length > FAVICON_MAX_BYTES) return null;
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const mime = faviconMimeFromBytes(bytes)
    ?? (!isClearlyNonIconText(bytes) && /^image\/[a-z0-9.+-]+$/.test(type) && type !== 'image/svg+xml' ? type : null);
  if (!mime) return null;
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function faviconMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'image/x-icon';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (hasSvgRoot(faviconTextPrefix(bytes))) {
    return 'image/svg+xml';
  }
  return null;
}

function isClearlyNonIconText(bytes: Uint8Array): boolean {
  const text = faviconTextPrefix(bytes).trimStart();
  return /^[<{[]/.test(text) || (!text.includes('\ufffd') && /^[\t\n\f\r -~]+$/.test(text));
}

function faviconTextPrefix(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 8192));
}

function hasSvgRoot(text: string): boolean {
  let index = skipXmlWhitespace(text, 0);
  if (text.startsWith('<?xml', index)) {
    const end = text.indexOf('?>', index + 5);
    if (end === -1) return false;
    index = skipXmlWhitespace(text, end + 2);
  }
  for (let prefixes = 0; prefixes < 8; prefixes += 1) {
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end === -1) return false;
      index = skipXmlWhitespace(text, end + 3);
      continue;
    }
    if (text.startsWith('<!DOCTYPE', index)) {
      const name = skipXmlWhitespace(text, index + '<!DOCTYPE'.length);
      if (!text.startsWith('svg', name) || !isXmlDelimiter(text[name + 3])) return false;
      const end = text.indexOf('>', name + 3);
      if (end === -1) return false;
      index = skipXmlWhitespace(text, end + 1);
      continue;
    }
    break;
  }
  return text.startsWith('<svg', index) && isXmlDelimiter(text[index + 4]);
}

function skipXmlWhitespace(text: string, index: number): number {
  while (isXmlWhitespace(text[index])) index += 1;
  return index;
}

function isXmlWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f' || character === '\v' || character === '\ufeff';
}

function isXmlDelimiter(character: string | undefined): boolean {
  return isXmlWhitespace(character) || character === '/' || character === '>';
}

// Pure: the report head's icon link. Omit it when no usable favicon was fetched.
// faviconDataUri already constrains the MIME and base64 has no HTML-special
// chars, but the href is attacker-influenced so escape it at the boundary.
export function faviconLinkTag(faviconUri: string | null): string {
  return faviconUri ? `<link rel="icon" href="${esc(faviconUri)}" />` : '';
}

// Pure: the favicon href a homepage declares, or null. Bounded input + a
// de-nested tag scan (no adjacent unbounded quantifiers) so a hostile body
// cannot cause catastrophic backtracking, and it requires the bare `icon` rel
// token so `apple-touch-icon` / `mask-icon` (an oversized iOS PNG or a flat
// mask SVG) are not mistaken for the tab favicon.
export function parseIconHref(html: string): string | null {
  for (const tag of html.slice(0, 200_000).match(/<link\b[^>]{0,2000}>/gi) ?? []) {
    const rel = tag.match(/\brel=["']([^"']*)["']/i)?.[1]?.toLowerCase();
    if (!rel || !rel.split(/\s+/).includes('icon')) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) return href;
  }
  return null;
}

// Fetch the audited site's favicon. Tries the conventional /favicon.ico, then
// the homepage's declared <link rel=icon> (SPAs often ship only PNG). Each
// request is bounded by an 8s timeout that COVERS the body read, streamed with
// a hard 512KB cap, and refuses any URL (or redirect hop) that resolves to a
// non-public host. Returns null on any failure - the report omits the icon tag.
export async function fetchSiteFavicon(siteUrl: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    return null;
  }
  // One bounded fetch: validates scheme + host up front and before every
  // redirect hop, reads the body under the same timeout, and aborts the moment
  // the stream exceeds the cap. Returns the final URL so a relative icon href
  // resolves correctly.
  const fetchBounded = async (
    url: string,
  ): Promise<{ bytes: Uint8Array; contentType: string | null; finalUrl: string } | null> => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return null;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    if (!isPublicHost(target.hostname)) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      for (let redirects = 0; ; redirects += 1) {
        const res = await fetch(target.href, {
          signal: ctl.signal,
          redirect: 'manual',
          headers: { 'user-agent': 'Mozilla/5.0 (shaka-perf client-report favicon)' },
        });
        if (res.status >= 300 && res.status < 400) {
          await res.body?.cancel().catch(() => {});
          if (redirects >= MAX_REDIRECT_HOPS) return null;
          const location = res.headers.get('location');
          if (!location) return null;
          try {
            target = new URL(location, target);
          } catch {
            return null;
          }
          if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
          if (!isPublicHost(target.hostname)) return null;
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          return null;
        }
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > FAVICON_MAX_BYTES) {
          await res.body?.cancel().catch(() => {});
          return null;
        }
        const reader = res.body?.getReader();
        if (!reader) return null;
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.length;
          if (total > FAVICON_MAX_BYTES) {
            ctl.abort();
            return null;
          }
          chunks.push(value);
        }
        if (total === 0) return null;
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        return { bytes, contentType: res.headers.get('content-type'), finalUrl: target.href };
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  // 1) The conventional location - works for most sites (both live clients).
  const ico = await fetchBounded(`${origin}/favicon.ico`);
  if (ico) {
    const uri = faviconDataUri(ico.bytes, ico.contentType);
    if (uri) return uri;
  }
  // 2) Fall back to the homepage's declared icon link.
  const page = await fetchBounded(origin);
  if (page) {
    const href = parseIconHref(new TextDecoder().decode(page.bytes));
    if (href) {
      let iconUrl: string;
      try {
        iconUrl = new URL(href, page.finalUrl).href;
      } catch {
        return null;
      }
      const icon = await fetchBounded(iconUrl);
      if (icon) return faviconDataUri(icon.bytes, icon.contentType);
    }
  }
  return null;
}
