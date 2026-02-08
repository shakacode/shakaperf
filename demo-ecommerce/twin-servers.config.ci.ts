import { defineConfig } from 'shaka-twin-servers';

// CI-specific configuration for twin servers
// Used when images are pre-built in separate CI jobs and loaded from workspace
export default defineConfig({
  projectDir: '.',
  // In CI, controlDir is not used since images are pre-built
  // Set to current directory to pass schema validation
  controlDir: '.',
  dockerBuildDir: '..',
  dockerBuildArgs: {},
  composeFile: 'docker-compose.yml',
  procfile: 'Procfile.ci',
  images: {
    control: 'demo-ecommerce:control',
    experiment: 'demo-ecommerce:experiment',
  },
  volumes: {
    control: '/tmp/demo_ecommerce_control',
    experiment: '/tmp/demo_ecommerce_experiment',
  },
  setupCommands: [
    { command: 'bin/rails db:prepare', description: 'Preparing database' },
    { command: 'bin/rails db:seed', description: 'Seeding database' },
  ],
});
