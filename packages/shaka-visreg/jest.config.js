/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*_spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // CLI tests register global process event handlers that persist across tests
  forceExit: true,
};
