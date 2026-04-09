/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/*_spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // CLI tests register global process event handlers that persist across tests
  forceExit: true,
};
