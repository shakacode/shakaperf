/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let registered = false;

/**
 * Register (once) the ESM resolve hook that lets user config / test files use
 * extensionless (or `.js`) relative imports. Node's ESM resolver requires
 * explicit extensions and tsx doesn't add them for the external files we load,
 * so an `import './helper'` in `abtests.config.ts` would otherwise fail —
 * silently degrading the forked Lighthouse worker (no `beforeNavigate`).
 *
 * Must run BEFORE the first `tsxImport` so the hook is in the resolver chain.
 * Idempotent.
 */
export function registerTsExtensionResolver(): void {
  if (registered) return;
  registered = true;
  const hookPath = path.join(__dirname, 'resolve-ts-extensions.mjs');
  register(pathToFileURL(hookPath).href);
}
