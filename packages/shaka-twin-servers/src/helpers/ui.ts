const supportsColor = process.stdout.isTTY;

const colors = {
  red: supportsColor ? '\x1b[31m' : '',
  green: supportsColor ? '\x1b[32m' : '',
  yellow: supportsColor ? '\x1b[33m' : '',
  blue: supportsColor ? '\x1b[34m' : '',
  reset: supportsColor ? '\x1b[0m' : '',
};

export function printError(message: string): void {
  console.error(`${colors.red}Error: ${message}${colors.reset}`);
}

export function printSuccess(message: string): void {
  console.log(`${colors.green}${message}${colors.reset}`);
}

export function printWarning(message: string): void {
  console.log(`${colors.yellow}Warning: ${message}${colors.reset}`);
}

export function printInfo(message: string): void {
  console.log(`${colors.blue}${message}${colors.reset}`);
}

export function printBanner(title: string): void {
  const line = '='.repeat(title.length + 4);
  console.log('');
  console.log(`${colors.blue}${line}${colors.reset}`);
  console.log(`${colors.blue}  ${title}  ${colors.reset}`);
  console.log(`${colors.blue}${line}${colors.reset}`);
  console.log('');
}
