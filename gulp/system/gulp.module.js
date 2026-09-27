import fs from 'fs';
import path from 'path';
import { config } from '../../gulp.config.js';

/** Корень проекта: системные гулпфайлы Gulp запускает из gulp/system/ */
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Вернуть CWD в корень проекта.
 *
 * Gulp 5 при запуске через --gulpfile меняет process.cwd() на папку
 * гулпфайла (gulp/system/), из-за чего относительные пути из
 * gulp.config.js (src/js/modules и т.д.) ломаются. Без этого вызова
 * модуль создавался в gulp/system/src/... вместо src/js/modules/...
 */
const ensureProjectCwd = () => {
  if (process.cwd() !== PROJECT_ROOT) {
    process.chdir(PROJECT_ROOT);
  }
};

const toCamelCase = (str) =>
  str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

const updateFileContent = (filePath, modifyCallback) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  // Сохраняем переводы строк файла (app.ts/style.scss в CRLF) —
  // иначе каждый запуск ломает git-diff.
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n/g, '\n');
  const updatedContent = modifyCallback(normalized);
  if (updatedContent === normalized) return;
  const withEol = updatedContent.replace(/\n/g, eol);
  fs.writeFileSync(filePath, withEol.endsWith(eol) ? withEol : withEol + eol);
};

const updateAppTs = (filePath, name, camelName) => {
  updateFileContent(filePath, (content) => {
    const importLine = `import { ${camelName} } from './modules/${name}/${name}';`;
    const callLine = `${camelName}();`;

    let newContent = content;

    if (!newContent.includes(importLine)) {
      // 1) Секция компонентов — вставляем перед маркером
      const componentsMarker =
        /(\/\/\s*=+\s*\r?\n\/\/\s*🧩 КОМПОНЕНТЫ И ИНТЕРФЕЙСНЫЕ БЛОКИ)/;
      if (componentsMarker.test(newContent)) {
        newContent = newContent.replace(
          componentsMarker,
          `${importLine}\n\n$1`,
        );
      } else {
        // 2) Fallback: секция внешних библиотек — вставляем сразу после блока.
        //    НЕ захватываем перенос после закрывающей «// ====», иначе
        //    импорты склеиваются в одну строку при повторных вставках.
        const externalMarker =
          /(\/\/\s*=+\s*\r?\n\/\/\s*📦 ВНЕШНИЕ БИБЛИОТЕКИ И СИСТЕМНЫЕ МОДУЛИ\r?\n\/\/\s*=+)/;
        if (externalMarker.test(newContent)) {
          newContent = newContent.replace(externalMarker, `$1\n${importLine}`);
        } else {
          // 3) Последний fallback: после последнего import
          const lines = newContent.split('\n');
          let lastImportIndex = -1;
          lines.forEach((line, index) => {
            if (/^\s*import\s/.test(line)) lastImportIndex = index;
          });
          if (lastImportIndex !== -1) {
            lines.splice(lastImportIndex + 1, 0, importLine);
            newContent = lines.join('\n');
          }
        }
      }
    }

    if (!newContent.includes(callLine)) {
      const callMarkers = [
        /^(\s*)(\/\/\s*\[ДИНАМИЧЕСКИЕ МОДУЛИ\])/m,
        /^(\s*)(\/\/\s*\[ВЫЗОВЫ ГЛАВНАЯ\])/m,
      ];
      for (const marker of callMarkers) {
        if (marker.test(newContent)) {
          newContent = newContent.replace(marker, `$1${callLine}\n$1$2`);
          break;
        }
      }
    }

    return newContent.replace(/\n{3,}/g, '\n\n');
  });
  console.log('📝 Модуль успешно добавлен в app.ts');
};

const updateStyleScss = (filePath, dirPath, name, camelName) => {
  updateFileContent(filePath, (content) => {
    const styleDir = path.dirname(filePath);
    let relativePath = path
      .relative(styleDir, path.join(dirPath, name))
      .replace(/\\/g, '/');
    if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;

    const newImport = `@use '${relativePath}' as ${camelName};`;
    if (content.includes(newImport)) return content;

    const targetMarker = '// ФУНКЦИОНАЛЬНЫЕ JS/TS МОДУЛИ';

    if (content.includes(targetMarker)) {
      return content.replace(targetMarker, `${targetMarker}\n${newImport}`);
    } else {
      return content + `\n${newImport}`;
    }
  });
  console.log('🎨 Стили добавили в блок модулей style.scss');
};

export const createModule = (done) => {
  ensureProjectCwd();
  // Имя модуля — ПОСЛЕДНИЙ --аргумент: --gulpfile/--cwd идут раньше
  const dashedArgs = process.argv.filter((arg) => arg.startsWith('--'));
  const name = dashedArgs[dashedArgs.length - 1]?.replace('--', '');
  if (!name) {
    console.log('\n❌ Укажите имя модуля! Пример: gulp module --my-block\n');
    return done();
  }
  if (name === 'gulpfile' || name === 'cwd') {
    console.error(
      `\n❌ Ошибка: Имя "${name}" конфликтует с CLI-флагом Gulp. Выберите другое имя.\n`,
    );
    return done();
  }

  const camelName = toCamelCase(name);
  const dirPath = path.join(config.structure.modules, name);
  const appJsPath = path.join(config.srcFolder, 'js', 'app.ts');
  const styleScssPath = path.join(
    config.srcFolder,
    config.scssExtension,
    `style.${config.scssExtension}`,
  );

  if (fs.existsSync(dirPath)) {
    console.log(`\n⚠️ Модуль "${name}" уже существует!\n`);
    return done();
  }

  fs.mkdirSync(dirPath, { recursive: true });
  fs.mkdirSync(path.join(dirPath, 'img'), { recursive: true });
  fs.writeFileSync(path.join(dirPath, 'img', '.gitkeep'), '');

  const tsTemplate = `export const ${camelName} = (): void => {\n  console.log('Модуль ${name} (TS) инициализирован');\n};\n`;
  const scssTemplate = `.${name} {\n  \n}\n`;

  fs.writeFileSync(path.join(dirPath, `${name}.ts`), tsTemplate);
  fs.writeFileSync(path.join(dirPath, `${name}.scss`), scssTemplate);

  updateAppTs(appJsPath, name, camelName);
  updateStyleScss(styleScssPath, dirPath, name, camelName);

  console.log(`\n✅ Модуль "${name}" (TS: ${camelName}) успешно создан!\n`);
  done();
};

export { createModule as module };
