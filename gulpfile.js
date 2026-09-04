/* cspell:disable */
import { config } from './gulp.config.js';
import gulp from 'gulp';
import fs from 'fs';
import path from 'path';

// Импорты инфраструктуры // Серверное ядро и утилиты отладки с автоматической изоляцией имён
import { isProd } from './gulp/server.js';
import { lintCss, lintJs } from './gulp/lint.js';
import { cleandist, zipFiles, deployLocal } from './gulp/utils.js';
import { getBuildSignature } from './gulp/system/gulp.cache.js';

// Инструменты автоматизации CLI (БЭМ CRUD & Инициализация шаблона)
import { create } from './gulp/system/gulp.create.js';
import { createModule as module } from './gulp/system/gulp.module.js';
import { createPlugin as plugin } from './gulp/system/gulp.plugin.js';
import { remove } from './gulp/system/gulp.remove.js';
import { createStructure as init } from './gulp/system/gulp.init.js';
import { help } from './gulp/system/gulp.help.js';
import { deploy } from './gulp/deploy.js';

const version = getBuildSignature();
console.log(
  '📦 [CONTROL]: Сборка пустого шаблона выполняется под сигнатурой: ' +
    version +
    ',',
);

const { parallel, series } = gulp;
const loadedModules = {};

// 🎯 Карта маппинга задач для Lazy Loading пустого каркаса
const TASK_FILE_MAP = {
  styles: 'styles',
  scripts: 'scripts',
  html: 'html',
  fonts: 'fonts',
  fontsStyle: 'fonts',
  images: 'images',
  imagesDev: 'images',
  createWebp: 'images',
  sprite: 'images',
  favs: 'images',
  browsersync: 'server',
  startwatch: 'server',
};

/**
Автоматически генерирует файл конфигурации среды env-config.js из .env
*/
export const createEnvConfig = (done) => {
  const envPath = path.resolve('.env');
  let token = '';
  let chatId = '';

  if (fs.existsSync(envPath)) {
    const envFileContent = fs.readFileSync(envPath, 'utf8');
    const tokenMatch = envFileContent.match(/TELEGRAM_TOKEN\s*=\s*(.*)/);
    const chatIdMatch = envFileContent.match(/TELEGRAM_CHAT_ID\s*=\s*(.*)/);

    if (tokenMatch && tokenMatch[1]) token = tokenMatch[1].trim();
    if (chatIdMatch && chatIdMatch[1]) chatId = chatIdMatch[1].trim();
  }

  const envContent =
    "export const env = { TELEGRAM_TOKEN: '" +
    token +
    "', TELEGRAM_CHAT_ID: '" +
    chatId +
    "' };";
  const jsDir = path.join(config.srcFolder, 'js');
  if (!fs.existsSync(jsDir)) fs.mkdirSync(jsDir, { recursive: true });
  fs.writeFileSync(path.join(jsDir, 'env-config.js'), envContent);
  done();
};

/**
Динамический загрузчик изолированных Gulp-модулей (Lazy Loading)
*/
const runTask = (taskName) => {
  const gulpTaskWrapper = async (done) => {
    try {
      const fileName = TASK_FILE_MAP[taskName] || taskName;
      if (!loadedModules[fileName]) {
        loadedModules[fileName] = await import('./gulp/' + fileName + '.js');
      }
      const taskModule = loadedModules[fileName];
      const task = taskModule[taskName] || taskModule.default;
      if (typeof task === 'function') return task(done);
      done();
    } catch {
      console.error('\x1b[31m[Task Error] ' + taskName + '\x1b[0m');
      done();
    }
  };
  Object.defineProperty(gulpTaskWrapper, 'name', { value: taskName });
  return gulpTaskWrapper;
};

const compileAssets = parallel(
  runTask('styles'),
  runTask('scripts'),
  runTask('images'),
  runTask('createWebp'),
  runTask('sprite'),
);

// Продакшен-сборка пустого шаблона
export const build = series(
  createEnvConfig,
  cleandist,
  parallel(runTask('fonts'), runTask('fontsStyle'), runTask('favs')),
  parallel(...(isProd ? [lintCss, lintJs] : []), compileAssets),
  parallel(runTask('html')),
  zipFiles,
  (done) => {
    console.log('>>> 🚀 [Gulp 5] Empty Template successfully assembled! <<<');
    done();
  },
  deployLocal,
);

// Сценарий локальной разработки по умолчанию (Команда: npx gulp или npm run dev)
export default series(
  createEnvConfig,
  parallel(runTask('fonts'), runTask('fontsStyle'), runTask('favs')),
  parallel(runTask('html')),
  parallel(compileAssets),
  runTask('browsersync'),
  runTask('startwatch'),
);

// 📊 Автоматический инвестиционный конвейер аналитики QUIK и GigaChat
export const analyze = async (done) => {
  // Активируем поддержку TypeScript на лету для Node.js внутри Gulp
  const { register } = await import('ts-node');
  register({ compilerOptions: { module: 'NodeNext' }, esm: true });

  // Импортируем напрямую исходный файл .ts без привязки к сборке Webpack
  const { parseExcelAndFetchRecommendations } =
    await import('./src/js/modules/ai-advisor/ai-advisor.ts');
  await parseExcelAndFetchRecommendations();
  done();
};

// Системный экспорт для CLI-регистрации
export {
  create,
  remove,
  module,
  plugin,
  init,
  help,
  deploy,
  cleandist,
  lintJs,
  lintCss,
};

// Явная ленивая регистрация деструктурированных ссылок задач
export const favs = runTask('favs');
export const styles = runTask('styles');
export const scripts = runTask('scripts');
export const html = runTask('html');
export const images = runTask('images');
export const createWebp = runTask('createWebp');
export const sprite = runTask('sprite');
export const fonts = runTask('fonts');
export const fontsStyle = runTask('fontsStyle');
export const browsersync = runTask('browsersync');
export const startwatch = runTask('startwatch');
