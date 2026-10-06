import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
    },
    // 🎯 ИСПРАВЛЕНО: Vitest будет искать тесты и в src/, и в нашей защищенной gulp/tests/
    include: [
      'src/**/*.{test,spec}.{js,ts}',
      'gulp/tests/**/*.{test,spec}.{js,ts}',
      // CLI-скрипты и их тесты (npm run chat и сопутствующие проверки)
      'scripts/**/*.{test,spec}.{js,ts}',
      // Десктоп-приложение: только чистое IPC-ядро (без electron-импортов)
      'desktop/**/*.{test,spec}.{js,ts}',
    ],
    // Бенчмарки (.bench.ts) — не тесты: исключаем явно, чтобы они не попали
    // в основной прогон даже при расширении include.
    exclude: ['**/*.bench.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src/js'),
      '@components': path.resolve(import.meta.dirname, './src/components'),
    },
  },
});
