import fs from 'fs';
import path from 'path';
import { config } from '../../gulp.config.js';

export function createStructure(done) {
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

  const folders = [
    srcFolder,
    path.join(srcFolder, scssExtension, 'base'),
    struct.components,
    struct.modules,
    struct.plugins,
    path.join(srcFolder, 'parts'),
    path.join(srcFolder, 'images', 'src'),
    path.join(srcFolder, 'fonts', 'src'),
    path.join(struct.components, 'header'),
    path.join(struct.components, 'header', 'img'),
    path.join(struct.components, 'main'),
    path.join(struct.components, 'main', 'img'),
    path.join(struct.components, 'footer'),
    path.join(struct.components, 'footer', 'img'),
  ];

  folders.forEach((dir) => {
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  const files = [
    { path: path.join(srcFolder, 'index.html'), content: indexHTML },
    { path: path.join(srcFolder, 'js', 'app.ts'), content: appJsContent },
    {
      path: path.join(srcFolder, scssExtension, `style.${scssExtension}`),
      content: styleSCSS,
    },
    {
      path: path.join(
        srcFolder,
        scssExtension,
        'base',
        `_zero.${scssExtension}`,
      ),
      content: zeroContent,
    },

    {
      path: path.join(struct.components, 'header', 'header.html'),
      content: `<header class="header">
  <div class="container">
    <h1>Header Component</h1>
  </div>
</header>`,
    },
    {
      path: path.join(struct.components, 'header', `header.${scssExtension}`),
      content: '.header { padding: 20px; background: #f4f4f4; }',
    },
    {
      path: path.join(struct.components, 'header', 'header.ts'),
      content: `export const header = (): void => {
  console.log('Header TS Loaded');
};`,
    },

    {
      path: path.join(struct.components, 'main', 'main.html'),
      content: `<main class="main">
  <div class="container">
    <h2>Main Content</h2>
  </div>
</main>`,
    },
    {
      path: path.join(struct.components, 'main', `main.${scssExtension}`),
      content: '.main { flex: 1 1 auto; padding: 40px 0; }',
    },
    {
      path: path.join(struct.components, 'main', 'main.ts'),
      content: `export const main = (): void => {
  console.log('Main TS Loaded');
};`,
    },

    {
      path: path.join(struct.components, 'footer', 'footer.html'),
      content: `<footer class="footer">
  <div class="container">
    <p>Footer Component</p>
  </div>
</footer>`,
    },
    {
      path: path.join(struct.components, 'footer', `footer.${scssExtension}`),
      content: '.footer { padding: 20px; background: #333; color: #fff; }',
    },
    {
      path: path.join(struct.components, 'footer', 'footer.ts'),
      content: `export const footer = (): void => {
  console.log('Footer TS Loaded');
};`,
    },
  ];

  files.forEach((file) => {
    if (!fs.existsSync(file.path)) {
      fs.writeFileSync(file.path, file.content);
    }
  });

  console.log('✅ Модульная структура на TypeScript (H-M-F) создана!');
  done();
}
