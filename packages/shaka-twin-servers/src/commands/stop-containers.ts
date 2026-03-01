import type { ResolvedConfig } from '../types';
import { dockerComposeDown } from '../helpers/docker';
import { printBanner, printSuccess } from '../helpers/ui';

export interface StopContainersOptions {
  verbose?: boolean;
}

export async function stopContainers(
  config: ResolvedConfig,
  options: StopContainersOptions = {}
): Promise<void> {
  printBanner('Stopping Twin Servers');

  console.log('Stopping containers and removing volumes...');
  await dockerComposeDown(config);

  printSuccess('Containers stopped');
}
