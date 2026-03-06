import usage from '../../cli/usage.js';
import assert from 'node:assert';

const expectedUsage = /Welcome to shaka-visreg/;

describe('the cli usage', function () {
  it('should print usage hints correctly', function () {
    assert(expectedUsage.test(usage));
  });

  it('should include liveCompare command', function () {
    assert(/liveCompare/.test(usage), 'Usage should include liveCompare command');
  });

  it('should describe liveCompare with reference and test URLs', function () {
    assert(/reference.*test.*URLs|test.*reference.*URLs/i.test(usage),
      'liveCompare description should mention reference and test URLs');
  });

  it('should mention retry logic in liveCompare description', function () {
    assert(/retry/i.test(usage), 'liveCompare description should mention retry logic');
  });

  it('should include all standard commands', function () {
    const standardCommands = ['init', 'openReport', 'liveCompare'];
    standardCommands.forEach(function (cmd) {
      assert(new RegExp(cmd).test(usage), 'Usage should include ' + cmd + ' command');
    });
  });

  it('should not include removed commands as top-level entries', function () {
    const removedCommands = ['remote', 'approve'];
    removedCommands.forEach(function (cmd) {
      // Check that the command doesn't appear as a top-level entry (indented command name)
      assert(!new RegExp('^\\s+' + cmd + '\\s', 'm').test(usage), 'Usage should not include removed ' + cmd + ' command');
    });
  });
});
