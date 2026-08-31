import { config } from '../gulp.config.js';
import gulp from 'gulp';
import browserSync from 'browser-sync';
import path from 'path';
import fs from 'fs';
import { deployLocal } from './utils.js';

const { watch } = gulp;
export const bs = browserSync.create();

export const isProd = process.env.NODE_ENV === 'production';

// Инкапсулированные семафоры состояния (защищены от внешних мутаций)
let allowReload = false;
let isServerInitialized = false;

// =========================================================================
// 🎛️ 1. БЕЗОПАСНЫЙ ОБРАБОТЧИК ОШИБОК ДЛЯ ПОТОКОВ GULP 5 (STREAMX)
// =========================================================================
export const onError = function (err) {
  console.error(
    '\x1b[31m%s\x1b[0m',
    `[Error] ${err.plugin || 'Gulp'}: ${err.message || err.toString()}`,
  );
  if (err.plugin !== 'webpack-stream' && typeof this?.emit === 'function') {
    this.emit('end');
  }
};

/**
 * ИЗОЛИРОВАННЫЙ И БЕЗОПАСНЫЙ ТРИГГЕР ПЕРЕЗАГРУЗКИ СТРАНИЦ
 * (Полная замена global.safeReload)
 */
export const safeReload = () => {
  if (isServerInitialized && allowReload && typeof bs.reload === 'function') {
    bs.reload();
  }
};

// =========================================================================
// 🌐 2. ИНИЦИАЛИЗАЦИЯ ЛОКАЛЬНОГО СЕРВЕРА BROWSER-SYNC
// =========================================================================
export function browsersync() {
  return new Promise((resolve) => {
    allowReload = true;

    setTimeout(() => {
      bs.init({
        server: {
          baseDir: config.buildFolder || 'dist',
        },
        host: '127.0.0.1',
        port: 8080,
        ui: false,
        watch: false,
        ghostMode: false,
        notify: false,
        online: false,
        open: 'local',
        reloadDelay: 0,
        reloadDebounce: 0,
        watchOptions: {
          awaitWriteFinish: true,
        },
      });

      isServerInitialized = true;
      resolve();
    }, 1000);
  });
}

// Вспомогательный хелпер для ленивого запуска тасок внутри вотчера
const dynamicRun = (moduleName, functionName) => {
  return async (done) => {
    try {
      const mod = await import(`./${moduleName}.js`);
      const task = mod[functionName] || mod.default;
      if (typeof task === 'function') {
        return task(done);
      }
      done();
    } catch (err) {
      console.error(
        `\x1b[31m[Watcher Error] Не удалось запустить ${functionName}: ${err.message}\x1b[0m`,
      );
      done(err);
    }
  };
};

// =========================================================================
// 👁️ 3. СЛЕДИТЕЛЬ ЗА ИЗМЕНЕНИЯМИ (WATCHER ENGINE ДЛЯ GULP 5)
// =========================================================================
export function startwatch(done) {
  const watchOptions = { delay: 500, queue: true, ignoreInitial: true };

  // Универсальный и безопасный асинхронный мост для нативного деплоя
  const runWithDeploy = (actionCallback) => {
    return () => {
      if (typeof actionCallback === 'function') actionCallback();

      // Сразу следом вызываем нативный быстрый деплой и делаем безопасный релоад
      deployLocal(() => {
        safeReload(); // <-- Используем безопасный именованный экспорт
      });
    };
  };

  // 1. Отслеживание стилей
  watch([`${config.srcFolder}/**/*.${config.scssExtension}`], watchOptions).on(
    'change',
    (filePath) => {
      console.log(`✨ [Style Change] Изменен: ${path.basename(filePath)}`);
      dynamicRun('styles', 'styles')(runWithDeploy());
    },
  );

  // 2. Отслеживание скриптов
  watch([`${config.srcFolder}/**/*.{js,ts}`], watchOptions).on(
    'change',
    (filePath) => {
      console.log(`✨ [Script Change] Изменен: ${path.basename(filePath)}`);
      dynamicRun('scripts', 'scripts')(runWithDeploy());
    },
  );

  // 3. Отслеживание стандартной HTML-разметки страниц сайта
  watch(
    [
      `${config.srcFolder}/*.html`,
      `${config.srcFolder}/components/**/*.html`,
      `${config.srcFolder}/parts/**/*.html`,
    ],
    watchOptions,
  ).on('change', (filePath) => {
    console.log(`✨ [HTML Change] Изменен: ${path.basename(filePath)}`);
    dynamicRun('html', 'html')(runWithDeploy());
  });

  // 4. Отслеживание Markdown-контента блога и Word-документов
  watch(
    [
      config.srcFolder + '/content/**/*',
      '!' + config.srcFolder + '/content/**/~$*',
      '!' + config.srcFolder + '/content/**/~WRD*',
    ],
    watchOptions,
  ).on('change', (filePath) => {
    const relativePath = path.relative(
      path.join(config.srcFolder, 'content'),
      filePath,
    );
    const folder = relativePath.split(path.sep);

    if (folder && folder[0]) {
      const currentCategory = folder[0];
      console.log(
        `📝 [Content Update] Обновление подкатегории [${currentCategory}]: ${path.basename(filePath)}`,
      );

      const updateContent = async () => {
        try {
          const { wrapInMasterLayout } =
            await import('./utils/content-processor.js');
          const { blogIndex } = await import('./html.js');

          // 🔥 ИСПРАВЛЕНИЕ РЕЙС-КОНДИШЕНА ПУТЕЙ:
          // Вычисляем корректную целевую вложенность для сохранения структуры категорий блога
          const isMainBlog = currentCategory === 'blog';
          const destFolder = isMainBlog
            ? path.join(config.buildFolder, currentCategory)
            : path.join(config.buildFolder, 'blog', currentCategory);

          if (!fs.existsSync(destFolder)) {
            fs.mkdirSync(destFolder, { recursive: true });
          }

          // Атомарное копирование с сохранением имени
          fs.copyFileSync(
            filePath,
            path.join(destFolder, path.basename(filePath)),
          );

          // Запускаем пересборку структуры стилей и метаданных конкретной папки
          await wrapInMasterLayout(destFolder, currentCategory);

          blogIndex(() => {
            console.log(
              `✅ Контент категории ${currentCategory} успешно обновлен в dist`,
            );
            deployLocal(() => {
              safeReload(); // <-- Используем безопасный экспортируемый метод
            });
          });
        } catch (err) {
          console.error('❌ Ошибка при асинхронном обновлении контента:', err);
        }
      };
      updateContent();
    }
  });

  // 5. Отслеживание графики в компонентах
  watch(
    [
      `${config.srcFolder}/components/**/*.{jpg,jpeg,png,svg,gif}`,
      `!${config.srcFolder}/components/**/*.webp`,
    ],
    watchOptions,
  ).on('change', (filePath) => {
    console.log(
      `🖼️ [Image Change] Добавлена картинка: ${path.basename(filePath)}`,
    );
    dynamicRun('images', 'imagesDev')(runWithDeploy());
  });

  // 6. Отслеживание SVG-спрайтов
  if (config.paths?.images?.svg) {
    watch([config.paths.images.svg], watchOptions).on('change', (filePath) => {
      console.log(
        `🧬 [Sprite Change] Обновлена иконка: ${path.basename(filePath)}`,
      );
      dynamicRun('images', 'sprite')(runWithDeploy());
    });
  }

  done();
}
