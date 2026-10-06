import { config } from '../gulp.config.js';
import gulp from 'gulp';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import plumber from 'gulp-plumber';
import zip from 'gulp-zip';
import sharp from 'sharp';
import { onError } from './server.js';
import { Transform } from 'stream';

const { src, dest } = gulp;

// 🧹 1. ПОЛНАЯ АСИНХРОННАЯ ОЧИСТКА ПЕРЕД СБОРКОЙ
/**
 * Полная очистка dist/, кэша node_modules/.cache и временных файлов блога.
 * @param {GulpDone} done - колбэк завершения gulp-задачи
 */
export async function cleandist(done) {
  try {
    if (fs.existsSync(config.buildFolder)) {
      await fsPromises.rm(config.buildFolder, { recursive: true, force: true });
    }
    const cacheFolder = path.join('node_modules', '.cache');
    if (fs.existsSync(cacheFolder)) {
      await fsPromises.rm(cacheFolder, { recursive: true, force: true });
    }
    const blogDir = path.join(config.srcFolder, 'content', 'blog');
    if (fs.existsSync(blogDir)) {
      const files = await fsPromises.readdir(blogDir);
      for (const file of files) {
        if (file.startsWith('~')) {
          const trashFilePath = path.join(blogDir, file);
          await fsPromises.unlink(trashFilePath);
        }
      }
    }
    done();
  } catch (err) {
    onError(err);
    done(err instanceof Error ? err : new Error(String(err)));
  }
}

// 📦 3. АРХИВИРОВАНИЕ СБОРКИ (ZIP)
/**
 * Упаковка собранного dist/ в архивы/*.zip.
 * @returns {Promise<void>}
 */
export function zipFiles() {
  return new Promise((resolve, reject) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const fileName = `dist_${year}-${month}-${day}_${hours}-${minutes}.zip`;

    const archiveDir = path.resolve('archives');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Защита Gulp 5: исключаем скрытые файлы кэша (.blog-cache-marker)
    const srcPath = [
      path.join(config.buildFolder, '**', '*'),
      `!${path.join(config.buildFolder, '**', '.*')}`,
    ];

    // nodir: true предотвращает баг пустых директорий в Gulp 5
    // (флаг отсутствует в SrcOptions из @types/gulp — расширяем тип локально)
    /** @type {NonNullable<Parameters<typeof src>[1]> & { nodir?: boolean }} */
    const zipSrcOptions = { allowEmpty: true, nodir: true };
    src(srcPath, zipSrcOptions)
      // Переопределяем поведение plumber, чтобы он не спамил ошибку свойства 'path' в консоль
      .pipe(plumber({ errorHandler: () => {} }))
      .pipe(zip(fileName))
      .pipe(dest(archiveDir))
      .on('end', () => {
        console.log(
          `\n📦 [Gulp 5] Нативный архив успешно создан: archives/${fileName}\n`,
        );
        resolve();
      })
      .on('error', (err) => {
        // Пропускаем ошибку свойства path, остальные важные ошибки (например, диск переполнен) ловим
        if (err.message && err.message.includes('path')) {
          return resolve();
        }
        if (typeof onError === 'function') onError(err);
        reject(err);
      });
  });
}

// 🛠️ 4. ПЛАГИН НА БАЗЕ SHARP ДЛЯ СЖАТИЯ И ОПТИМИЗАЦИИ
/**
 * Нативный Transform-плагин сжатия изображений через sharp.
 * @param {SharpCompressorOptions} [options]
 * @returns {Transform}
 */
export const sharpCompressor = (options = {}) => {
  sharp.cache(false);
  const webpQuality = options.webpQuality || 70;
  const jpegQuality = options.jpegQuality || 75;

  return new Transform({
    objectMode: true,
    /**
     * @param {VinylFile} file
     * @param {BufferEncoding} enc
     * @param {import('stream').TransformCallback} callback
     */
    async transform(file, enc, callback) {
      if (file.isNull()) return callback(null, file);
      if (file.isStream())
        return callback(new Error('Стримы не поддерживаются!'));

      const ext = path.extname(file.path).toLowerCase();
      if (ext === '.svg' || ext === '.gif') return callback(null, file);

      try {
        // file.contents уже прошёл guards isNull/isStream → гарантирован Buffer
        let pipeline = sharp(/** @type {Buffer} */ (file.contents));
        if (ext === '.jpg' || ext === '.jpeg') {
          pipeline = pipeline.jpeg({
            quality: jpegQuality,
            progressive: true,
            mozjpeg: true,
          });
        } else if (ext === '.png') {
          pipeline = pipeline.png({ compressionLevel: 9, palette: true });
        } else if (ext === '.webp') {
          pipeline = pipeline.webp({ quality: webpQuality });
        }
        file.contents = await pipeline.toBuffer();
        callback(null, file);
      } catch (err) {
        const isProd =
          process.env.NODE_ENV === 'production' ||
          process.argv.includes('--prod') ||
          process.argv.includes('build');

        console.error(
          `\x1b[31m[Sharp Critical Error] Ошибка файла ${file.relative}:\x1b[0m`,
          err instanceof Error ? err.message : String(err),
        );

        if (isProd) {
          callback(
            new Error(
              `[Sharp] Сборка остановлена из-за поврежденного изображения: ${file.relative}`,
            ),
          );
        } else {
          callback(null, file);
        }
      }
    },
  });
};

// 🛠️ 5. ПЛАГИН ДЛЯ КОНВЕРТАЦИИ В WEBP (БЕЗУПРЕЧНЫЙ NATIVE TRANSFORM)
/**
 * Нативный Transform-плагин конвертации PNG/JPG/JPEG в WebP.
 * @param {{ quality?: number }} [options]
 * @returns {Transform}
 */
export const sharpToWebp = (options = {}) => {
  sharp.cache(false);
  const quality = options.quality || 70;

  return new Transform({
    objectMode: true,
    /**
     * @param {VinylFile} file
     * @param {BufferEncoding} enc
     * @param {import('stream').TransformCallback} callback
     */
    async transform(file, enc, callback) {
      if (file.isNull()) return callback(null, file);
      if (file.isStream())
        return callback(new Error('Стримы не поддерживаются!'));

      const ext = path.extname(file.path).toLowerCase();
      if (ext === '.webp') return callback(null, file);
      if (!['.png', '.jpg', '.jpeg'].includes(ext)) return callback(null, file);

      try {
        file.contents = await sharp(/** @type {Buffer} */ (file.contents))
          .webp({ quality })
          .toBuffer();

        file.path = file.path.replace(/\.(png|jpg|jpeg)$/i, '.webp');
        callback(null, file);
      } catch (err) {
        console.error(
          `[Sharp WebP Error] Ошибка файла ${file.relative}:`,
          err instanceof Error ? err.message : String(err),
        );
        callback(null, file);
      }
    },
  });
};

/**
 * Автоматический деплой скомпилированного проекта в локальный сервер IIS wwwroot
 * @param {GulpDone} [done]
 */
export function deployLocal(done) {
  if (!config.localServerFolder) {
    if (typeof done === 'function') done();
    return;
  }

  const sourcePath = `${config.buildFolder || 'dist'}/**/*`;
  return src(sourcePath, { encoding: false, buffer: true })
    .pipe(dest(config.localServerFolder))
    .on('end', () => {
      if (typeof done === 'function') done();
    });
}
