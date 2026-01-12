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

  // Add Loadable Components plugin for code splitting
  clientConfig.plugins.push(new LoadablePlugin());

  return clientConfig;
};

module.exports = configureClient;
