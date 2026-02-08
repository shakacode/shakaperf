/// <reference types="node" />
import { defineConfig } from 'shaka-twin-servers';

// CI-specific configuration for twin servers
// Used when images are pre-built in separate CI jobs and loaded from workspace
export default defineConfig({
  projectDir: '.',
  controlDir: '/home/circleci/control_checkout/demo-ecommerce',
  dockerBuildDir: '..',
  dockerBuildArgs: {},
  composeFile: 'docker-compose.yml',
  procfile: 'Procfile.ci',
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
