import { jest } from '@jest/globals';
import assert from 'node:assert';
import packageJson from '../../../package.json' with { type: 'json' };

const { version } = packageJson;

describe('runDocker', function () {
  it('should run correct docker command', async function () {
    const originalCwd = process.cwd;
    process.cwd = () => '/path/mock';
    process.argv = ['test'];

    try {
      jest.resetModules();

      let capturedCommand;
      const spawnMock = jest.fn().mockImplementation(function (dockerCommand) {
        capturedCommand = dockerCommand;
        return {
          on: jest.fn<any>().mockImplementation(function (event, cb) {
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

      const promise = runDocker(config, 'test');
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

    let capturedCommand;
    const spawnMock = jest.fn().mockImplementation(function (dockerCommand) {
      capturedCommand = dockerCommand;
      return {
        on: jest.fn<any>().mockImplementation(function (event, cb) {
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
        filter: undefined
      }
    };

    const promise = runDocker(config, 'test');
    await promise;

    assert(!capturedCommand.includes('--filter'));
  });

  it('should create tmp config file if config arg is an object', async function () {
    process.argv = ['test'];

    jest.resetModules();

    let capturedCommand;
    const spawnMock = jest.fn().mockImplementation(function (dockerCommand) {
      capturedCommand = dockerCommand;
      return {
        on: jest.fn<any>().mockImplementation(function (event, cb) {
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
      writeFile: jest.fn<any>().mockResolvedValue(undefined),
      unlink: jest.fn<any>().mockResolvedValue(undefined)
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

    const promise = runDocker(config, 'test');
    await promise;

    assert(capturedCommand.includes('--config=backstop.config-for-docker.json'));
  });
});
