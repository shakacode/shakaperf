import chalk from 'chalk';

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
