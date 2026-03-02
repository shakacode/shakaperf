export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*_spec.js'],
  moduleFileExtensions: ['js', 'json'],
  // CLI tests register global process event handlers that persist across tests
  forceExit: true,
  // Disable babel transformation — modules are native ESM
  transform: {},
};
