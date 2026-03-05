import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export default function findExecutable (module: string, bin: string) {
  const _require = createRequire(import.meta.url);
  try {
    const pathToExecutableModulePackageJson = _require.resolve(path.join(module, 'package.json'));
    const executableModulePackageJson = JSON.parse(readFileSync(pathToExecutableModulePackageJson, 'utf8'));
    const relativePathToExecutableBinary = executableModulePackageJson.bin[bin] || executableModulePackageJson.bin;
    const pathToExecutableModule = pathToExecutableModulePackageJson.replace('package.json', '');
    return path.join(pathToExecutableModule, relativePathToExecutableBinary);
  } catch (e) {
    throw new Error('Couldn\'t find executable for module "' + module + '" and bin "' + bin + '"\n' + e.message);
  }
};
