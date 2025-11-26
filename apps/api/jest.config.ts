export default {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  coverageDirectory: '../../coverage/apps/api',
  // Ensure both unit and e2e-style specs (e.g., *.e2e-spec.ts) are executed.
  testMatch: ['**/?(*.)+(spec|e2e-spec).[tj]s?(x)'],
};
