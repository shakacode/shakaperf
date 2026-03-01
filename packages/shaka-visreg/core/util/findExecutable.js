import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export default function findExecutable (module, bin) {
  try {
    const pathToExecutableModulePackageJson = require.resolve(path.join(module, 'package.json'));
    const executableModulePackageJson = require(pathToExecutableModulePackageJson);
    const relativePathToExecutableBinary = executableModulePackageJson.bin[bin] || executableModulePackageJson.bin;
    const pathToExecutableModule = pathToExecutableModulePackageJson.replace('package.json', '');
    return path.join(pathToExecutableModule, relativePathToExecutableBinary);
  } catch (e) {
    throw new Error('Couldn\'t find executable for module "' + module + '" and bin "' + bin + '"\n' + e.message);
  }
};
