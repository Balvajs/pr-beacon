import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    deps: {
      neverBundle: [],
      onlyAllowBundle: false,
    },
    entry: ['./src/action/index.ts'],
    outDir: './dist-action',
    sourcemap: true,
  },
]);
