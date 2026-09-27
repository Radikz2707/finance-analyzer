import fs from 'fs';
import path from 'path';
import { config } from '../../gulp.config.js';

/** Корень проекта: системные гулпфайлы Gulp запускает из gulp/system/ */
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Вернуть CWD в корень проекта (Gulp меняет CWD на папку гулпфайла,
 * из-за чего относительные пути из gulp.config.js ломаются).
 */
const ensureProjectCwd = () => {
  if (process.cwd() !== PROJECT_ROOT) {
    process.chdir(PROJECT_ROOT);
  }
};

const toCamelCase = (str) =>
  str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/**
 * Безопасное обновление файла с сохранением перевода строк (CRLF/LF):
 * нормализуем контент к LF для поиска маркеров, а на диск пишем
 * обратно в исходном формате (иначе каждый запуск ломает diff).
 */
const updateFileContent = (filePath, modifyCallback) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n/g, '\n');
  const newContent = modifyCallback(normalized);
  if (newContent === normalized) return;
  const withEol = newContent.replace(/\n/g, eol);
  fs.writeFileSync(filePath, withEol.endsWith(eol) ? withEol : withEol + eol);
};

/**
 * Вставка import в app.ts:
 *  1) секция «🧩 КОМПОНЕНТЫ И ИНТЕРФЕЙСНЫЕ БЛОКИ» — перед маркером;
 *  2) иначе секция «📦 ВНЕШНИЕ БИБЛИОТЕКИ И СИСТЕМНЫЕ МОДУЛИ» — сразу после блока;
 *  3) иначе — после последней существующей строки import.
 */
const insertImport = (content, importStr) => {
  if (content.includes(importStr)) return content;

  const componentsMarker =
    /(\/\/\s*=+\s*\r?\n\/\/\s*🧩 КОМПОНЕНТЫ И ИНТЕРФЕЙСНЫЕ БЛОКИ)/;
  if (componentsMarker.test(content)) {
    return content.replace(componentsMarker, `${importStr}\n\n$1`);
  }

  // ВАЖНО: не захватываем перенос строки после закрывающей «// ====»,
  // иначе замена теряет разделитель и импорты склеиваются в одну строку.
  const externalMarker =
    /(\/\/\s*=+\s*\r?\n\/\/\s*📦 ВНЕШНИЕ БИБЛИОТЕКИ И СИСТЕМНЫЕ МОДУЛИ\r?\n\/\/\s*=+)/;
  if (externalMarker.test(content)) {
    return content.replace(externalMarker, `$1\n${importStr}`);
  }

  const lines = content.split('\n');
  let lastImportIndex = -1;
  lines.forEach((line, index) => {
    if (/^\s*import\s/.test(line)) lastImportIndex = index;
  });
  if (lastImportIndex !== -1) {
    lines.splice(lastImportIndex + 1, 0, importStr);
    return lines.join('\n');
  }

  return `${importStr}\n\n${content}`;
};

/** Вставка вызова над маркером с сохранением отступа строки маркера. */
const insertCall = (content, callStr) => {
  if (content.includes(callStr)) return content;
  const callMarkers = [
    /^(\s*)(\/\/\s*\[ДИНАМИЧЕСКИЕ МОДУЛИ\])/m,
    /^(\s*)(\/\/\s*\[ВЫЗОВЫ ГЛАВНАЯ\])/m,
  ];
  for (const marker of callMarkers) {
    if (marker.test(content)) {
      return content.replace(marker, `$1${callStr}\n$1$2`);
    }
  }
  return content;
};

export function create(done) {
  ensureProjectCwd();
  // Имя блока — ПОСЛЕДНИЙ --аргумент: --gulpfile/--cwd идут раньше
  const dashedArgs = process.argv.filter((arg) => arg.startsWith('--'));
  const name = dashedArgs[dashedArgs.length - 1]?.replace(/^--/, '');

  if (!name) {
    console.error(
      '❌ Ошибка: Укажите имя блока (например: gulp create --my-block)',
    );
    return done();
  }
  if (name === 'gulpfile' || name === 'cwd') {
    console.error(
      `❌ Ошибка: Имя "${name}" конфликтует с CLI-флагом Gulp. Выберите другое имя.`,
    );
    return done();
  }

  const struct = config.structure;
  const scssExt = config.scssExtension;
  const blockDir = path.join(struct.components, name);
  const imgDir = path.join(blockDir, 'img');
  const camelName = toCamelCase(name);

  if (fs.existsSync(blockDir)) {
    console.error(`❌ Ошибка: Блок "${name}" уже существует!`);
    return done();
  }

  // Создаем структуру папок
  fs.mkdirSync(blockDir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });
  fs.writeFileSync(path.join(imgDir, '.gitkeep'), '');

  // Генерируем файлы-заглушки
  fs.writeFileSync(
    path.join(blockDir, `${name}.html`),
    `<section class="${name}">\n  <div class="${name}__container container">\n    <h2>${name} Component</h2>\n  </div>\n</section>`,
  );
  fs.writeFileSync(
    path.join(blockDir, `${name}.${scssExt}`),
    `.${name} {\n  padding: 50px 0;\n}`,
  );
  fs.writeFileSync(
    path.join(blockDir, `${name}.ts`),
    `export const ${camelName} = (): void => {\n  console.log('Блок ${name} (TS) инициализирован');\n};`,
  );

  // 1. ПОДКЛЮЧЕНИЕ СТИЛЕЙ (Умная вставка без дублирования пустых строк)
  const stylePath = path.join(config.srcFolder, scssExt, `style.${scssExt}`);
  updateFileContent(stylePath, (content) => {
    const importStr = `@use '../components/${name}/${name}';`;
    if (content.includes(importStr)) return content;

    const targetRegex = /\s*\n\/\/ ФУНКЦИОНАЛЬНЫЕ JS\/TS МОДУЛИ/;
    if (targetRegex.test(content)) {
      return content.replace(
        targetRegex,
        `\n${importStr}\n\n// ФУНКЦИОНАЛЬНЫЕ JS/TS МОДУЛИ`,
      );
    } else {
      return content + `\n${importStr}`;
    }
  });

  // 2. ПОДКЛЮЧЕНИЕ СКРИПТОВ (по маркерам проекта с fallback-логикой)
  const appPath = path.join(config.srcFolder, 'js', 'app.ts');
  updateFileContent(appPath, (content) => {
    const importStr = `import { ${camelName} } from '../components/${name}/${name}';`;
    const callStr = `${camelName}();`;
    return insertCall(insertImport(content, importStr), callStr);
  });

  console.log(`✅ Блок "${name}" успешно создан и подключен!`);
  done();
}
