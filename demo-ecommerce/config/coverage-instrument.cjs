/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Reuse the exact Rspack/SWC loaders that instrument the served application.
// Compile every eligible source as an entry so even unreachable modules have
// initial counters. Inspect static coverageData objects without executing code.
const fs = require('node:fs');
const path = require('node:path');
const { rspack } = require('@rspack/core');
const { parseSync, traverse } = require('@babel/core');
let templates;

exports.instrumentDemoSource = async (_source, filename) => {
  templates ??= compileTemplates();
  const records = await templates;
  const record = records.get(filename);
  if (!record) throw new Error('SWC did not produce an initial coverage record');
  return structuredClone(record);
};

function compileTemplates() {
  const previous = process.env.SHAKA_PERF_INSTRUMENT_COVERAGE;
  process.env.SHAKA_PERF_INSTRUMENT_COVERAGE = '1';
  let config;
  try { config = require('./rspack/clientWebpackConfig')(); }
  finally {
    if (previous === undefined) delete process.env.SHAKA_PERF_INSTRUMENT_COVERAGE;
    else process.env.SHAKA_PERF_INSTRUMENT_COVERAGE = previous;
  }
  // tsx's config loader can namespace require.resolve results; native SWC
  // reads WASM paths directly and needs the filesystem path.
  for (const rule of config.module.rules) {
    for (const loader of Array.isArray(rule.use) ? rule.use : []) {
      for (const plugin of loader?.options?.jsc?.experimental?.plugins ?? []) {
        plugin[0] = plugin[0].replace(/\?namespace=.*$/, '');
      }
    }
  }
  const sourceRoot = path.resolve(__dirname, '../app/javascript');
  const entries = fs.readdirSync(sourceRoot, { recursive: true })
    .filter((name) => /^(components|hooks)\//.test(name) && /\.[jt]sx?$/.test(name))
    .map((name) => path.join(sourceRoot, name));
  const records = new Map();
  const compiler = rspack({ ...config, entry: { coverage: entries },
    cache: false, plugins: [], devtool: false,
    optimization: { minimize: false, concatenateModules: false },
  });
  compiler.hooks.shouldEmit.tap('CoverageTemplates', () => false);
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      try {
        if (error) throw error;
        if (stats.hasErrors()) throw new Error(stats.toString({ all: false, errors: true }));
        for (const module of stats.compilation.modules) {
          if (!entries.includes(module.resource)) continue;
          const code = module.originalSource()?.source().toString();
          if (!code) continue;
          traverse(parseSync(code, { babelrc: false, configFile: false, sourceType: 'unambiguous' }), {
            VariableDeclarator(nodePath) {
              if (nodePath.node.id.name !== 'coverageData') return;
              const value = nodePath.get('init').evaluate();
              if (value.confident && value.value?.path) records.set(value.value.path, value.value);
            },
          });
        }
        compiler.close((closeError) => closeError ? reject(closeError) : resolve(records));
      } catch (failure) { compiler.close(() => reject(failure)); }
    });
  });
}
