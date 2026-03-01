const assert = require('assert');
const EventEmitter = require('events');

describe('runDocker', function () {
  let spawnMock;
  let spawnProcess;

  beforeEach(function () {
    jest.resetModules();
    spawnProcess = new EventEmitter();
    spawnMock = jest.fn().mockReturnValue(spawnProcess);
  });

  it('should run correct docker command', async function () {
    const originalCwd = process.cwd;
    process.cwd = () => '/path/mock';
    process.argv = ['test'];

    jest.doMock('child_process', () => ({ spawn: spawnMock }));
    jest.doMock('../../../package', () => ({ version: 'version.mock' }));

    const { runDocker } = require('../../../core/util/runDocker');

    const config = {
      args: {
        docker: true,
        config: 'my_config.json',
        filter: 'my_filter'
      }
    };

    const promise = runDocker(config, 'test');
    // Allow async operations inside runDocker to complete before spawn is called
    await new Promise(resolve => setImmediate(resolve));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    assert.strictEqual(
      spawnMock.mock.calls[0][0],
      'docker run --rm -it --mount type=bind,source="/path/mock",target=/src backstopjs/backstopjs:version.mock test' +
      ' "--moby=true" "--config=my_config.json" "--filter=my_filter"');

    // Resolve the promise by emitting exit
    spawnProcess.emit('exit', 0);
    await promise;

    process.cwd = originalCwd;
  });

  it('should not pass undefined args to docker', async function () {
    process.argv = ['test'];

    jest.doMock('child_process', () => ({ spawn: spawnMock }));

    const { runDocker } = require('../../../core/util/runDocker');

    const config = {
      args: {
        docker: true,
        filter: undefined
      }
    };

    const promise = runDocker(config, 'test');
    await new Promise(resolve => setImmediate(resolve));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    assert(!spawnMock.mock.calls[0][0].includes('--filter'));

    spawnProcess.emit('exit', 0);
    await promise;
  });

  it('should create tmp config file if config arg is an object', async function () {
    process.argv = ['test'];

    jest.doMock('../../../core/util/fs', () => ({
      writeFile: jest.fn().mockResolvedValue(),
      unlink: jest.fn().mockResolvedValue()
    }));
    jest.doMock('child_process', () => ({ spawn: spawnMock }));

    const { runDocker } = require('../../../core/util/runDocker');

    const config = {
      args: {
        docker: true,
        config: {
          id: 'i_am_a_config_object'
        }
      }
    };

    const promise = runDocker(config, 'test');
    await new Promise(resolve => setImmediate(resolve));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    assert(spawnMock.mock.calls[0][0].includes('--config=backstop.config-for-docker.json'));

    spawnProcess.emit('exit', 0);
    await promise;
  });
});
