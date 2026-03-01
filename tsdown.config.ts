import { defineConfig } from 'tsdown';

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
