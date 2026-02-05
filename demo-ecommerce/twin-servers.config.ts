import { defineConfig } from 'shaka-twin-servers';

export default defineConfig({
  projectDir: '.',
  controlDir: '../../shaka-perf-control/demo-ecommerce',
  dockerBuildDir: '..',
  dockerBuildArgs: {
    RUBY_VERSION: '3.3.7',
    NODE_VERSION: '24.13.0',
  },
  composeFile: 'docker-compose.yml',
  procfile: 'Procfile',
  stopSignals: {
    'experiment-rails': 'TERM',
    'control-rails': 'TERM',
  },
  images: {
    control: 'demo-ecommerce:control',
    experiment: 'demo-ecommerce:experiment',
  },
  volumes: {
    control: '~/demo_ecommerce_control_docker_volume',
    experiment: '~/demo_ecommerce_experiment_docker_volume',
  },
  setupCommands: [
    { command: 'bin/rails db:prepare', description: 'Preparing database' },
    { command: 'bin/rails db:seed', description: 'Seeding database' },
  ],
});
