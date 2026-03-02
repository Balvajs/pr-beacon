import { defineConfig } from 'tsdown';

// oxlint-disable-next-line import/no-default-export
export default defineConfig([
  {
    deps: {
      alwaysBundle: ['**'],
      onlyAllowBundle: false,
    },
    entry: ['./src/action/index.ts'],
    outDir: './dist-action',
    sourcemap: true,
  },
]);
