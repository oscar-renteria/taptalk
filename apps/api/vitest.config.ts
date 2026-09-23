import { configDefaults, defineConfig } from 'vitest/config';

// vitest 5 no longer skips build output by default; tsc also compiles the tests into dist/.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
