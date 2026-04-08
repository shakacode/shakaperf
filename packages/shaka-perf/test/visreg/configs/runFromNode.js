// Go get a hook to shaka-perf visreg
import runner from '../../core/runner.js';

// Run shaka-perf visreg with docker
// NOTE: passing either config file name or actual config object is supported.
runner('reference', {
  docker: false,
  config: 'visreg',
  filter: undefined,
  i: false
}).then(
  () => console.log('nothing new'),
  () => console.log('changes found')
);
