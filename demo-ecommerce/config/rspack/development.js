const generateWebpackConfigs = require('./generateWebpackConfigs');

const developmentEnvOnly = (clientWebpackConfig, _serverWebpackConfig) => {
  if (process.env.WEBPACK_SERVE) {
    const ReactRefreshPlugin = require('@rspack/plugin-react-refresh');
    clientWebpackConfig.plugins.push(new ReactRefreshPlugin());
  }
};

module.exports = generateWebpackConfigs(developmentEnvOnly);
