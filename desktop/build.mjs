/**
 * Desktop Build — esbuild (main/preload/renderer) + sass (SCSS проекта)
 * + копирование ассетов + генерация icon.ico для упаковки в .exe.
 *
 * Запуск: node desktop/build.mjs  (или npm run app:build:js)
 */

import * as esbuild from 'esbuild';
import * as sass from 'sass';
import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(DESKTOP, '..');
const OUT = path.join(DESKTOP, 'dist');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copy(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

/** Собрать иконку: 256px PNG → однофайловый ICO (PNG-элемент валиден для 256px) */
async function buildIcon() {
  const src = path.join(ROOT, 'src', 'images', 'favicons', 'icon-512.png');
  if (!fs.existsSync(src)) {
    console.warn(
      '[desktop] icon-512.png не найден — иконка приложения будет стандартной (Electron)',
    );
    return;
  }
  const png = await sharp(src)
    .resize(256, 256, { fit: 'contain' })
    .png()
    .toBuffer();

  // ICONDIR (6 байт) + ICONDIRENTRY (16 байт) + PNG
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count: 1
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0); // width  (0 = 256)
  entry.writeUInt8(0, 1); // height (0 = 256)
  entry.writeUInt8(0, 2); // color count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(png.length, 8); // bytes in resource
  entry.writeUInt32LE(22, 12); // image offset
  const ico = Buffer.concat([header, entry, png]);

  ensureDir(path.join(DESKTOP, 'build'));
  fs.writeFileSync(path.join(DESKTOP, 'build', 'icon.ico'), ico);
  fs.writeFileSync(path.join(DESKTOP, 'build', 'icon.png'), png);
  console.log(
    '[desktop] иконка собрана: desktop/build/icon.ico (256px, PNG-compressed ICO)',
  );
}

async function main() {
  // 1. Чистка dist
  fs.rmSync(OUT, { recursive: true, force: true });
  ensureDir(OUT);

  // 2. Main process (CJS: require('electron') надёжен в любом окружении;
  //    electron и native better-sqlite3 остаются внешними).
  //    import.meta.url подменяется путём бандла — createRequire() из
  //    quik-orders-parser.ts не падает (иначе в CJS он получает undefined).
  const mainOut = path.join(OUT, 'main.cjs');
  await esbuild.build({
    entryPoints: [path.join(DESKTOP, 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: mainOut,
    external: ['electron', 'better-sqlite3'],
    define: {
      'import.meta.url': JSON.stringify(
        new URL(`file:///${mainOut.replaceAll('\\', '/')}`).href,
      ),
    },
    logLevel: 'info',
  });

  // 3. Preload (CJS, только electron внешний)
  await esbuild.build({
    entryPoints: [path.join(DESKTOP, 'preload.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(OUT, 'preload.cjs'),
    external: ['electron'],
    logLevel: 'info',
  });

  // 4. Renderer (IIFE, без Node-API)
  await esbuild.build({
    entryPoints: [path.join(DESKTOP, 'renderer', 'app.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['chrome120'],
    outfile: path.join(OUT, 'renderer', 'app.js'),
    logLevel: 'info',
  });

  // 5. HTML
  copy(
    path.join(DESKTOP, 'renderer', 'index.html'),
    path.join(OUT, 'renderer', 'index.html'),
  );

  // 6. SCSS проекта → styles.css (vars/_zero из src/scss/base)
  const css = await sass.compileAsync(
    path.join(DESKTOP, 'renderer', 'styles.scss'),
    {
      style: 'compressed',
      loadPaths: [path.join(ROOT, 'src', 'scss', 'base')],
    },
  );
  fs.writeFileSync(path.join(OUT, 'renderer', 'styles.css'), css.css);

  // 7. Шрифты Montserrat (копии TTF из src/fonts/src)
  const fontSrc = path.join(ROOT, 'src', 'fonts', 'src');
  if (fs.existsSync(fontSrc)) {
    for (const file of fs.readdirSync(fontSrc)) {
      if (file.endsWith('.ttf')) {
        copy(
          path.join(fontSrc, file),
          path.join(OUT, 'renderer', 'fonts', file),
        );
      }
    }
  }

  // 8. Иконка для electron-builder (NSIS/portable .exe)
  await buildIcon();

  console.log('[desktop] сборка завершена → desktop/dist');
}

main().catch((err) => {
  console.error('[desktop] ошибка сборки:', err);
  process.exitCode = 1;
});
