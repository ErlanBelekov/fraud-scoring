module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
  testTimeout: 120000,
  setupFiles: ['./jest.setup.js'],
};
