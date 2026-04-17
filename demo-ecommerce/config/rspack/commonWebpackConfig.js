// The source code including full typescript support is available at: 
// https://github.com/shakacode/react_on_rails_demo_ssr_hmr/blob/master/config/webpack/commonWebpackConfig.js

// Common configuration applying to client and server configuration
const { generateWebpackConfig, merge } = require('shakapacker');

const baseClientWebpackConfig = generateWebpackConfig();

// Inject @swc/plugin-loadable-components into every builtin:swc-loader rule so
// loadable(() => import('./Foo')) calls get named chunks (was @loadable/babel-plugin under webpack).
const loadableSwcPluginPath = require.resolve('@swc/plugin-loadable-components');
baseClientWebpackConfig.module.rules.forEach((rule) => {
  if (!Array.isArray(rule.use)) return;
  rule.use.forEach((entry) => {
    if (!entry || entry.loader !== 'builtin:swc-loader') return;
    entry.options = entry.options || {};
    entry.options.jsc = entry.options.jsc || {};
    entry.options.jsc.experimental = entry.options.jsc.experimental || {};
    const plugins = entry.options.jsc.experimental.plugins || [];
    if (!plugins.some(([p]) => p === loadableSwcPluginPath)) {
      plugins.push([loadableSwcPluginPath, {}]);
    }
    entry.options.jsc.experimental.plugins = plugins;
  });
});

const commonOptions = {
  resolve: {
    extensions: ['.css', '.ts', '.tsx'],
  },
};

// Copy the object using merge b/c the baseClientWebpackConfig and commonOptions are mutable globals
const commonWebpackConfig = () => merge({}, baseClientWebpackConfig, commonOptions);

module.exports = commonWebpackConfig;