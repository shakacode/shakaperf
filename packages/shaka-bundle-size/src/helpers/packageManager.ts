import * as fs from 'fs';
import * as path from 'path';

type PackageManager = 'yarn' | 'npm' | 'pnpm' | 'bun';

/** Returns the command prefix for running a package bin (e.g., "yarn", "npx", "pnpm", "bun") */
export function getPackageRunCommand(): string {
  const pm = detectPackageManager();
  return pm === 'npm' ? 'npx' : pm;
}

/**
 * Finds the nearest package.json by walking up from cwd.
 */
function findPackageJson(): string | null {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) return pkgPath;
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Detects the package manager being used.
 * Priority: packageManager field in package.json > npm_config_user_agent > lock files
 */
export function detectPackageManager(): PackageManager {
  // 1. Check packageManager field in package.json (Corepack spec)
  const pkgPath = findPackageJson();
  if (pkgPath) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.packageManager) {
        const pm = pkg.packageManager.split('@')[0];
        if (pm === 'yarn' || pm === 'npm' || pm === 'pnpm' || pm === 'bun') {
          return pm;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 2. Check user agent (set when running via package manager)
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.startsWith('yarn')) return 'yarn';
    if (userAgent.startsWith('pnpm')) return 'pnpm';
    if (userAgent.startsWith('bun')) return 'bun';
    if (userAgent.startsWith('npm')) return 'npm';
  }

  // 3. Fall back to lock files
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return 'npm';

  return 'npm';
}
