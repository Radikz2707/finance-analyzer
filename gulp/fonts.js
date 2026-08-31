import { config } from '../gulp.config.js';
import gulp from 'gulp';
import path from 'path';
import fs from 'fs';
import plumber from 'gulp-plumber';
import fonter from 'gulp-fonter';
import ttf2woff2 from 'gulp-ttf2woff2';
import { onError } from './server.js'; // Используем безопасный обработчик ошибок

const { src, dest } = gulp;

/**
 * 🔤 1. Конвертация шрифтов TTF в WOFF/WOFF2 (Изолированные параллельные потоки для Gulp 5)
 */
export function fonts(done) {
  const sourceDir = path.dirname(config.paths.fonts.src).replace(/\*\*$/, '');

  // Безопасный Guard Clause: если шрифтов нет, мягко завершаем таску
  if (!fs.existsSync(sourceDir) || fs.readdirSync(sourceDir).length === 0) {
    console.log('ℹ️ Шрифты не найдены, пропускаем конвертацию.');
    return done();
  }

  // 1. Поток конвертации в формат WOFF
  const woffStream = src(config.paths.fonts.src, { encoding: false, allowEmpty: true })
    .pipe(plumber({ errorHandler: onError }))
    .pipe(fonter({ formats: ['woff'] }))
    .pipe(dest(config.paths.fonts.dest));

  // 2. Поток конвертации в формат WOFF2
  const woff2Stream = src(config.paths.fonts.src, { encoding: false, allowEmpty: true })
    .pipe(plumber({ errorHandler: onError }))
    .pipe(ttf2woff2())
    .pipe(dest(config.paths.fonts.dest));

  // Запускаем оба потока параллельно через оркестратор Gulp.
  // Он корректно дождется завершения обоих и сам вызовет колбэк done().
  woffStream.on('end', () => {
    woff2Stream.on('end', done);
  });
}

/**
 * 📝 2. Генератор стилей подключения шрифтов с сохранением приоритета правил @use
 */
export function fontsStyle(done) {
  const rawProcessor = (config.scssExtension || 'scss').toLowerCase();

  let stylesDirName = rawProcessor;
  if (
    rawProcessor === 'sass' &&
    fs.existsSync(path.join(config.srcFolder, 'scss'))
  ) {
    stylesDirName = 'scss';
  }

  const extension = stylesDirName;
  const fontsFile = path.join(
    config.srcFolder,
    stylesDirName,
    'base',
    `_fonts.${extension}`,
  );
  const mainStyleFile = path.join(
    config.srcFolder,
    stylesDirName,
    `style.${extension}`,
  );

  const sourceFontsDir = path
    .dirname(config.paths.fonts.src)
    .replace(/\*\*$/, '');
  if (!fs.existsSync(sourceFontsDir)) return done();

  try {
    const files = fs
      .readdirSync(sourceFontsDir)
      .filter((file) => file.endsWith('.ttf'));
    if (files.length === 0) return done();

    const baseDir = path.dirname(fontsFile);
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    // Атомарно очищаем или создаем файл _fonts.scss, предотвращая Race Condition
    fs.writeFileSync(fontsFile, '', 'utf-8');

    // Кэш уникальных комбинаций для исключения дублирования правил @font-face
    const uniqueFonts = new Set();

    files.forEach((file) => {
      const fontFileName = path.basename(file, path.extname(file));
      const fontName = fontFileName.replace(
        /-(thin|extralight|light|regular|medium|semibold|bold|extrabold|heavy|black|italic)/gi,
        '',
      );
      const fontInfo = fontFileName.toLowerCase();

      let fontWeight = 400;
      if (fontInfo.includes('thin')) fontWeight = 100;
      else if (fontInfo.includes('extralight')) fontWeight = 200;
      else if (fontInfo.includes('light')) fontWeight = 300;
      else if (fontInfo.includes('medium')) fontWeight = 500;
      else if (fontInfo.includes('semibold')) fontWeight = 600;
      else if (fontInfo.includes('bold')) fontWeight = 700;
      else if (fontInfo.includes('extrabold') || fontInfo.includes('heavy'))
        fontWeight = 800;
      else if (fontInfo.includes('black')) fontWeight = 900;

      const fontStyle = fontInfo.includes('italic') ? 'italic' : 'normal';
      const fontKey = `${fontName}-${fontWeight}-${fontStyle}`;

      // Защита от дубликатов на уровне ядра сборщика
      if (!uniqueFonts.has(fontKey)) {
        uniqueFonts.add(fontKey);
        const fontRecord = `@font-face {\n\tfont-family: ${fontName};\n\tfont-style: ${fontStyle};\n\tfont-weight: ${fontWeight};\n\tsrc: url("../fonts/${fontFileName}.woff2") format("woff2");\n\tfont-display: swap;\n}\n\n`;

        fs.appendFileSync(fontsFile, fontRecord, 'utf-8');
      }
    });

    console.log(`📝 Файл _fonts.${extension} успешно обновлен.`);

    // 🔥 АВТОМАТИЗАЦИЯ ИМПОРТА С УЧЕТОМ ТОТАЛЬНОГО ПРИОРИТЕТА @USE
    if (fs.existsSync(mainStyleFile)) {
      let mainStyleContent = fs.readFileSync(mainStyleFile, 'utf-8');
      const importDirective = '@import "base/fonts";';

      if (
        !mainStyleContent.includes(importDirective) &&
        !mainStyleContent.includes('base/fonts')
      ) {
        const lines = mainStyleContent.split('\n');
        let lastUseIndex = -1;

        lines.forEach((line, index) => {
          if (line.trim().startsWith('@use')) {
            lastUseIndex = index;
          }
        });

        if (lastUseIndex !== -1) {
          lines.splice(lastUseIndex + 1, 0, importDirective);
          mainStyleContent = lines.join('\n');
        } else {
          mainStyleContent = `${importDirective}\n${mainStyleContent}`;
        }

        fs.writeFileSync(mainStyleFile, mainStyleContent, 'utf-8');
        console.log(
          `🚀 Импорт _fonts.${extension} автоматически добавлен после всех правил @use в style.${extension}`,
        );
      }
    }

    done(); // Успешное и корректное завершение таски
  } catch (err) {
    console.error(
      '🔴 [CONTROL UTILS ERROR]: Критический сбой при сборке стилей шрифтов!',
    );
    onError(err);
    done(err); // Предотвращаем зависание планировщика Gulp
  }
}

