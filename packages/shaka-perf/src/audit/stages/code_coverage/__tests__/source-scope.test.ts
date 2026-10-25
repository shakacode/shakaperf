/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { coverageScope, coverageProvenance } from '../source-scope';

it('resolves scope from config, preserves exclusions, and fingerprints exact source bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-scope-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/a.js'), 'const a = 1;');
    fs.writeFileSync(path.join(root, 'src/types.d.ts'), 'declare const a: number;');
    const scope = coverageScope({ projectRoot: '..', include: ['src/**'], pathMappings: { '/app': '.' } }, path.join(root, 'tools/abtests.config.ts'));
    expect(scope.root).toBe(root);
    expect(scope.files()).toEqual([path.join(root, 'src/a.js')]);
    expect(scope.resolve('/app/src/a.js')).toBe(path.join(root, 'src/a.js'));
    const before = coverageProvenance({}, scope);
    fs.writeFileSync(path.join(root, 'src/a.js'), 'const a = 2;');
    expect(coverageProvenance({}, scope).sources).not.toEqual(before.sources);
    expect(coverageScope({}, path.join(root, 'abtests.config.ts')).files()).toEqual([]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
