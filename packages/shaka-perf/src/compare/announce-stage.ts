import chalk from 'chalk';

/**
 * Print a banner that frames the next stage in compare's run, with a short
 * explanation of what's about to happen and why. The two engines (visreg /
 * perf) and perf's internal sub-phases (warmup / measurements / low-noise)
 * all share this format so the log reads as a single timeline rather than
 * a stack of style-per-stage outputs.
 */
export function announceStage(stageName: string, description: string): void {
  const delimiter = '='.repeat(88);
  console.log('');
  console.log(chalk.cyan(delimiter));
  console.log(chalk.cyan(`STAGE: ${stageName}`));
  console.log(chalk.cyan(delimiter));
  console.log(description);
  console.log(chalk.cyan(delimiter));
  console.log('');
}
