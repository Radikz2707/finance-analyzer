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

const PROTECTED_NAMES = [
  'js',
  'scss',
  'sass',
  'css',
  'html',
  'img',
  'images',
  'fonts',
  'favicons',
  'components',
  'modules',
  'plugins',
  'pipeline',
  'agents',
  'agent',
  'src',
  'dist',
  'app',
  'index',
  'main',
  'types',
  'config',
  'system',
  'gulp',
  'gulpfile',
  'cwd',
  'force',
  'data',
  'python',
  'parts',
  'assets',
  'quik',
  'scripts',
  'test',
  'tests',
];

/**
 * Допустимые имена ресурсов: латиница, цифры и дефисы.
 * Имя не может начинаться с точки или дефиса.
 */
const NAME_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

const toCamelCase = (str) =>
  str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

const updateFileContent = (filePath, modifyCallback) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  // Сохраняем переводы строк файла (app.ts/style.scss в CRLF) —
  // иначе удаление ресурса ломает git-diff всего файла.
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n/g, '\n');
  const updatedContent = modifyCallback(normalized);
  if (updatedContent === normalized) return;
  const withEol = updatedContent.replace(/\n/g, eol);
  fs.writeFileSync(filePath, withEol.endsWith(eol) ? withEol : withEol + eol);
};

const cleanAppTs = (filePath, blockName, camelName) => {
  updateFileContent(filePath, (content) => {
    const lines = content.split('\n');
    const filteredLines = lines.filter((line) => {
      const trimmed = line.trim();
      const escapeRegExp = (string) =>
        string.replace(/[.*+?^{}()|[\]\\]/g, '\\$&');
      const escapedBlock = escapeRegExp(blockName);
      // Учитываем как пути без расширения ('./modules/x/x'),
      // так и с расширением ('./modules/x/x.js' / '.ts')
      const importRegex = new RegExp(
        `^import\\s+.*\\s+from\\s+['"].*?\\/${escapedBlock}(?:\\.(?:js|ts))?['"];?$`,
      );
      return (
        !importRegex.test(trimmed) &&
        trimmed.replace(/\s+/g, '') !== `${camelName}();`
      );
    });
    return filteredLines.join('\n').replace(/\n{3,}/g, '\n\n');
  });
  console.log('✂️ Импорты и вызовы TS успешно вычищены.');
};

const cleanStyleScss = (filePath, blockName) => {
  updateFileContent(filePath, (content) => {
    const lines = content.split(/\r?\n/);
    const filteredLines = lines.filter((line) => {
      const trimmed = line.trim();
      const escapeRegExp = (string) =>
        string.replace(/[.*+?^{}()|[\]\\]/g, '\\$&');
      const scssRegex = new RegExp(
        `@use\\s+['"].*?\\/${escapeRegExp(blockName)}['"];?`,
      );
      return !scssRegex.test(trimmed);
    });
    return filteredLines.join('\n').replace(/\n{3,}/g, '\n\n');
  });
  console.log(`✂️ Стили удалены из style.${config.scssExtension}`);
};

const cleanIndexHtml = (filePath, blockName) => {
  updateFileContent(filePath, (content) => {
    const htmlIncludeReg = new RegExp(
      `@@include\\(['"].*?${blockName}/${blockName}.html['"]\\)\\r?\\n?`,
      'g',
    );
    return content.replace(htmlIncludeReg, '').replace(/\n{3,}/g, '\n\n');
  });
  console.log('✂️ Инклуд удален из HTML.');
};

const checkDirectorySafety = (dirPath) => {
  if (!fs.existsSync(dirPath)) return true;
  if (!fs.statSync(dirPath).isDirectory()) return true;

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file === 'img') {
        const imgFiles = fs
          .readdirSync(fullPath)
          .filter((f) => f !== '.gitkeep');
        if (imgFiles.length === 0) continue;
      }
      return false;
    }

    const content = fs.readFileSync(fullPath, 'utf-8').trim();

    if (file.endsWith('.html')) {
      const cleanContent = content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(
          /<section[^>]*>[\s\S]*?<div[^>]*>[\s\S]*?<h2[^>]*>[\s\S]*?<\/h2>[\s\S]*?<\/div>[\s\S]*?<\/section>/gi,
          '',
        )
        .trim();
      if (cleanContent.length > 0) return false;
      continue;
    }

    if (file.endsWith('.scss') || file.endsWith('.sass')) {
      const cleanContent = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
        .replace(/@use\s+['"][^'"]+['"]\s*as\s+\w+;/g, '')
        .replace(/\.[\w-]+\s*\{\s*[\s\S]*?\s*\}/gi, '')
        .trim();
      if (cleanContent.length > 0) return false;
      continue;
    }

    if (file.endsWith('.ts') || file.endsWith('.js')) {
      const cleanContent = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*/g, '')
        .replace(
          // Шаблон заглушки из gulp.module.js / gulp.plugin.js допускает ": void"
          /export\s+const\s+\w+\s*=\s*\(\s*\)\s*(:\s*void)?\s*=>\s*\{\s*console\.log\([\s\S]*?\);?\s*\};?/gi,
          '',
        )
        .trim();
      if (cleanContent.length > 0) return false;
      continue;
    }

    // Служебные пустые файлы (.gitkeep и т.п.) — допустимы.
    // Любой неизвестный файл с непустым содержимым — рабочий код.
    if (file !== '.gitkeep' && content.length > 0) return false;
  }
  return true;
};

