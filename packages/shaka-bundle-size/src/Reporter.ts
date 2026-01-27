/**
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

export class Reporter implements IReporter {
  protected verbosity: VerbosityLevel;
  protected useColors: boolean;
  protected output: NodeJS.WriteStream;

  constructor(options: ReporterOptions = {}) {
    this.verbosity = options.verbosity || 'normal';
    this.useColors = options.colors !== false;
    this.output = options.output || process.stdout;
  }

  color(text: string, colorName: ColorName): string {
    if (!this.useColors) return text;
    return colorize[colorName] ? colorize[colorName](text) : text;
  }

  writeLine(message: string = ''): void {
    this.output.write(`${message}\n`);
  }

  info(message: string): void {
    if (this.verbosity === 'quiet') return;
    this.writeLine(message);
  }

  success(message: string): void {
    if (this.verbosity === 'quiet') return;
    this.writeLine(this.color(message, 'green'));
  }

  warning(message: string): void {
    this.writeLine(this.color(message, 'yellow'));
  }

  error(message: string): void {
    this.writeLine(this.color(message, 'red'));
  }

  header(title: string): void {
    if (this.verbosity === 'quiet') return;
    this.writeLine('');
    this.writeLine('='.repeat(80));
    this.writeLine(this.color(title, 'blue'));
    this.writeLine('='.repeat(80));
  }

  verbose(message: string): void {
    if (this.verbosity !== 'verbose') return;
    this.writeLine(this.color(message, 'dim'));
  }

  reportSizeIncrease({ componentName, sizeDiffKb, actualSizeKb, expectedSizeKb }: SizeIncreaseParams): void {
    const message = `Size of ${componentName} increased by ${sizeDiffKb.toFixed(2)} KB. ` +
      `Actual: ${actualSizeKb.toFixed(3)} KB. Expected: ${expectedSizeKb} KB.`;
    this.error(message);
  }

  reportSizeDecrease({ componentName, sizeDiffKb, actualSizeKb, expectedSizeKb }: SizeDecreaseParams): void {
    const message = `Size of ${componentName} reduced by ${sizeDiffKb.toFixed(2)} KB. ` +
      `Actual: ${actualSizeKb.toFixed(3)} KB. Expected: ${expectedSizeKb} KB.`;
    this.success(message);
  }

  reportNewComponent({ componentName, sizeKb, chunksCount }: NewComponentParams): void {
    const isUncategorized = componentName === 'uncategorized chunks';
    const message = isUncategorized
      ? `This branch introduced ${chunksCount} uncategorized ${chunksCount === 1 ? 'chunk' : 'chunks'} ${sizeKb.toFixed(2)} KB.`
      : `This branch introduced a new component ${componentName} ${sizeKb.toFixed(2)} KB.`;
    this.warning(message);
  }

  reportRemovedComponent({ componentName, sizeKb }: RemovedComponentParams): void {
    const isUncategorized = componentName === 'uncategorized chunks';
    const message = isUncategorized
      ? `This branch removed all uncategorized chunks (was ${sizeKb} KB).`
      : `This branch removed component ${componentName} (was ${sizeKb} KB).`;
    this.info(this.color(message, 'blue'));
  }

  reportIncreasedChunksCount({ componentName, actualCount, expectedCount }: ChunksCountParams): void {
    const message = `This branch increased chunks count for ${componentName}. ` +
      `New chunks count: ${actualCount}, expected ${expectedCount}.`;
    this.error(message);
  }

  reportPassed(): void {
    this.info('All loadable components are within the expected size');
  }

  summary(result: CheckResult): void {
    if (result.warnings.length > 0) {
      this.warning('\nThe following regressions do not fail regression policy:');
      for (const regression of result.warnings) {
        this.warning(`- ${regression.componentName}: [${regression.type}] ${regression.policyMessage ?? ''}`);
      }
    }

    if (result.passed) {
      this.success('\nAll bundle size checks passed!');
      return;
    }

    this.error('\nThe test failed!');
    this.info(`${result.regressions.length} regression(s) detected`);
    for (const regression of result.regressions) {
      this.error(`- ${regression.componentName}: [${regression.type}] ${regression.policyMessage ?? ''}`);
    }
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
