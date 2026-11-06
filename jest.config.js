module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/apps', '<rootDir>/shared'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
  // tests/e2e needs the full compose stack; run it with npm run test:e2e
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/tests/e2e/'],
  // Source files import siblings as './x.js' (ESM style); resolve those to the .ts file
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  collectCoverageFrom: [
    'apps/**/src/**/*.ts',
    'shared/src/**/*.ts',
    '!apps/**/src/**/*.d.ts',
    '!apps/**/src/index.ts'  // Exclude main entry files
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts']
};
