import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: false, compilerOptions: { runes: true } })],
  test: {
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.svelte.test.js'],
    globals: true,
    environment: 'jsdom',
    /*testTimeout: 60 * 60 * 1000,*/
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    watch: false,
  },
  // Tell Vitest to use the `browser` entry points in `package.json` files, even though it's running in Node
  resolve: process.env.VITEST
    ? {
        conditions: ['browser']
      }
    : undefined
}); 