import { defineConfig } from 'vitest/config';

// oxlint-disable-next-line import/no-default-export
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['json-summary'],
    },
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
