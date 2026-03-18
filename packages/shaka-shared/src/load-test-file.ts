import * as path from 'path';

export async function loadTestFile(testFilePath: string): Promise<void> {
  const absolutePath = path.resolve(testFilePath);
  const ext = path.extname(absolutePath);

  if (ext === '.ts') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tsImport } = require('tsx/esm/api');
      await tsImport(absolutePath, __filename);
    } catch (esmError) {
      // Fallback to CJS API (e.g. Node 18 CommonJS context)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tsx = require('tsx/cjs/api');
      tsx.require(absolutePath, __filename);
    }
  } else {
    await import(absolutePath);
  }
}
