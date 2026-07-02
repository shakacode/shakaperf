/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// The source code including full typescript support is available at: 
// https://github.com/shakacode/react_on_rails_demo_ssr_hmr/blob/master/config/webpack/production.js

const generateWebpackConfigs = require('./generateWebpackConfigs');

const productionEnvOnly = (_clientWebpackConfig, _serverWebpackConfig) => {
  // place any code here that is for production only
};

module.exports = generateWebpackConfigs(productionEnvOnly);
