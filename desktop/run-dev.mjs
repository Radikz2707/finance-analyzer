/**
 * Dev-launcher десктоп-приложения.
 *
 * Удаляет ELECTRON_RUN_AS_NODE перед запуском: переменная может быть
 * выставлена родительским окружением (VS Code / терминал) — из-за неё
 * electron.exe ведёт себя как обычный Node, и `require('electron')`
 * возвращает путь к бинарю вместо API (=> app === undefined, окно не
 * создаётся). Без переменной бинарь стартует как полноценный Electron.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// Избавляемся от «режима Node» (см. шапку файла)
delete process.env.ELECTRON_RUN_AS_NODE;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const electronPath = /** @type {string} */ (require('electron'));
const main = path.join(root, 'desktop', 'dist', 'main.cjs');

const child = spawn(electronPath, [main], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error('[desktop] не удалось запустить Electron:', err.message);
  process.exitCode = 1;
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
