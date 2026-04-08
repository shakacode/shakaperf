import _ from 'lodash';
import createLogger from '../util/logger';
import * as init from './init';
import * as report from './report';
import * as compare from './compare';
import * as version from './version';
import type { RuntimeConfig } from '../types';

const logger = createLogger('COMMAND');

/*
 * Each file included in this folder (except `index.js`) is a command and must export the following object
 * {
 *   execute: (...args) => void  | command itself
 * }
 *
 * The execute function should not have much logic
 */

const commandModules: Record<string, { execute: (config: RuntimeConfig) => any }> = { init, report, compare, version };

/* Each and every command defined, including commands used in before/after */
const commandNames = [
  'init',
  'report',
  'compare',
  'version'
];

/* Commands that are only exposed to higher levels */
const exposedCommandNames = [
  'init',
  'compare',
  'version'
];

interface CommandEntry {
  name: string;
  execute: (config: RuntimeConfig) => Promise<unknown>;
}

/* Used to convert an array of objects {name, execute} to a unique object {[name]: execute} */
function toObjectReducer (object: Record<string, (config: RuntimeConfig) => Promise<unknown>>, command: CommandEntry) {
  object[command.name] = command.execute;
  return object;
}

const commands = commandNames
  .map(function requireCommand (commandName: string) {
    return {
      name: commandName,
      commandDefinition: commandModules[commandName]
    };
  })
  .map(function definitionToExecution (command: { name: string; commandDefinition: { execute: (config: RuntimeConfig) => any } }) {
    return {
      name: command.name,
      execute: function execute (config: RuntimeConfig) {
        config.perf[command.name] = Date.now();
        logger.info('Executing core for "' + command.name + '"');

        let promise = command.commandDefinition.execute(config);

        // If the command didn't return a promise, assume it resolved already
        if (!promise) {
          logger.error('Resolved already:' + command.name);
          promise = Promise.resolve();
        }

        // Do the catch separately or the main runner
        // won't be able to catch it a second time
        promise.catch(function (error: unknown) {
          const perf = (Date.now() - config.perf[command.name]) / 1000;
          logger.error('Command "' + command.name + '" ended with an error after [' + perf + 's]');
          logger.error(String(error));
        });

        return promise.then(function (result: unknown) {
          const perf = (Date.now() - config.perf[command.name]) / 1000;
          logger.success('Command "' + command.name + '" successfully executed in [' + perf + 's]');
          return result;
        });
      }
    };
  })
  .reduce(toObjectReducer, {} as Record<string, (config: RuntimeConfig) => Promise<unknown>>);

const exposedCommands = exposedCommandNames
  .filter(function commandIsDefined (commandName: string) {
    return _.has(commands, commandName);
  })
  .map(function (commandName: string) {
    return {
      name: commandName,
      execute: commands[commandName]
    };
  })
  .reduce(toObjectReducer, {} as Record<string, (config: RuntimeConfig) => Promise<unknown>>);

function execute (commandName: string, config: RuntimeConfig) {
  if (!_.has(exposedCommands, commandName)) {
    if (commandName.charAt(0) === '_' && _.has(commands, commandName.substring(1))) {
      commandName = commandName.substring(1);
    } else {
      throw new Error('The command "' + commandName + '" is not exposed publicly.');
    }
  }

  return commands[commandName](config);
}

export default execute;
