import executeCommand from './command/index';
import makeConfig from './util/makeConfig';
import type { RuntimeConfig } from './types';

export default async function (command: string, options?: Record<string, unknown>) {
  const config = await makeConfig(command, options) as RuntimeConfig;
  return executeCommand(command, config);
}
