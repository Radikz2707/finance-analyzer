/* cspell:disable-next-line нотификатор */
import path from 'path';
import { config } from '../gulp.config.js';
import { execFile } from 'child_process';
import { createRequire } from 'module';

// Создаем безопасный контекст require для динамических пакетов внутри ES-модулей
const require = createRequire(import.meta.url);

// Мягко импортируем нотификатор. Если пакета нет в node_modules, проект не упадет
/** @type {{ notify: (options: Record<string, unknown>) => void } | null} */
let notifier = null;
try {
  notifier = require('node-notifier');
} catch {
  // Фолбэк на случай отсутствия пакета в окружении
}

const isProdBuild = process.argv.includes('build');
const execOptions = {
  env: { ...process.env, FORCE_COLOR: '1' },
  windowsHide: true,
  shell: true,
};

/**
 * Функция безопасного экранирования путей для Windows-сред
 * @param {string | null} p
 * @returns {string}
 */
const sanitizePath = (p) => (p ? p.replace(/[&|;`]/g, '') : '');

/**
 * Получает путь к CLI-модулю через node (обходит bash-обёртки на Windows).
 * @param {string} moduleName - имя пакета (stylelint | eslint)
 * @returns {string}
 */
const cliPath = (moduleName) => {
  const ext = moduleName === 'stylelint' ? '.mjs' : '.js';
  return path.resolve('node_modules', moduleName, 'bin', moduleName + ext);
};

// === БЕЗОПАСНЫЙ ТАСК STYLELINT (ВАЛИДАЦИЯ SCSS) ===
/**
 * Запуск stylelint по SCSS. В prod-режиме ошибки фатальны (+ --fix).
 * @param {string | GulpDone | null} [arg] - путь к файлу или колбэк gulp
 * @returns {Promise<void>}
 */
export const lintCss = (arg = null) => {
  return new Promise((resolve, reject) => {
    const filePath = typeof arg === 'function' ? null : arg;
    const args = [];

    if (filePath) {
      args.push(sanitizePath(filePath));
    } else {
      args.push(`${config.srcFolder}/**/*.${config.scssExtension}`);
    }

    if (isProdBuild) args.push('--fix');
    args.push(
      '--allow-empty-input',
      '--custom-formatter=stylelint-formatter-pretty',
    );

    // Используем node напрямую, чтобы обойти bash-обёртки на Windows
    const cmd = process.platform === 'win32' ? 'node' : 'npx';
    const cli =
      process.platform === 'win32' ? cliPath('stylelint') : 'stylelint';

    execFile(cmd, [cli, ...args], execOptions, (err, stdout, stderr) => {
      if (stdout) {
        process.stdout.write(stdout);

        // Если обнаружены дефекты оформления стилей
        if (
          notifier &&
          (stdout.includes('warning') || stdout.includes('error') || err)
        ) {
          const filePaths = stdout.match(/(src\/[^\s\n]+)/g) || [];
          const uniqueFiles = [...new Set(filePaths)].map((p) =>
            path.basename(p),
          );

          const filesChunk =
            uniqueFiles.length > 0
              ? `Файлы: ${uniqueFiles.slice(0, 3).join(', ')}`
              : 'Обнаружены дефекты в SCSS';

          notifier.notify({
            title: '⚠️ [Stylelint] SCSS Defects Found!',
            message: `${filesChunk}. Исправьте оформление стилей в компонентах.`,
            sound: true,
            wait: false,
          });
        }
      }

      if (stderr) process.stderr.write(stderr);

      if (err && isProdBuild) {
        return reject(
          new Error(
            'Stylelint found unfixable defects. Fix them before deploy.',
          ),
        );
      }
      resolve();
    });
  });
};

// === БЕЗОПАСНЫЙ ТАСК ESLINT (ВАЛИДАЦИЯ JS / TS) ===
/**
 * Запуск eslint по src/, gulpfile.js и gulp/**. В prod-режиме ошибки фатальны.
 * @param {string | GulpDone | null} [arg] - путь к файлу или колбэк gulp
 * @returns {Promise<void>}
 */
export const lintJs = (arg = null) => {
  return new Promise((resolve, reject) => {
    const filePath = typeof arg === 'function' ? null : arg;
    const args = [];

    if (filePath) {
      args.push(sanitizePath(filePath));
    } else {
      // 🎯 ИСПРАВЛЕНО: Расширенная маска поиска файлов.
      // Теперь линтер сканирует компоненты, сам gulpfile.js и все скрипты в папке gulp/
      args.push(
        `${config.srcFolder}/**/*.{js,ts}`,
        'gulpfile.js',
        'gulp/**/*.js',
      );
    }

    if (isProdBuild) args.push('--fix');

    // Используем node напрямую, чтобы обойти bash-обёртки на Windows
    const cmd = process.platform === 'win32' ? 'node' : 'npx';
    const cli = process.platform === 'win32' ? cliPath('eslint') : 'eslint';

    execFile(cmd, [cli, ...args], execOptions, (err, stdout, stderr) => {
      if (stdout) {
        process.stdout.write(stdout);

        // Сканируем вывод на наличие предупреждений и неиспользуемых переменных
        if (
          notifier &&
          (stdout.includes('warning') ||
            stdout.includes('error') ||
            stdout.includes('no-unused-vars'))
        ) {
          const filePaths =
            stdout.match(/(src\/[^\s\n]+|gulpfile\.js|gulp\/[^\s\n]+)/g) || [];
          const uniqueFiles = [...new Set(filePaths)].map((p) =>
            path.basename(p),
          );

          const filesChunk =
            uniqueFiles.length > 0
              ? `Файлы: ${uniqueFiles.slice(0, 3).join(', ')}${uniqueFiles.length > 3 ? '...' : ''}`
              : 'Обнаружены неиспользуемые переменные';

          notifier.notify({
            title: '⚠️ [ESLint] Code Quality Alert!',
            message: `${filesChunk}. Очистите мертвый код или неиспользуемые импорты.`,
            sound: true,
            wait: false,
          });
        }
      }

      if (stderr) process.stderr.write(stderr);

      if (err && isProdBuild) {
        return reject(
          new Error('ESLint found unfixable errors. Fix them before deploy.'),
        );
      }
      resolve();
    });
  });
};
