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
  Regression,
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
    if (!result.comparison) {
      this.summaryLegacy(result);
      return;
    }

    const { comparison, regressions, warnings } = result;

    // Build regression lookup by component name
    const failuresByComponent = new Map<string, Regression[]>();
    for (const reg of regressions) {
      const list = failuresByComponent.get(reg.componentName) ?? [];
      list.push(reg);
      failuresByComponent.set(reg.componentName, list);
    }
    const warningsByComponent = new Map<string, Regression[]>();
    for (const reg of warnings) {
      const list = warningsByComponent.get(reg.componentName) ?? [];
      list.push(reg);
      warningsByComponent.set(reg.componentName, list);
    }

    // Track which components have chunks count increases
    const chunksIncreaseSet = new Set(comparison.chunksCountIncreases.map(c => c.name));

    // 1. New components
    for (const comp of comparison.newComponents) {
      const isUncategorized = comp.name === 'uncategorized chunks';
      const desc = isUncategorized
        ? `${comp.chunksCount} new uncategorized ${comp.chunksCount === 1 ? 'chunk' : 'chunks'}, ${comp.gzipSizeKb.toFixed(2)} KB`
        : `new component, ${comp.gzipSizeKb.toFixed(2)} KB`;
      this.writeComponentEntry(comp.name, desc, 'yellow', failuresByComponent, warningsByComponent);
    }

    // 2. Existing components with size changes
    for (const actual of result.actualSizes) {
      const expected = result.expectedSizes.find(c => c.name === actual.name);
      if (!expected) continue; // new component, already handled above

      const actualSizeKb = Number(actual.gzipSizeKb.toFixed(2));
      const expectedSizeKb = Number(expected.gzipSizeKb);
      const sizeDiffKb = actualSizeKb - expectedSizeKb;
      const hasChunksIncrease = chunksIncreaseSet.has(actual.name);

      if (sizeDiffKb > 0.01) {
        let desc = `size increased by ${sizeDiffKb.toFixed(2)} KB — ${actual.gzipSizeKb.toFixed(3)} KB (was ${expectedSizeKb} KB)`;
        if (hasChunksIncrease) {
          const ci = comparison.chunksCountIncreases.find(c => c.name === actual.name)!;
          desc += `, chunks: ${ci.actualChunksCount} (was ${ci.expectedChunksCount})`;
        }
        this.writeComponentEntry(actual.name, desc, 'red', failuresByComponent, warningsByComponent);
      } else if (sizeDiffKb < 0) {
        const desc = `size reduced by ${(-sizeDiffKb).toFixed(2)} KB — ${actual.gzipSizeKb.toFixed(3)} KB (was ${expectedSizeKb} KB)`;
        this.writeComponentEntry(actual.name, desc, 'green', failuresByComponent, warningsByComponent);
      } else if (hasChunksIncrease) {
        const ci = comparison.chunksCountIncreases.find(c => c.name === actual.name)!;
        const desc = `chunks count increased — ${ci.actualChunksCount} chunks (was ${ci.expectedChunksCount})`;
        this.writeComponentEntry(actual.name, desc, 'red', failuresByComponent, warningsByComponent);
      }
    }

    // 3. Removed components
    for (const comp of comparison.removedComponents) {
      const isUncategorized = comp.name === 'uncategorized chunks';
      const desc = isUncategorized
        ? `all uncategorized chunks removed (was ${comp.gzipSizeKb} KB)`
        : `removed (was ${comp.gzipSizeKb} KB)`;
      this.writeComponentEntry(comp.name, desc, 'blue', failuresByComponent, warningsByComponent);
    }

    // Final result
    if (result.passed) {
      this.success('\nAll bundle size checks passed!');
    } else {
      this.error('\nThe test failed!');
      this.info(`${result.regressions.length} regression(s) detected`);
    }
  }

  private writeComponentEntry(
    name: string,
    description: string,
    defaultColor: ColorName,
    failuresByComponent: Map<string, Regression[]>,
    warningsByComponent: Map<string, Regression[]>,
  ): void {
    const failures = failuresByComponent.get(name) ?? [];
    const componentWarnings = warningsByComponent.get(name) ?? [];
    const hasFailure = failures.length > 0;

    // Use red color if there are failures for this component
    const lineColor = hasFailure ? 'red' : defaultColor;
    this.writeLine(this.color(`${name}: ${description}`, lineColor));

    for (const reg of failures) {
      if (reg.policyMessage) {
        this.error(`  FAILED : ${reg.policyMessage}`);
      }
    }
    for (const reg of componentWarnings) {
      if (reg.policyMessage) {
        this.warning(`  IGNORED: ${reg.policyMessage}`);
      }
    }
  }

  /** Fallback for CheckResult without comparison data */
  private summaryLegacy(result: CheckResult): void {
    if (result.warnings.length > 0) {
      this.warning('\nIgnored regressions:');
      for (const regression of result.warnings) {
        this.warning(`- ${regression.componentName}: ${regression.policyMessage ?? ''}`);
      }
    }

    if (result.passed) {
      this.success('\nAll bundle size checks passed!');
      return;
    }

    this.error('\nThe test failed!');
    this.info(`${result.regressions.length} regression(s) detected`);
    for (const regression of result.regressions) {
      this.error(`- ${regression.componentName}: ${regression.policyMessage ?? ''}`);
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
