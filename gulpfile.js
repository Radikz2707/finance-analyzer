/* cspell:disable */
import gulp from 'gulp';

// ─── Глобальная регистрация ts-node (один раз, с защитой от повторного вызова) ───
// ts-node регистрирует хуки на уровне Node.js, поэтому повторная регистрация
// вызывает утечку памяти и зависание вотчера. Guard-семафор предотвращает
// двойную инициализацию при многократных запусках таски "analyze".
let _tsNodeRegistered = false;
async function ensureTsNodeRegistered() {
  if (_tsNodeRegistered) return;
  const { register } = await import('ts-node');
  register({ compilerOptions: { module: 'NodeNext' }, esm: true });
  _tsNodeRegistered = true;
}

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
 * УДАЛЕНО: генерация env-config.js из .env.
 * Причина: CWE-522 — токены из .env (TELEGRAM_BOT_TOKEN и др.)
 * парсились регулярным выражением и записывались в src/js/env-config.js,
 * который затем собирался Webpack в публичный бандл dist/js/app.min.js.
 *
 * Токены теперь используются ИСКЛЮЧИТЕЛЬНО на стороне бэкенд-агентов
 * через прямой доступ к process.env (dotenv/config в pipeline.ts).
 * Файл env-config.js удалён из архитектуры фронтенд-сборки.
 */

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
  parallel(runTask('fonts'), runTask('fontsStyle'), runTask('favs')),
  parallel(runTask('html')),
  parallel(compileAssets),
  runTask('browsersync'),
  runTask('startwatch'),
);

// 📊 Автоматический инвестиционный конвейер аналитики QUIK и GigaChat
export const analyze = async (done) => {
  try {
    // Используем глобальный guard — ensureTsNodeRegistered() вызывает
    // register() ровно один раз, предотвращая утечку памяти от повторной
    // регистрации хуков ts-node при многократных запусках таски.
    await ensureTsNodeRegistered();

    // Импортируем напрямую исходный файл .ts без привязки к сборке Webpack
    const { parseExcelAndFetchRecommendations } =
      await import('./src/js/modules/ai-advisor/ai-advisor.ts');
    await parseExcelAndFetchRecommendations();
    done();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('\x1b[31m[analyze] Ошибка конвейера:\x1b[0m', msg);
    done(); // Гарантированный вызов done() предотвращает зависание Gulp-планировщика
  }
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
