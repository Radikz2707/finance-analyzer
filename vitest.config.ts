import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // 🎯 ИСПРАВЛЕНО: Vitest будет искать тесты и в src/, и в нашей защищенной gulp/tests/
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'gulp/tests/**/*.{test,spec}.{js,ts}',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/js'),
      '@components': path.resolve(__dirname, './src/components'),
    },
  },
});
