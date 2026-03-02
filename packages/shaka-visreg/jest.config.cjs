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
      // Disable type-checking diagnostics — this is a lenient TS migration.
      // Type errors in tests are expected and will be fixed incrementally.
      diagnostics: false,
    }],
  },
};
