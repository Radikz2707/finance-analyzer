import { config } from '../gulp.config.js';
import gulp from 'gulp';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import flatten from 'gulp-flatten';
import plumber from 'gulp-plumber';
import newer from 'gulp-newer';
import svgSprite from 'gulp-svg-sprite';
import { onError } from './server.js';
import cache from 'gulp-cache';

// 🔥 ИМПОРТИРУЕМ ВАШИ ОПТИМИЗИРОВАННЫЕ ПЛАГИНЫ ИЗ UTILS.JS
import { sharpCompressor, sharpToWebp } from './utils.js';

const { src, dest } = gulp;

const gulp5Options = { allowEmpty: true, encoding: false };
const imageSources = [
  `${config.srcFolder}/images/**/*.{jpg,jpeg,png,svg,gif}`,
  `!${config.srcFolder}/images/svg/**/*`,
  `!${config.srcFolder}/images/favicons/**/*`,
  `${config.srcFolder}/components/**/img/**/*.{jpg,jpeg,png,svg,webp,gif}`,
];

// =========================================================================
// 🖼️ ТАСКИ ОБРАБОТКИ ГРАФИКИ (ПОЛНАЯ СИНХРОНИЗАЦИЯ АРХИТЕКТУРЫ)
// =========================================================================

// 1. Быстрое копирование обычных картинок в режиме Dev
export function imagesDev() {
  return src(imageSources, gulp5Options)
    .pipe(plumber({ errorHandler: onError }))
    .pipe(
      newer({
        dest: config.paths.images.dest,
        map: (relative) => path.basename(relative),
      }),
    )
    .pipe(flatten())
    .pipe(dest(config.paths.images.dest));
}

// 2. Сборка для продакшена (использует ваш родной sharpCompressor)
export function images() {
  return src(imageSources, gulp5Options)
    .pipe(plumber({ errorHandler: onError }))
    .pipe(
      cache(
        sharpCompressor({
          webpQuality: config.settings.imagemin?.webp || 70,
          jpegQuality: config.settings.imagemin?.jpeg || 75,
        }),
      ),
    )
    .pipe(flatten())
    .pipe(dest(config.paths.images.dest));
}

// 🔥 СВЕРХБЫСТРАЯ И ИСПРАВЛЕННАЯ ГЕНЕРАЦИЯ WEBP С ЖЕСТКИМ КОНТРОЛЕМ БАЗЫ
export function createWebp() {
  const webpSources = [
    // 1. Берем только те картинки, которые реально лежат в корне src/images/ и подпапках компонентов
    path.join(config.srcFolder, 'images', '**', '*.{jpg,jpeg,png}'),
    path.join(
      config.srcFolder,
      'components',
      '**',
      'img',
      '**',
      '*.{jpg,jpeg,png}',
    ),

    // 2. Глухо изолируем и полностью запрещаем трогать системную папку фавиконок
    '!' + path.join(config.srcFolder, 'images', 'favicons', '**', '*'),
  ];

  return (
    src(webpSources, {
      allowEmpty: true,
      encoding: false,
      // 🔥 ЖЕСТКИЙ ФИКС БАЗЫ: заставляем Gulp считать корнем папку src/
      // Это полностью уничтожит появление папок "src/" внутри dist!
      base: config.srcFolder,
    })
      .pipe(plumber({ errorHandler: onError }))

      // Быстрый кэш, чтобы не пересобирать то, что уже скомпилировано
      .pipe(newer({ dest: config.paths.images.dest, ext: '.webp' }))

      // Ваш кастомный нативный плагин на базе Sharp
      .pipe(sharpToWebp({ quality: config.settings.webpQuality || 70 }))

      // Отправляем все готовые файлы строго в плоскую или системную dist/images/
      // С использованием плагина flatten(), если вы хотите свалить все в корень:
      .pipe(flatten())
      .pipe(dest(config.paths.images.dest))
  );
}

// 4. Сборка векторного SVG-спрайта
export function sprite() {
  return src(config.paths.images.svg, gulp5Options)
    .pipe(plumber({ errorHandler: onError }))
    .pipe(
      svgSprite({
        mode: {
          stack: {
            sprite: '../sprite.svg', // Складываем в dist/images/sprite.svg
            example: false,
          },
        },
      }),
    )
    .pipe(dest(config.paths.images.dest));
}

