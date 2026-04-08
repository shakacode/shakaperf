import * as fs from 'fs';
import type { ResolvedConfig } from '../types';
import {
  dockerImageExists,
  dockerComposeUp,
  dockerComposeDown,
  dockerComposePs,
  waitForContainer,
} from '../helpers/docker';
import { printBanner, printSuccess, printError, printWarning } from '../helpers/ui';
import { runCmdParallel } from './run-cmd-parallel';

export interface StartContainersOptions {
  verbose?: boolean;
}

export async function startContainers(
  config: ResolvedConfig,
  options: StartContainersOptions = {}
): Promise<void> {
  const { verbose } = options;

  printBanner('Starting Twin Containers Locally');

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

  console.log('Stopping any existing twin containers...');
  await dockerComposeDown(config);

  console.log('Clearing stale volume contents...');
  fs.rmSync(config.volumes.control, { recursive: true, force: true });
  fs.rmSync(config.volumes.experiment, { recursive: true, force: true });
  fs.mkdirSync(config.volumes.control, { recursive: true });
  fs.mkdirSync(config.volumes.experiment, { recursive: true });
  console.log(`   ${config.volumes.control}`);
  console.log(`   ${config.volumes.experiment}`);
  console.log('');

  console.log('Starting twin containers...');
  await dockerComposeUp(config);

  console.log('Waiting for containers to start...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('Checking container status...');
  await dockerComposePs(config);

  console.log('');
  console.log('Waiting for containers to be ready...');

  const controlReady = await waitForContainer(config, 'control-server');
  if (controlReady) {
    console.log('   control-server is ready');
  } else {
    printError('control-server failed to start');
    process.exit(1);
  }

  const experimentReady = await waitForContainer(config, 'experiment-server');
  if (experimentReady) {
    console.log('   experiment-server is ready');
  } else {
    printError('experiment-server failed to start');
    process.exit(1);
  }

  if (config.setupCommands.length > 0) {
    console.log('');
    console.log('Running setup commands...');
    const setupScript = config.setupCommands.map(c => c.command).join(' && ');
    await runCmdParallel(config, setupScript);
  }

  console.log('');
  printSuccess('Both servers are ready!');
  console.log('');
  printBanner('Twin Containers Started');
  console.log('');
  console.log('Edit project code inside containers:');
  console.log(`   Control:    ${config.volumes.control}`);
  console.log(`   Experiment: ${config.volumes.experiment}`);
  console.log('');
  console.log('Access container shells:');
  console.log('   yarn shaka-twin-servers run-cmd control bash');
  console.log('   yarn shaka-twin-servers run-cmd experiment bash');
  console.log('');
  console.log('Next steps:');
  console.log('   1. Start the servers:');
  console.log('      yarn shaka-twin-servers start-servers');
  console.log('');
  console.log('   2. Stop containers when done:');
  console.log('      yarn shaka-twin-servers stop-containers');
  console.log('');
}
