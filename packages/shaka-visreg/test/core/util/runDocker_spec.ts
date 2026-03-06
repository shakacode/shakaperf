import { jest } from '@jest/globals';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import type { RuntimeConfig } from '../../../core/types.js';

const _require = createRequire(import.meta.url);
const packageJson = _require('../../../package.json');
const { version } = packageJson;

describe('runDocker', function () {
  it('should run correct docker command', async function () {
    const originalCwd = process.cwd;
    process.cwd = () => '/path/mock';
    process.argv = ['test'];

    try {
      jest.resetModules();

      let capturedCommand: string | undefined;
      const spawnMock = jest.fn().mockImplementation(function (...args: unknown[]) {
        capturedCommand = args[0] as string;
        return {
          on: jest.fn().mockImplementation(function (...onArgs: unknown[]) {
            const event = onArgs[0] as string;
            const cb = onArgs[1] as (...cbArgs: unknown[]) => void;
            if (event === 'exit') {
              setImmediate(() => cb(0));
            }
          })
        };
      });

      jest.unstable_mockModule('node:child_process', () => ({
        spawn: spawnMock
      }));

      const { runDocker } = await import('../../../core/util/runDocker.js');

      const config = {
        args: {
          docker: true,
          config: 'my_config.json',
          filter: 'my_filter'
        }
      };

      const promise = runDocker(config as unknown as RuntimeConfig, 'test');
      await promise;

      assert.strictEqual(
        capturedCommand,
        `docker run --rm -it --mount type=bind,source="/path/mock",target=/src backstopjs/backstopjs:${version} test` +
        ' "--moby=true" "--config=my_config.json" "--filter=my_filter"');
    } finally {
      process.cwd = originalCwd;
    }
  });

  it('should not pass undefined args to docker', async function () {
    process.argv = ['test'];

    jest.resetModules();

    let capturedCommand: string | undefined;
    const spawnMock = jest.fn().mockImplementation(function (...args: unknown[]) {
      capturedCommand = args[0] as string;
      return {
        on: jest.fn().mockImplementation(function (...onArgs: unknown[]) {
            const event = onArgs[0] as string;
            const cb = onArgs[1] as (...cbArgs: unknown[]) => void;
          if (event === 'exit') {
            setImmediate(() => cb(0));
          }
        })
      };
    });

    jest.unstable_mockModule('node:child_process', () => ({
      spawn: spawnMock
    }));

    const { runDocker } = await import('../../../core/util/runDocker.js');

    const config = {
      args: {
        docker: true,
        filter: undefined as string | undefined
      }
    };

    const promise = runDocker(config as unknown as RuntimeConfig, 'test');
    await promise;

    assert(!capturedCommand!.includes('--filter'));
  });

  it('should create tmp config file if config arg is an object', async function () {
    process.argv = ['test'];

    jest.resetModules();

    let capturedCommand: string | undefined;
    const spawnMock = jest.fn().mockImplementation(function (...args: unknown[]) {
      capturedCommand = args[0] as string;
      return {
        on: jest.fn().mockImplementation(function (...onArgs: unknown[]) {
            const event = onArgs[0] as string;
            const cb = onArgs[1] as (...cbArgs: unknown[]) => void;
          if (event === 'exit') {
            setImmediate(() => cb(0));
          }
        })
      };
    });

    jest.unstable_mockModule('node:child_process', () => ({
      spawn: spawnMock
    }));
    jest.unstable_mockModule('node:fs/promises', () => ({
      writeFile: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      unlink: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
    }));

    const { runDocker } = await import('../../../core/util/runDocker.js');

    const config = {
      args: {
        docker: true,
        config: {
          id: 'i_am_a_config_object'
        }
      }
    };

    const promise = runDocker(config as unknown as RuntimeConfig, 'test');
    await promise;

    assert(capturedCommand!.includes('--config=backstop.config-for-docker.json'));
  });
});
