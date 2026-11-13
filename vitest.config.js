import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['tests/database/**', 'node_modules/**'],
    env: { NODE_ENV: 'test' },
  },
});
