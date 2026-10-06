/**
 * Глобальные типы build-контура (gulp).
 *
 * Файл подключён через gulp/tsconfig.json (include) и НЕ является ES-модулем
 * (нет import/export), поэтому объявленные здесь интерфейсы и типы доступны
 * во всех JSDoc-аннотациях файлов gulp/*.js при проверке `npx tsc -p gulp`.
 */

/** Полная структура экспорта gulp.config.js. */
interface GulpProjectConfig {
  repoPath: string;
  siteName: string;
  siteUrl: string;
  scssExtension: string;
  srcFolder: string;
  buildFolder: string;
  localServerFolder: string | null;
  structure: {
    components: string;
    modules: string;
    plugins: string;
  };
  aliasPath: string;
  deploy: { src: string };
  paths: {
    styles: { src: string; dest: string; output: string };
    scripts: { src: string; dest: string; output: string };
    images: { src: string; dest: string; svg: string };
    favicons: { src: string; dest: string; htmlOutput: string };
    fonts: { src: string; dest: string };
  };
  settings: {
    webpQuality: number;
    imagemin: { jpeg: number; png: number };
    autoprefixer: string[];
  };
}

/**
 * Сигнатура колбэка завершения gulp-задачи (gulp 5: потоки / async / done).
 * Совместима с `TaskFunctionCallback` из @types/gulp, но не зависит от него.
 */
type GulpDone = (error?: Error | null) => void;

/** Опции плагинов сжатия изображений (utils.js: sharpCompressor / sharpToWebp). */
interface SharpCompressorOptions {
  webpQuality?: number;
  jpegQuality?: number;
  quality?: number;
}

/**
 * Минимальный контракт vinyl-файла, используемый в Transform-плагинах gulp
 * (utils.js). Умышленно структурный — не зависит от @types/vinyl.
 */
interface VinylFile {
  isNull(): boolean;
  isStream(): boolean;
  isBuffer(): boolean;
  path: string;
  relative: string;
  contents: Buffer | null;
}