export const remove = (done) => {
  ensureProjectCwd();
  // Имя ресурса — ПОСЛЕДНИЙ не-флаговый --аргумент:
  // --gulpfile/--cwd/--force идут раньше имени
  const dashedArgs = process.argv.filter((arg) => arg.startsWith('--'));
  const force = dashedArgs.includes('--force');
  const knownFlags = new Set(['--force', '--gulpfile', '--cwd']);
  const nameArgs = dashedArgs.filter((arg) => !knownFlags.has(arg));
  const blockName = nameArgs[nameArgs.length - 1]?.replace('--', '');
  if (!blockName) {
    console.log('\n❌ Ошибка: Укажите имя! Пример: gulp remove --header\n');
    return done();
  }
  if (!NAME_FORMAT.test(blockName)) {
    console.log(
      `\n❌ Ошибка: Недопустимое имя "${blockName}".\n` +
        '   Разрешены только латиница, цифры и дефис (например: my-block-2).\n',
    );
    return done();
  }
  if (PROTECTED_NAMES.includes(blockName.toLowerCase())) {
    console.log(
      `\n❌ Ошибка: Удаление системной папки "${blockName}" запрещено!\n`,
    );
    return done();
  }

  const camelName = toCamelCase(blockName);
  const possibleDirs = [
    path.join(config.structure.components, blockName),
    path.join(config.structure.modules, blockName),
    path.join(config.structure.plugins, blockName),
  ];
  const possibleFiles = [
    path.join(config.structure.modules, `${blockName}.ts`),
    path.join(config.structure.plugins, `${blockName}.ts`),
  ];

  const hasDirectory = possibleDirs.some((dir) => fs.existsSync(dir));
  const hasSingleFile = possibleFiles.some((file) => fs.existsSync(file));

  if (!hasDirectory && !hasSingleFile) {
    console.log(
      `\n⚠️ Ошибка: Ресурс "${blockName}" не найден на диске. Нечего удалять!\n`,
    );
    return done();
  }

  // Одиночные файлы вне структуры папок удаляются ТОЛЬКО с явным --force
  if (hasSingleFile && !hasDirectory && !force) {
    console.log(
      `\n🛑 Защита: "${blockName}" — одиночный файл без папки-заглушки.\n` +
        '   Удаление файлов вне архитектуры разрешено только с флагом --force:\n' +
        `   gulp remove --${blockName} --force\n`,
    );
    return done();
  }

  // Каталоги с «рабочим кодом» — только с явным --force
  for (const dir of possibleDirs) {
    if (fs.existsSync(dir) && !checkDirectorySafety(dir)) {
      if (!force) {
        console.log(
          `\n🛑 Защита: Компонент "${blockName}" содержит рабочий код.\n` +
            '   Автоматическое удаление запрещено! Если вы уверены, повторите с флагом --force:\n' +
            `   gulp remove --${blockName} --force\n`,
        );
        return done(new Error('Попытка удаления заполненного компонента.'));
      }
      console.log(
        `\n⚠️ ВНИМАНИЕ: удаление рабочего кода "${blockName}" с флагом --force.\n`,
      );
    }
  }

  const mainJsPath = config.paths.scripts.src;
  const mainScssPath = path.join(
    config.srcFolder,
    config.scssExtension,
    `style.${config.scssExtension}`,
  );
  const indexHtmlPath = path.join(config.srcFolder, 'index.html');

  possibleDirs.forEach((dir) => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`🗑️ Папка удалена: ${dir}`);
    }
  });

  possibleFiles.forEach((file) => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`🗑️ Файл удален: ${file}`);
    }
  });

  cleanAppTs(mainJsPath, blockName, camelName);
  cleanStyleScss(mainScssPath, blockName);
  cleanIndexHtml(indexHtmlPath, blockName);

  console.log(
    `\n✅ "${blockName}" полностью вырезан из архитектуры проекта.\n`,
  );
  done();
};
