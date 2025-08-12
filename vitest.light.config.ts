import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    exclude: ['__tests__/fuzzy.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 60 * 60 * 1000,
  },
});