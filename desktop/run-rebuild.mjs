/**
 * Пересборка native-модуля better-sqlite3 под ABI Electron
 * (electron-rebuild -f -w better-sqlite3).
 *
 * Как и run-dev.mjs, вычищает ELECTRON_RUN_AS_NODE: иначе @electron/rebuild
 * определит «версию Electron» как версию Node и скачает не те заголовки.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.ELECTRON_RUN_AS_NODE;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// npx-обёртка нужна для кроссплатформенного запуска node_modules/.bin
const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(
  npxBin,
  ['electron-rebuild', '-f', '-w', 'better-sqlite3'],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    // .cmd-обёртки на Windows требуют shell
    shell: process.platform === 'win32',
  },
);

child.on('error', (err) => {
  console.error(
    '[desktop] не удалось запустить electron-rebuild:',
    err.message,
  );
  process.exitCode = 1;
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
