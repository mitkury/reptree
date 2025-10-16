import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    environment: 'node',
    /*testTimeout: 60 * 60 * 1000,*/
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    watch: false,
  },
  // No special resolve needed without Svelte tests
}); 