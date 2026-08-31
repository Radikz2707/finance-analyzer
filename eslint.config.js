// eslint.config.js — Абсолютный контроль качества кодовой базы Radik.Dev
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

// Детерминированная проверка среды продакшена через переменную окружения
const isProd =
  process.env.NODE_ENV === 'production' || process.argv.includes('build');

export default tseslint.config(
  {
    // 🔥 ГЛОБАЛЬНЫЕ ИГНОРЫ (Только бинарники, кэш и вендоры)
    // Системные JS-скрипты автоматизации Gulp возвращены под надзор линтера!
    ignores: [
      'node_modules/**',
      'dist/**',
      'archives/**',
      '.vscode/**',
      '.idea/**',
      '*.log',
      'src/js/env-config.js',
    ],
  },

  // Подключение базовых рекомендованных конфигураций
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,

  // 🎛️ ПРОФИЛЬ 1: Основная кодовая база сайта (JS, TS)
  {
    files: ['src/**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // 🔥 ГАРАНТИЯ ЧИСТОТЫ: Запрет console.log строго в продакшене
      'no-console': isProd ? 'error' : 'off',
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
    },
  },

  // 🛠️ ПРОФИЛЬ 2: Инфраструктура сборщика (Gulp скрипты, конфигурации в корне)
  // Для этих файлов отключаем TypeScript-специфичные правила, но контролируем синтаксис
  {
    files: ['*.js', 'gulp/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node, // Включаем Node.js глобалы (process, require, path)
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off', // В скриптах автоматизации логи консоли разрешены всегда
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
    },
  },
);
