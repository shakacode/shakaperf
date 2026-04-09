import { defineConfig } from 'shaka-perf/twin-servers';

export default defineConfig({
  projectDir: '.',
  controlDir: process.env.CONTROL_REPO_DIR || '../../shaka-perf-control/demo-ecommerce',
  dockerBuildDir: '..',
  dockerfile: 'twin-servers/Dockerfile',
  procfile: 'twin-servers/Procfile',
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
