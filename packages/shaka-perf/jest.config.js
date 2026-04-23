/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*_spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Map the package's public subpath imports (as they appear in templates
  // and docs) back to `src/` so tests can load files that `import from
  // 'shaka-perf/compare'` without requiring a prior `yarn build`.
  moduleNameMapper: {
    '^shaka-perf/compare$': '<rootDir>/src/compare',
  },
  // CLI tests register global process event handlers that persist across tests
  forceExit: true,
};
