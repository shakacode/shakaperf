// Re-export from shaka-shared — the ab-test registry now lives there
// so both bench and visreg domains can share it.
export {
  abTest,
  getRegisteredTests,
  clearRegistry,
  TestType,
} from 'shaka-shared';
export type {
  AbTestDefinition,
  AbTestOptions,
  AbTestVisregConfig,
  TestFnContext,
} from 'shaka-shared';
