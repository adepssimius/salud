export default {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testTimeout: 20000,
  coverageDirectory: '../../coverage/apps/api',
  // Ensure both unit and e2e-style specs (e.g., *.e2e-spec.ts) are executed.
  testMatch: ['**/?(*.)+(spec|e2e-spec).[tj]s?(x)'],
  // openid-client ships ESM-only; the jest transform's module:commonjs (tsconfig.spec.json)
  // downlevels any import of it to require(), which the real package rejects. Every test run
  // gets the mock at auth/oidc/__mocks__/openid-client.ts instead — see that file's header for
  // the full explanation. Production is unaffected: webpack bundles the real package directly.
  moduleNameMapper: {
    '^openid-client$': '<rootDir>/src/app/auth/oidc/__mocks__/openid-client.ts',
  },
  // Must run before a test file's own imports so `DB_CLIENT` is set before anything reaches
  // db/schema.ts's dialect resolver — see that file's header comment.
  setupFiles: ['<rootDir>/src/testing/jest-env-setup.ts'],
};
