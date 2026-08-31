import fs from 'fs';
import path from 'path';
import { config } from '../../gulp.config.js';

const toCamelCase = (str) =>
  str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

const updateFileContent = (filePath, modifyCallback) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const updatedContent = modifyCallback(content);
  if (updatedContent !== content) {
    fs.writeFileSync(filePath, updatedContent.trimEnd() + '\n');
  }
};

const updateAppTs = (filePath, name, camelName) => {
  updateFileContent(filePath, (content) => {
    const importLine = `import { ${camelName} } from './plugins/${name}/${name}';`;
    const callLine = `${camelName}();`;

    let newContent = content;

    if (!newContent.includes(importLine)) {
      const targetMarker =
        /\s*\n\/\/ ==========================================\n\/\/ 🧩 КОМПОНЕНТЫ И ИНТЕРФЕЙСНЫЕ БЛОКИ/;
      if (targetMarker.test(newContent)) {
        newContent = newContent.replace(
          targetMarker,
          `\n${importLine}\n\n// ==========================================\n// 🧩 КОМПОНЕНТЫ И ИНТЕРФЕЙСНЫЕ БЛОКИ`,
        );
      } else {
        const fallbackMarker =
          '// ==========================================\n// 📦 ВНЕШНИЕ БИБЛИОТЕКИ И СИСТЕМНЫЕ МОДУЛИ\n// ==========================================';
        newContent = newContent.replace(
          fallbackMarker,
          `${fallbackMarker}\n${importLine}`,
        );
      }
    }

    if (!newContent.includes(callLine)) {
      const targetCallMarker = '// [ДИНАМИЧЕСКИЕ МОДУЛИ]';
      newContent = newContent.replace(
        targetCallMarker,
        `${callLine}\n${targetCallMarker}`,
      );
    }

    return newContent.replace(/\n{3,}/g, '\n\n');
  });
  console.log('📝 Плагин успешно добавлен в app.ts');
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
  console.log('🎨 Стили плагина добавлены в style.scss');
};

export const createPlugin = (done) => {
  const name = process.argv
    .find((arg) => arg.startsWith('--'))
    ?.replace('--', '');
  if (!name) {
    console.log('\n❌ Укажите имя плагина! Пример: gulp plugin --my-plugin\n');
    return done();
  }

  const camelName = toCamelCase(name);
  const dirPath = path.join(config.structure.plugins, name);
  const appJsPath = path.join(config.srcFolder, 'js', 'app.ts');
  const styleScssPath = path.join(
    config.srcFolder,
    config.scssExtension,
    `style.${config.scssExtension}`,
  );

  if (fs.existsSync(dirPath)) {
    console.log(`\n⚠️ Плагин "${name}" уже существует!\n`);
    return done();
  }

  fs.mkdirSync(dirPath, { recursive: true });
  fs.mkdirSync(path.join(dirPath, 'img'), { recursive: true });
  fs.writeFileSync(path.join(dirPath, 'img', '.gitkeep'), '');

  const tsTemplate = `export const ${camelName} = (): void => {\n  console.log('Плагин ${name} (TS) инициализирован');\n};\n`;
  const scssTemplate = `.${name} {\n  \n}\n`;

  fs.writeFileSync(path.join(dirPath, `${name}.ts`), tsTemplate);
  fs.writeFileSync(path.join(dirPath, `${name}.scss`), scssTemplate);

  updateAppTs(appJsPath, name, camelName);
  updateStyleScss(styleScssPath, dirPath, name, camelName);

  console.log(`\n✅ Плагин "${name}" (TS: ${camelName}) успешно создан!\n`);
  done();
};
