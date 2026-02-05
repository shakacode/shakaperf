import * as fs from 'fs';
import type { ResolvedConfig } from '../types';
import {
  dockerImageExists,
  dockerComposeUp,
  dockerComposeDown,
  dockerComposePs,
  dockerComposeExec,
  waitForContainer,
} from '../helpers/docker';
import { printBanner, printSuccess, printError, printWarning } from '../helpers/ui';

export interface StartContainersOptions {
  verbose?: boolean;
}

async function setupDatabaseForServer(
  config: ResolvedConfig,
  serverType: 'control' | 'experiment',
  composeEnv: Record<string, string>
): Promise<void> {
  const containerName = `${serverType}-server`;
  const composeOptions = { composeFile: config.composeFile, cwd: config.projectDir, env: composeEnv };

  console.log('');
  console.log(`Setting up database for ${serverType}...`);

  const prepareResult = await dockerComposeExec(composeOptions, containerName, 'bin/rails db:prepare');
  if (prepareResult.code !== 0) {
    throw new Error(`Failed to prepare database for ${serverType}: ${prepareResult.stderr}`);
  }

  const seedsExist = await dockerComposeExec(composeOptions, containerName, 'test -f db/seeds.rb');
  if (seedsExist.code === 0) {
    const seedResult = await dockerComposeExec(composeOptions, containerName, 'bin/rails db:seed');
    if (seedResult.code !== 0) {
      console.log(`   Warning: db:seed failed for ${serverType}`);
    }
  }

  console.log(`   Database ready for ${serverType}`);
}

export async function startContainers(
  config: ResolvedConfig,
  options: StartContainersOptions = {}
): Promise<void> {
  const { verbose } = options;

  printBanner('Starting Twin Servers Locally');

  const composeEnv = {
    CI_IMAGE_NAME: config.images.experiment,
    CI_CONTROL_IMAGE_NAME: config.images.control,
  };

  console.log('Using images:');
  console.log(`  - Experiment: ${config.images.experiment}`);
  console.log(`  - Control: ${config.images.control}`);
  console.log('');

  for (const [name, image] of [
    ['Experiment', config.images.experiment],
    ['Control', config.images.control],
  ]) {
    if (!dockerImageExists(image)) {
      printWarning(`Image ${image} not found locally`);
      console.log('   Will build on first start (slower) or run:');
      console.log('   shaka-twin-servers build');
      console.log('');
    }
  }

  console.log('Ensuring bind-mount directories exist...');
  fs.mkdirSync(config.volumes.control, { recursive: true });
  fs.mkdirSync(config.volumes.experiment, { recursive: true });
  console.log(`   ${config.volumes.control}`);
  console.log(`   ${config.volumes.experiment}`);
  console.log('');

  const composeOptions = { composeFile: config.composeFile, cwd: config.projectDir, env: composeEnv };

  console.log('Stopping any existing twin servers...');
  await dockerComposeDown(composeOptions);

  console.log('Starting twin servers...');
  await dockerComposeUp(composeOptions);

  console.log('Waiting for containers to start...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('Checking container status...');
  await dockerComposePs(composeOptions);

  console.log('');
  console.log('Waiting for containers to be ready...');

  const controlReady = await waitForContainer(composeOptions, 'control-server');
  if (controlReady) {
    console.log('   control-server is ready');
  } else {
    printError('control-server failed to start');
    process.exit(1);
  }

  const experimentReady = await waitForContainer(composeOptions, 'experiment-server');
  if (experimentReady) {
    console.log('   experiment-server is ready');
  } else {
    printError('experiment-server failed to start');
    process.exit(1);
  }

  await Promise.all([
    setupDatabaseForServer(config, 'control', composeEnv),
    setupDatabaseForServer(config, 'experiment', composeEnv),
  ]);

  console.log('');
  printSuccess('Both servers are ready!');
  console.log('');
  printBanner('Twin Servers containers Started');
  console.log('');
  console.log('Edit project code inside containers:');
  console.log(`   Control:    ${config.volumes.control}`);
  console.log(`   Experiment: ${config.volumes.experiment}`);
  console.log('');
  console.log('Access container shells:');
  console.log('   docker compose exec control-server bash');
  console.log('   docker compose exec experiment-server bash');
  console.log('');
  console.log('Next steps:');
  console.log('   1. Start the servers:');
  console.log('      shaka-twin-servers start-servers');
  console.log('');
  console.log('   2. Stop containers when done:');
  console.log('      docker compose down');
  console.log('');
  console.log('   3. View logs:');
  console.log('      docker compose logs -f control-server');
  console.log('      docker compose logs -f experiment-server');
  console.log('');
}
