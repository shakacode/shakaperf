/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

const generateWebpackConfigs = require('./generateWebpackConfigs');

const developmentEnvOnly = (clientWebpackConfig, _serverWebpackConfig) => {
  if (process.env.WEBPACK_SERVE) {
    const ReactRefreshPlugin = require('@rspack/plugin-react-refresh');
    clientWebpackConfig.plugins.push(new ReactRefreshPlugin());
  }
};

module.exports = generateWebpackConfigs(developmentEnvOnly);
