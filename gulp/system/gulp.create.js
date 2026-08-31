import fs from 'fs';
import path from 'path';
import { config } from '../../gulp.config.js';

const toCamelCase = (str) =>
  str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

const updateFileContent = (filePath, modifyCallback) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const newContent = modifyCallback(content);
  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent);
  }
};

export function create(done) {
  const args = process.argv.slice(3);
  let name = args.find((arg) => arg.startsWith('--'))?.replace(/^--/, '');

  if (!name) {
    console.error(
      '❌ Ошибка: Укажите имя блока (например: gulp create --my-block)',
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

  // 2. ПОДКЛЮЧЕНИЕ СКРИПТОВ (Строго под маркеры группы компонентов)
  const appPath = path.join(config.srcFolder, 'js', 'app.ts');
  updateFileContent(appPath, (content) => {
    const importStr = `import { ${camelName} } from '../components/${name}/${name}';`;
    const callStr = `${camelName}();`;

    const targetImportRegex =
      /(\/\/ =+)\r?\n\/\/ 🧩 КОМПОНЕНТЫ И ИНТЕРФЕЙСНЫЕ БЛОКИ\r?\n(\/\/ =+)/;

    const targetCallRegex = /(\/\/ \s*\[ВЫЗОВЫ ГЛАВНАЯ\])/m;

    let newContent = content;
    if (!newContent.includes(importStr)) {
      newContent = newContent.replace(
        targetImportRegex,
        `$1\n// 🧩 КОМПОНЕНТЫ И ИНТЕРФЕЙСНЫЕ БЛОКИ\n$2\n${importStr}`,
      );
    }
    if (!newContent.includes(callStr)) {
      // Вставляем вызов функции прямо НАД маркером вызова, защищая от склеек текста
      newContent = newContent.replace(targetCallRegex, `${callStr}\n  $1`);
    }
    return newContent;
  });

  console.log(`✅ Блок "${name}" успешно создан и подключен!`);
  done();
}
