/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*_spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // CLI tests register global process event handlers that persist across tests
  forceExit: true,
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Map .js imports to their actual .ts files for ts-jest
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      diagnostics: {
        // Suppress ts-jest warning about hybrid module kind with NodeNext
        ignoreDiagnostics: [151002],
      },
    }],
  },
};
