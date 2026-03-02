/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */

// oxlint-disable-next-line import/no-default-export import/no-anonymous-default-export
export default {
  // Do not pass any files into the build/type-check/test commands
  '**/*': () => ['bun run build', 'bun run type-check', 'bun run test'],
  '*.{ts,js,json,md,yml}': 'oxfmt',
  '*.{ts,js}': 'oxlint --type-aware --fix',
};
