// gulp/styles.js — Абсолютный контроль компиляции и оптимизации стилей SCSS
import { config } from '../gulp.config.js';
import gulp from 'gulp';
import path from 'path';
import plumber from 'gulp-plumber';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cleancss = require('gulp-clean-css');
const rename = require('gulp-rename');
const gulpSass = require('gulp-sass');

import * as dartSass from 'sass';
import postcss from 'gulp-postcss';
import autoprefixer from 'autoprefixer';
import webpInCssModule from 'webp-in-css/plugin.js';
import sortMediaQueries from 'postcss-sort-media-queries';

const webpInCss = webpInCssModule.default || webpInCssModule;
// Импортируем флаг окружения и обработчик ошибок из единого ядра сервера
import { onError, bs, isProd } from './server.js';

const { src, dest } = gulp;
const sass = gulpSass(dartSass);

export function styles() {
  const srcOptions = !isProd ? { sourcemaps: true } : {};

  const pipeline = [
    src(config.paths.styles.src, srcOptions),
    plumber({ errorHandler: onError }),
    // Контроль инкрементальности: gulp-newer удален для предотвращения
    // блокировки изменений во вложенных файлах компонентов (_header.scss и т.д.)
  ];

  // Сборка и пост-процессинг адаптивной верстки
  pipeline.push(
    sass({
      silenceDeprecations: ['import'],
      loadPaths: ['node_modules'],
    }),
    postcss([
      sortMediaQueries({ sort: 'mobile-first' }),
      autoprefixer({
        overrideBrowserslist: config.settings.autoprefixer,
        grid: 'autoplace',
      }),
      webpInCss,
    ]),
  );

  // Двухуровневое жесткое сжатие для Production билда
  if (isProd) {
    pipeline.push(
      cleancss({
        level: {
          1: {
            all: true,
            transform: (name, value) => value,
          },
          2: {
            all: true,
            mergeMedia: true,
            mergeAdjacentRules: true,
            removeDistinctSemicolons: true,
            removeDuplicateRules: true,
            restructureRules: false,
          },
        },
      }),
    );
  }

  pipeline.push(
    rename({
      basename: 'app',
      suffix: '.min',
    }),
  );

  const destOptions = !isProd ? { sourcemaps: '.' } : {};

  pipeline.push(dest(config.paths.styles.dest, destOptions));

  if (config.localServerFolder) {
    pipeline.push(
      dest(path.join(config.localServerFolder, 'css'), destOptions),
    );
  }

  pipeline.push(bs.stream());

  return pipeline.reduce((stream, plugin) => stream.pipe(plugin));
}
