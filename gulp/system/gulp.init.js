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

export function createStructure(done) {
  ensureProjectCwd();
  const srcFolder = config.srcFolder || 'src';
  const scssExtension = config.scssExtension || 'scss';
  const struct = config.structure;

  const zeroContent = `/* Обнуление (Zero Styles) */
* { padding: 0; margin: 0; border: 0; }
*, *:before, *:after { -webkit-box-sizing: border-box; box-sizing: border-box; }
:focus { outline: none; }
:focus-visible { outline: 2px solid #2196f3; outline-offset: 2px; }
html, body { height: 100%; width: 100%; min-width: 320px; font-size: 100%; line-height: 1; -webkit-font-smoothing: antialiased; }
html { scroll-behavior: smooth; scrollbar-gutter: stable; }
body { display: flex; flex-direction: column; }
nav, footer, header, main, aside, section { display: block; }
input, button, textarea, select { font-family: inherit; font-size: inherit; background-color: transparent; outline: none; }
button { cursor: pointer; color: inherit; -webkit-appearance: none; appearance: none; }
textarea { resize: vertical; }
a { text-decoration: none; color: inherit; }
ul li { list-style: none; }
img, svg, video, canvas { display: block; max-width: 100%; height: auto; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
table { border-collapse: collapse; border-spacing: 0; }
[hidden] { display: none !important; }`;

  const indexHTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SITE_NAME</title>
  <meta name="description" content="Описание вашего проекта" />
  <link rel="stylesheet" href="css/app.min.css">
  <script>document.body ? document.body.classList.add('_js-ready') : document.addEventListener('DOMContentLoaded', () => document.body.classList.add('_js-ready'));</script>
</head>
<body>
  <div class="wrapper">
    @@include('components/header/header.html')
    <main class="main">
      @@include('components/main/main.html')
    </main>
    @@include('components/footer/footer.html')
  </div>

  <script src="js/app.min.js"></script>
</body>
</html>`;

  const styleSCSS = `@use "base/zero";
@use "../components/header/header";
@use "../components/main/main";
@use "../components/footer/footer";`;

  const appJsContent = `import { header } from '../components/header/header';
import { main } from '../components/main/main';
import { footer } from '../components/footer/footer';

// Инициализация компонентов
const initApp = () => {
  document.body.classList.add('_js-ready');
  header();
  main();
  footer();
};

if (document.readyState === 'complete') {
  initApp();
} else {
  window.addEventListener('load', initApp);
}

console.log('🚀 Radik.Dev: TypeScript успешно инициализирован');`;

  /**
   * Шаблоны компонентов H-M-F: создаются ТОЛЬКО на чистом проекте.
   * В живом проекте (index.html / style.scss уже существуют) их создание
   * без подключения к app.ts и style.scss привело бы к «висящим» файлам.
   */
  const componentsMeta = [
    {
      name: 'header',
      html: `<header class="header">
  <div class="container">
    <h1>Header Component</h1>
  </div>
</header>`,
      scss: '.header { padding: 20px; background: #f4f4f4; }',
      ts: `export const header = (): void => {
  console.log('Header TS Loaded');
};`,
    },
    {
      name: 'main',
      html: `<main class="main">
  <div class="container">
    <h2>Main Content</h2>
  </div>
</main>`,
      scss: '.main { flex: 1 1 auto; padding: 40px 0; }',
      ts: `export const main = (): void => {
  console.log('Main TS Loaded');
};`,
    },
    {
      name: 'footer',
      html: `<footer class="footer">
  <div class="container">
    <p>Footer Component</p>
  </div>
</footer>`,
      scss: '.footer { padding: 20px; background: #333; color: #fff; }',
      ts: `export const footer = (): void => {
  console.log('Footer TS Loaded');
};`,
    },
  ];

  const mainScssPath = path.join(
    srcFolder,
    scssExtension,
    `style.${scssExtension}`,
  );
  // Признак «чистого» проекта: нет ни index.html, ни style.scss —
  // значит структура ещё не разворачивалась, можно создавать всё.
  const isFreshProject =
    !fs.existsSync(path.join(srcFolder, 'index.html')) &&
    !fs.existsSync(mainScssPath);

  const folders = [
    srcFolder,
    path.join(srcFolder, 'js'),
    path.join(srcFolder, scssExtension, 'base'),
    struct.components,
    struct.modules,
    struct.plugins,
    path.join(srcFolder, 'parts'),
    path.join(srcFolder, 'images', 'src'),
    path.join(srcFolder, 'fonts', 'src'),
  ];

  let createdDirs = 0;
  folders.forEach((dir) => {
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      createdDirs++;
    }
  });

  const files = [
    {
      path: path.join(srcFolder, 'index.html'),
      content: indexHTML,
      integration: true,
    },
    {
      path: path.join(srcFolder, 'js', 'app.ts'),
      content: appJsContent,
      integration: true,
    },
    { path: mainScssPath, content: styleSCSS, integration: true },
    {
      path: path.join(
        srcFolder,
        scssExtension,
        'base',
        `_zero.${scssExtension}`,
      ),
      content: zeroContent,
      integration: true,
    },
  ];

  // H-M-F компоненты — только на чистом проекте, вместе с их img/.gitkeep
  if (isFreshProject) {
    componentsMeta.forEach((component) => {
      const dirPath = path.join(struct.components, component.name);
      files.push(
        {
          path: path.join(dirPath, `${component.name}.html`),
          content: component.html,
        },
        {
          path: path.join(dirPath, `${component.name}.${scssExtension}`),
          content: component.scss,
        },
        {
          path: path.join(dirPath, `${component.name}.ts`),
          content: component.ts,
        },
        { path: path.join(dirPath, 'img', '.gitkeep'), content: '' },
      );
    });
  }

  let createdFiles = 0;
  let skippedFiles = 0;
  files.forEach((file) => {
    // Гарантируем наличие родительской папки (защита от ENOENT)
    const dirPath = path.dirname(file.path);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      createdDirs++;
    }
    // Никогда не перезаписываем существующие файлы (идемпотентность)
    if (fs.existsSync(file.path)) {
      skippedFiles++;
      return;
    }
    fs.writeFileSync(file.path, file.content);
    createdFiles++;
  });

  if (isFreshProject) {
    console.log(
      '\n✅ Модульная структура на TypeScript (H-M-F) создана с нуля.',
    );
  } else {
    console.log(
      '\n⚠️ Проект уже инициализирован: существующие файлы НЕ перезаписаны.',
    );
    console.log(
      '   Создавайте компоненты/модули/плагины командами:\n' +
        '   npm run create -- --<имя> | npm run module -- --<имя> | npm run plugin -- --<имя>',
    );
  }
  console.log(
    `   📁 Папок создано: ${createdDirs} | 📄 Файлов создано: ${createdFiles} | ⏭️ Пропущено (уже есть): ${skippedFiles}\n`,
  );
  done();
}

export { createStructure as init };
