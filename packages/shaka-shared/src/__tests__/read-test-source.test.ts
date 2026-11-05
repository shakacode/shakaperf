/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTestSource } from '../read-test-source';

describe('readTestSource', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaka-source-reader-'));
    file = path.join(dir, 'journey.abtest.ts');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([
    "await page.fill('#search', '(');",
    'await page.fill("#search", ")");',
    "const label = 'don\\'t count (';",
    'const label = `open (`;',
    "const url = 'https://example.test/(';",
    '// unmatched ( in a comment\n  await page.click("button");',
    '/* unmatched ) )\n     and ( in a block comment */\n  await page.click("button");',
  ])('ignores parentheses in quoted text and comments: %s', (body) => {
    const source = `abTest('Search', {}, async ({ page }) => {\n  ${body}\n});`;
    fs.writeFileSync(file, source);
    expect(readTestSource(file, 1)).toBe(source);
  });

  it('reads the selected registration on its own line', () => {
    const first = "abTest('First', {}, async () => {});";
    const second = "abTest('Second', {}, async () => {\n  await page.click('button');\n});";
    fs.writeFileSync(file, `${first}\n\n${second}`);
    expect(readTestSource(file, 3)).toBe(second);
  });

  it('does not replace an aliased registration with the preceding test', () => {
    const first = "abTest('First', {}, async () => {});";
    const second = "scenario('Second', {}, async () => {});";
    fs.writeFileSync(file, `const scenario = abTest;\n${first}\n${second}`);
    expect(readTestSource(file, 3)).toBe(second);
  });

  it('returns null when the file or source location is unavailable', () => {
    expect(readTestSource(file, 1)).toBeNull();
    fs.writeFileSync(file, "abTest('Search', {}, async () => {});");
    expect(readTestSource(null, 1)).toBeNull();
    expect(readTestSource(file, null)).toBeNull();
    expect(readTestSource(file, 100)).toBeNull();
  });

  it('returns null for an unfinished call', () => {
    fs.writeFileSync(file, "abTest('Search', {}, async () => {");
    expect(readTestSource(file, 1)).toBeNull();
  });
});
