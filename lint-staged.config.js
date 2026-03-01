/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
  '*.{ts,js,json,md,yml}': 'oxfmt',
  '*.{ts,js}': 'oxlint --type-aware --fix',
  // Do not pass any files into the build command
  'src/**/*.ts': () => 'bun run build',
};
