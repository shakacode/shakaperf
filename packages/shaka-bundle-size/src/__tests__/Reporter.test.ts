import { Writable } from 'stream';
import { Reporter, SilentReporter, ANSI } from '../Reporter';
import type { CheckResult, IReporter } from '../types';
import { RegressionType } from '../types';

function createOutputStream(): { stream: NodeJS.WriteStream; getOutput: () => string } {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  }) as unknown as NodeJS.WriteStream;

  return { stream, getOutput: () => output };
}

describe('Reporter', () => {
  describe('constructor', () => {
    it('defaults to normal verbosity with colors', () => {
      const { stream } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.info('test');
      // Should produce output in normal mode
    });
  });

  describe('color', () => {
    it('applies color when colors enabled', () => {
      const { stream } = createOutputStream();
      const reporter = new Reporter({ output: stream, colors: true });
      expect(reporter.color('text', 'red')).toContain(ANSI.RED);
    });

    it('returns plain text when colors disabled', () => {
      const { stream } = createOutputStream();
      const reporter = new Reporter({ output: stream, colors: false });
      expect(reporter.color('text', 'red')).toBe('text');
    });
  });

  describe('info', () => {
    it('outputs message in normal mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'normal' });
      reporter.info('hello');
      expect(getOutput()).toContain('hello');
    });

    it('suppresses output in quiet mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'quiet' });
      reporter.info('hello');
      expect(getOutput()).toBe('');
    });
  });

  describe('success', () => {
    it('outputs green message in normal mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'normal' });
      reporter.success('passed');
      expect(getOutput()).toContain('passed');
      expect(getOutput()).toContain(ANSI.GREEN);
    });

    it('suppresses output in quiet mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'quiet' });
      reporter.success('passed');
      expect(getOutput()).toBe('');
    });
  });

  describe('warning', () => {
    it('outputs yellow message even in quiet mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'quiet' });
      reporter.warning('warn!');
      expect(getOutput()).toContain('warn!');
    });
  });

  describe('error', () => {
    it('outputs red message', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.error('fail');
      expect(getOutput()).toContain('fail');
      expect(getOutput()).toContain(ANSI.RED);
    });
  });

  describe('header', () => {
    it('outputs title with separators in normal mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'normal' });
      reporter.header('My Section');
      const output = getOutput();
      expect(output).toContain('My Section');
      expect(output).toContain('='.repeat(80));
    });

    it('suppresses output in quiet mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'quiet' });
      reporter.header('My Section');
      expect(getOutput()).toBe('');
    });
  });

  describe('verbose', () => {
    it('outputs message only in verbose mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'verbose' });
      reporter.verbose('debug info');
      expect(getOutput()).toContain('debug info');
    });

    it('suppresses output in normal mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'normal' });
      reporter.verbose('debug info');
      expect(getOutput()).toBe('');
    });

    it('suppresses output in quiet mode', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream, verbosity: 'quiet' });
      reporter.verbose('debug info');
      expect(getOutput()).toBe('');
    });
  });

  describe('reportSizeIncrease', () => {
    it('reports size increase with formatted values', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportSizeIncrease({
        componentName: 'Header',
        sizeDiffKb: 5.123,
        actualSizeKb: 105.456,
        expectedSizeKb: 100.333,
      });
      const output = getOutput();
      expect(output).toContain('Header');
      expect(output).toContain('5.12');
      expect(output).toContain('105.456');
    });
  });

  describe('reportSizeDecrease', () => {
    it('reports size decrease with formatted values', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportSizeDecrease({
        componentName: 'Footer',
        sizeDiffKb: 3.567,
        actualSizeKb: 96.789,
        expectedSizeKb: 100.356,
      });
      const output = getOutput();
      expect(output).toContain('Footer');
      expect(output).toContain('reduced');
      expect(output).toContain('3.57');
    });
  });

  describe('reportNewComponent', () => {
    it('reports a new named component', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportNewComponent({
        componentName: 'NewWidget',
        sizeKb: 25.5,
        chunksCount: 3,
      });
      const output = getOutput();
      expect(output).toContain('NewWidget');
      expect(output).toContain('25.50');
    });

    it('reports uncategorized chunks differently', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportNewComponent({
        componentName: 'uncategorized chunks',
        sizeKb: 10.0,
        chunksCount: 5,
      });
      const output = getOutput();
      expect(output).toContain('uncategorized');
      expect(output).toContain('5');
    });

    it('uses singular chunk for count of 1', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportNewComponent({
        componentName: 'uncategorized chunks',
        sizeKb: 10.0,
        chunksCount: 1,
      });
      const output = getOutput();
      expect(output).toContain('1 uncategorized chunk ');
    });
  });

  describe('reportRemovedComponent', () => {
    it('reports a removed named component', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportRemovedComponent({
        componentName: 'OldWidget',
        sizeKb: '50.00',
      });
      const output = getOutput();
      expect(output).toContain('OldWidget');
      expect(output).toContain('50.00');
    });

    it('reports uncategorized chunks differently', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportRemovedComponent({
        componentName: 'uncategorized chunks',
        sizeKb: '10.00',
      });
      const output = getOutput();
      expect(output).toContain('removed all uncategorized chunks');
    });
  });

  describe('reportIncreasedChunksCount', () => {
    it('reports chunks count increase', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportIncreasedChunksCount({
        componentName: 'App',
        actualCount: 5,
        expectedCount: 3,
      });
      const output = getOutput();
      expect(output).toContain('App');
      expect(output).toContain('5');
      expect(output).toContain('3');
    });
  });

  describe('reportPassed', () => {
    it('outputs passing message', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      reporter.reportPassed();
      expect(getOutput()).toContain('within the expected size');
    });
  });

  describe('summary', () => {
    it('outputs success message when passed', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      const result: CheckResult = {
        passed: true,
        regressions: [],
        warnings: [],
        actualSizes: [],
        expectedSizes: [],
      };
      reporter.summary(result);
      expect(getOutput()).toContain('passed');
    });

    it('outputs failure message with regressions', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      const result: CheckResult = {
        passed: false,
        regressions: [
          {
            componentName: 'App',
            type: RegressionType.INCREASED_SIZE,
            policyMessage: 'Size too big',
          },
        ],
        warnings: [],
        actualSizes: [],
        expectedSizes: [],
      };
      reporter.summary(result);
      const output = getOutput();
      expect(output).toContain('failed');
      expect(output).toContain('1 regression');
      expect(output).toContain('App');
    });

    it('outputs warnings when present', () => {
      const { stream, getOutput } = createOutputStream();
      const reporter = new Reporter({ output: stream });
      const result: CheckResult = {
        passed: true,
        regressions: [],
        warnings: [
          {
            componentName: 'Footer',
            type: RegressionType.INCREASED_SIZE,
            policyMessage: 'Small increase',
          },
        ],
        actualSizes: [],
        expectedSizes: [],
      };
      reporter.summary(result);
      const output = getOutput();
      expect(output).toContain('do not fail');
      expect(output).toContain('Footer');
    });
  });
});

describe('SilentReporter', () => {
  let consoleSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('produces no output for info', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.info('test');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('produces no output for success', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.success('test');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('produces no output for warning', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.warning('test');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('produces no output for error', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.error('test');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('produces no output for header', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.header('test');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('produces no output for verbose', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.verbose('test');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('produces no output for summary', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.summary({
      passed: true,
      regressions: [],
      warnings: [],
      actualSizes: [],
      expectedSizes: [],
    });
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('produces no output for reportPassed', () => {
    const reporter: IReporter = new SilentReporter();
    reporter.reportPassed();
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
