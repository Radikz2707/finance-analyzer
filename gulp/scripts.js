// gulp/scripts.js — Абсолютный контроль компиляции TypeScript/JavaScript сред
import { config } from '../gulp.config.js';
import gulp from 'gulp';
import path from 'path';
import dotenv from 'dotenv';
import plumber from 'gulp-plumber';
import { createRequire } from 'module';

dotenv.config();

const require = createRequire(import.meta.url);
const webpackStream = require('webpack-stream');
const webpack = require('webpack');
const { EsbuildPlugin } = require('esbuild-loader');

import { onError, isProd, safeReload } from './server.js';
const { src, dest } = gulp;

export function scripts() {
  // Конфигурация Webpack вынесена в изолированную область
  const webpackConfig = {
    mode: isProd ? 'production' : 'development',
    target: ['web', 'browserslist'],
    watch: false,
    performance: { hints: false },
    entry: {
      app: path.resolve(config.paths.scripts.src),
    },
    output: {
      filename: '[name].min.js',
      chunkFilename: 'js/chunks/chunk-[name].js',
      publicPath: '',
    },
    resolve: {
      alias: {
        '@': path.resolve(config.aliasPath),
        '@components': path.resolve(config.structure.components),
      },
      extensions: ['.ts', '.js', '.json'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'esbuild-loader',
              options: {
                loader: 'ts',
                target: 'esnext',
              },
            },
          ],
        },
        {
          test: /\.m?js$/,
          exclude: /node_modules/,
          type: 'javascript/auto',
        },
      ],
    },
    optimization: {
      minimize: isProd,
      minimizer: [
        new EsbuildPlugin({
          target: 'esnext',
          css: true,
        }),
      ],
      splitChunks: isProd
        ? {
            cacheGroups: {
              vendor: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendor',
                chunks: 'all',
              },
            },
          }
        : false,
    },
    devtool: isProd ? 'source-map' : 'eval-cheap-module-source-map',
    plugins: [],
  };

  // Локальная копия потока для безопасной трансляции контекста ошибок
  let gulpStream;

  const pipeline = [
    src(config.paths.scripts.src, { encoding: false }),
    plumber({ errorHandler: onError }),
    // Передаем кастомный обработчик логирования Webpack-статистики
    webpackStream(webpackConfig, webpack, (err, stats) => {
      if (err) return;
      if (stats && stats.hasErrors()) {
        const info = stats.toJson();
        console.error(
          '\n🔴 \x1b[31m[Webpack Error]\x1b[0m',
          info.errors[0].message,
        );
        if (gulpStream && typeof gulpStream.emit === 'function') {
          gulpStream.emit('end');
        }
      }
    }),
    // Запись готовых файлов в локальный dist
    dest(config.paths.scripts.dest),
  ];

  // 🔥 СИНХРОНИЗАЦИЯ С ЛОКАЛЬНЫМ СЕРВЕРОМ (копируем, только если путь задан в .env)
  if (config.localServerFolder) {
    pipeline.push(dest(path.join(config.localServerFolder, 'js')));
  }

  // Сохраняем ссылку на собранный конвейер до возврата в Gulp планировщик
  gulpStream = pipeline.reduce((stream, currPlugin) => stream.pipe(currPlugin));

  // Возвращаем детерминированный поток с безопасной перезагрузкой
  return gulpStream.on('end', () => {
    // Даем микро-задержку в 100мс, чтобы ОС успела закрыть дескрипторы всех чанков (vendor, app)
    setTimeout(() => {
      safeReload();
    }, 100);
  });
}
