import assert from 'node:assert';
import { parseAbTestsConfig } from '../../src/compare/config';
import templateConfig from '../../templates/abtests.config';

describe('templates/abtests.config.ts', function () {
  it('parses cleanly through the zod schema', function () {
    // `shaka-perf init` copies this file verbatim as every new user's starting
    // config. A schema drift here silently breaks adoption — the user sees a
    // cryptic "AbTestsConfigSchema" error on their first `shaka-perf compare`.
    assert.doesNotThrow(() => parseAbTestsConfig(templateConfig));
  });
});
