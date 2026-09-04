/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * `webpack://demo/./app/javascript/Nav.tsx?1234` → `app/javascript/Nav.tsx`;
 * `/home/me/app/app/javascript/Nav.tsx` → `app/javascript/Nav.tsx` when `root`
 * is `/home/me/app`. The path a `SourceLocation` carries: build-relative, no
 * scheme, loader prefix, query, or leading `./`.
 */
export function normalizeSourcePath(source: string, root?: string): string {
  let path = source;
  const bang = path.lastIndexOf('!');
  if (bang !== -1) path = path.slice(bang + 1);
  path = path.replace(/^webpack:\/\/[^/]*\//, '').replace(/[?#].*$/, '');
  if (root) {
    const prefix = root.replace(/\/?$/, '/');
    if (path.startsWith(prefix)) path = path.slice(prefix.length);
  }
  while (path.startsWith('./')) path = path.slice(2);
  return path;
}

/** The app's own code: not installed, not bundler-made. */
export function isAppSourceByDefault(path: string): boolean {
  return path !== ''
    && !/(^|\/)node_modules\//.test(path)
    && !/(^|\/)\.yarn\//.test(path)
    && !/^\(?(webpack|rspack)\)?[/:]/.test(path)
    && !path.startsWith('external ');
}
