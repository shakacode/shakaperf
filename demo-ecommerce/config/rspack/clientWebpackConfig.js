/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// The source code including full typescript support is available at:
// https://github.com/shakacode/react_on_rails_demo_ssr_hmr/blob/master/config/webpack/clientWebpackConfig.js

const commonWebpackConfig = require('./commonWebpackConfig');
const LoadablePlugin = require('@loadable/webpack-plugin');

const configureClient = () => {
  const clientConfig = commonWebpackConfig();

  // server-bundle is special and should ONLY be built by the serverConfig
  // In case this entry is not deleted, a very strange "window" not found
  // error shows referring to window["webpackJsonp"]. That is because the
  // client config is going to try to load chunks.
  delete clientConfig.entry['server-bundle'];

  // Filter entries based on bundle type (only in production builds)
  if (process.env.ADMIN_BUNDLE_ONLY === 'true') {
    // Admin bundle: keep only admin entry
    Object.keys(clientConfig.entry).forEach((key) => {
      if (key !== 'admin') {
        delete clientConfig.entry[key];
      }
    });
  } else if (process.env.BUNDLE_NAME) {
    // Consumer bundle: remove admin entry (only when explicitly building consumer)
    delete clientConfig.entry['admin'];
  }
  // In development (no BUNDLE_NAME set), keep all entries

  // Opt-in: only the `code_coverage` audit stage reads `window.__coverage__`,
  // and instrumenting triples this app's own JS — which every perf and audit
  // number measured against this app would then carry. Set the flag for the
  // build the coverage run audits; leave it unset everywhere else, including
  // the twin-server production images.
  if (process.env.SHAKA_PERF_INSTRUMENT_COVERAGE === '1') {
    addCoverageInstrumentation(clientConfig);
  }

  // Add Loadable Components plugin for code splitting
  const bundleName = process.env.BUNDLE_NAME || 'app';
  clientConfig.plugins.push(new LoadablePlugin({
    filename: `${bundleName}-loadable-stats.json`
  }));

  return clientConfig;
};

function addCoverageInstrumentation(config) {
  const coveragePlugin = require.resolve('swc-plugin-coverage-instrument');
  config.module.rules.forEach((rule) => {
    if (!Array.isArray(rule.use)) return;
    rule.use.forEach((entry) => {
      if (!entry || entry.loader !== 'builtin:swc-loader') return;
      entry.options = entry.options || {};
      entry.options.jsc = entry.options.jsc || {};
      entry.options.jsc.experimental = entry.options.jsc.experimental || {};
      const plugins = entry.options.jsc.experimental.plugins || [];
      if (!plugins.some(([plugin]) => plugin === coveragePlugin)) {
        plugins.push([coveragePlugin, {}]);
      }
      entry.options.jsc.experimental.plugins = plugins;
    });
  });
}

module.exports = configureClient;