// 5. Автоматизация фавиконок (с защитой от cleandist)
export async function favs(done) {
  const srcFavicon = config.paths.favicons.src;
  const faviconsDestDir = config.paths.favicons.dest;
  const partHtmlPath = config.paths.favicons.htmlOutput;
  const faviconsSrcDir = path.join(config.srcFolder, 'images', 'favicons');

  // Безопасный Guard Clause: если исходника нет, мягко выходим из таски
  if (!fs.existsSync(srcFavicon)) {
    console.warn(
      `⚠️ [CONTROL]: Исходный файл фавиконки не найден по пути: ${srcFavicon}. Таска пропущена.`,
    );
    return done();
  }

  try {
    // Гарантируем создание целевых директорий до запуска Sharp
    if (!fs.existsSync(faviconsSrcDir))
      fs.mkdirSync(faviconsSrcDir, { recursive: true });
    if (!fs.existsSync(faviconsDestDir))
      fs.mkdirSync(faviconsDestDir, { recursive: true });

    // Инициализируем инстанс Sharp внутри контролируемого контекста
    const sharpInstance = sharp(srcFavicon);

    // Изолированная генерация ресурсов через Promise.all для предотвращения Race Conditions
    await Promise.all([
      // Favicon 32x32
      sharpInstance
        .clone()
        .resize(32, 32)
        .png()
        .toFile(path.join(faviconsSrcDir, 'favicon-32.png')),
      sharpInstance
        .clone()
        .resize(32, 32)
        .png()
        .toFile(path.join(faviconsDestDir, 'favicon-32.png')),

      // Классический ICO
      sharpInstance
        .clone()
        .resize(32, 32)
        .toFormat('png')
        .toFile(path.join(faviconsSrcDir, 'favicon.ico')),
      sharpInstance
        .clone()
        .resize(32, 32)
        .toFormat('png')
        .toFile(path.join(faviconsDestDir, 'favicon.ico')),

      // Apple Touch Icon
      sharpInstance
        .clone()
        .resize(180, 180)
        .png()
        .toFile(path.join(faviconsSrcDir, 'apple-touch-icon.png')),
      sharpInstance
        .clone()
        .resize(180, 180)
        .png()
        .toFile(path.join(faviconsDestDir, 'apple-touch-icon.png')),

      // Manifest Icons
      sharpInstance
        .clone()
        .resize(192, 192)
        .png()
        .toFile(path.join(faviconsSrcDir, 'icon-192.png')),
      sharpInstance
        .clone()
        .resize(192, 192)
        .png()
        .toFile(path.join(faviconsDestDir, 'icon-192.png')),
      sharpInstance
        .clone()
        .resize(512, 512)
        .png()
        .toFile(path.join(faviconsSrcDir, 'icon-512.png')),
      sharpInstance
        .clone()
        .resize(512, 512)
        .png()
        .toFile(path.join(faviconsDestDir, 'icon-512.png')),
    ]);

    // Атомарная запись HTML-линков
    fs.writeFileSync(
      partHtmlPath,
      '<link rel="shortcut icon" href="images/favicons/favicon.ico" type="image/x-icon">\n' +
        '<link rel="icon" href="images/favicons/favicon-32.png" sizes="32x32" type="image/png">\n' +
        '<link rel="apple-touch-icon" href="images/favicons/apple-touch-icon.png">\n' +
        '<link rel="manifest" href="images/favicons/manifest.webmanifest">',
      'utf8',
    );

    // Конструирование контента манифеста
    const manifestContent = JSON.stringify(
      {
        name: config.siteName || 'Radik.Dev',
        short_name: 'Radik',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
      },
      null,
      2,
    );

    // Синхронная запись манифестов в обе ветки структуры
    fs.writeFileSync(
      path.join(faviconsSrcDir, 'manifest.webmanifest'),
      manifestContent,
      'utf8',
    );
    fs.writeFileSync(
      path.join(faviconsDestDir, 'manifest.webmanifest'),
      manifestContent,
      'utf8',
    );

    console.log(
      '🟢 [CONTROL]: Автоматизация фавиконок успешно и безопасно завершена.',
    );
    done(); // Корректный сигнал завершения таски при успехе
  } catch (err) {
    // Перехват любой системной ошибки ввода-вывода или сбоя Sharp
    console.error(
      '🔴 [CONTROL ERROR]: Критический сбой в таске автоматизации фавиконок!',
    );

    // Логируем ошибку через ваш безопасный обработчик из ядра сервера
    if (typeof onError === 'function') {
      onError(err);
    } else {
      console.error(err.message || err);
    }

    // Принудительно возвращаем ошибку в Gulp-поток, предотвращая зависание терминала
    done(err);
  }
}
