/**
 * Reporter - Handles formatted output for bundle size checks.
 *
 * Provides colored console output with configurable verbosity levels.
 * Can be extended or replaced for custom output formats.
 */

import { colorize, ColorName, ANSI } from './helpers/colors';
import type {
  VerbosityLevel,
  CheckResult,
  IReporter,
  ReporterOptions,
  SizeIncreaseParams,
  SizeDecreaseParams,
  NewComponentParams,
  RemovedComponentParams,
  ChunksCountParams,
} from './types';

export { ANSI, colorize };

/**
 * Console reporter with colored output and configurable verbosity.
 */
export class Reporter implements IReporter {
  protected verbosity: VerbosityLevel;
  protected useColors: boolean;
  protected output: NodeJS.WriteStream;

  /**
   * Creates a new Reporter instance.
   */
  constructor(options: ReporterOptions = {}) {
    this.verbosity = options.verbosity || 'normal';
    this.useColors = options.colors !== false;
    this.output = options.output || process.stdout;
  }

  /**
   * Applies color if colors are enabled.
   */
  color(text: string, colorName: ColorName): string {
    if (!this.useColors) return text;
    return colorize[colorName] ? colorize[colorName](text) : text;
  }

  /**
   * Writes a line to output.
   */
  writeLine(message: string = ''): void {
    this.output.write(`${message}\n`);
  }

  /**
   * Logs an informational message.
   */
  info(message: string): void {
    if (this.verbosity === 'quiet') return;
    this.writeLine(message);
  }

  /**
   * Logs a success message in green.
   */
  success(message: string): void {
    if (this.verbosity === 'quiet') return;
    this.writeLine(this.color(message, 'green'));
  }

  /**
   * Logs a warning message in yellow.
   */
  warning(message: string): void {
    this.writeLine(this.color(message, 'yellow'));
  }

  /**
   * Logs an error message in red.
   */
  error(message: string): void {
    this.writeLine(this.color(message, 'red'));
  }

  /**
   * Logs a section header.
   */
  header(title: string): void {
    if (this.verbosity === 'quiet') return;
    this.writeLine('');
    this.writeLine('='.repeat(80));
    this.writeLine(this.color(title, 'blue'));
    this.writeLine('='.repeat(80));
  }

  /**
   * Logs a verbose message (only shown in verbose mode).
   */
  verbose(message: string): void {
    if (this.verbosity !== 'verbose') return;
    this.writeLine(this.color(message, 'dim'));
  }

  /**
   * Reports a size increase regression.
   */
  reportSizeIncrease({ componentName, sizeDiffKb, actualSizeKb, expectedSizeKb }: SizeIncreaseParams): void {
    const message = `Size of ${componentName} increased by ${sizeDiffKb.toFixed(2)} KB. ` +
      `Actual: ${actualSizeKb.toFixed(3)} KB. Expected: ${expectedSizeKb} KB.`;
    this.error(message);
  }

  /**
   * Reports a size decrease (improvement).
   */
  reportSizeDecrease({ componentName, sizeDiffKb, actualSizeKb, expectedSizeKb }: SizeDecreaseParams): void {
    const message = `Size of ${componentName} reduced by ${sizeDiffKb.toFixed(2)} KB. ` +
      `Actual: ${actualSizeKb.toFixed(3)} KB. Expected: ${expectedSizeKb} KB.`;
    this.success(message);
  }

  /**
   * Reports a new component introduction.
   */
  reportNewComponent({ componentName, sizeKb, chunksCount }: NewComponentParams): void {
    const isUncategorized = componentName === 'uncategorized chunks';
    const message = isUncategorized
      ? `This branch introduced ${chunksCount} uncategorized ${chunksCount === 1 ? 'chunk' : 'chunks'} ${sizeKb.toFixed(2)} KB.`
      : `This branch introduced a new component ${componentName} ${sizeKb.toFixed(2)} KB.`;
    this.warning(message);
  }

  /**
   * Reports a removed component.
   */
  reportRemovedComponent({ componentName, sizeKb }: RemovedComponentParams): void {
    const isUncategorized = componentName === 'uncategorized chunks';
    const message = isUncategorized
      ? `This branch removed all uncategorized chunks (was ${sizeKb} KB).`
      : `This branch removed component ${componentName} (was ${sizeKb} KB).`;
    this.info(this.color(message, 'blue'));
  }

  /**
   * Reports an increased chunks count.
   */
  reportIncreasedChunksCount({ componentName, actualCount, expectedCount }: ChunksCountParams): void {
    const message = `This branch increased chunks count for ${componentName}. ` +
      `New chunks count: ${actualCount}, expected ${expectedCount}.`;
    this.error(message);
  }

  /**
   * Reports that all components passed.
   */
  reportPassed(): void {
    this.info('All loadable components are within the expected size');
  }

  /**
   * Reports the final summary of the check.
   */
  summary(result: CheckResult): void {
    if (result.passed) {
      this.writeLine('');
      this.success('All bundle size checks passed!');
      return;
    }

    this.writeLine('');
    this.error('\n\nThe test failed!');
    this.info(`${result.regressions.length} regression(s) detected`);
  }
}

/**
 * Silent reporter that produces no output.
 * Useful for testing or when only the result data is needed.
 */
export class SilentReporter extends Reporter {
  constructor() {
    super({ verbosity: 'quiet' });
  }

  writeLine(): void {}
  info(): void {}
  success(): void {}
  warning(): void {}
  error(): void {}
  header(): void {}
  verbose(): void {}
  summary(): void {}
}
