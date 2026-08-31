import path from 'path';

const srcFolder = 'src';
const buildFolder = 'dist';

export const config = {
  // Имя вашего нового репозитория на GitHub (поменяйте на свое при деплое)
  repoPath: 'Radikz2707/empty-template',
  siteName: 'universal-blank-site',
  siteUrl: '',
  scssExtension: 'scss',
  srcFolder,
  buildFolder,
  localServerFolder: process.env.LOCAL_SERVER_FOLDER || null,

  structure: {
    components: path.join(srcFolder, 'components'),
    modules: path.join(srcFolder, 'js', 'modules'),
    plugins: path.join(srcFolder, 'js', 'plugins'),
  },
  aliasPath: path.join(srcFolder, 'js'),
  deploy: {
    src: `${buildFolder}/**/*`, // 🎯 ИСПРАВЛЕНО: Добавлены строгие бектики
  },
  paths: {
    styles: {
      src: `${srcFolder}/scss/style.scss`, // 🎯 ИСПРАВЛЕНО
      dest: `${buildFolder}/css/`,
      output: 'app.min.css',
    },
    scripts: {
      src: `${srcFolder}/js/app.ts`, // 🎯 ИСПРАВЛЕНО
      dest: `${buildFolder}/js/`,
      output: 'app.min.js',
    },
    images: {
      src: `${srcFolder}/images/**/*`, // 🎯 ИСПРАВЛЕНО
      dest: `${buildFolder}/images/`,
      svg: `${srcFolder}/images/**/*.svg`,
    },
    favicons: {
      src: `${srcFolder}/images/src/favicon.png`, // 🎯 ИСПРАВЛЕНО
      dest: `${buildFolder}/images/favicons/`,
      htmlOutput: path.join(srcFolder, 'parts', 'favicon-links.html'),
    },
    fonts: {
      src: `${srcFolder}/fonts/src/**/*.{ttf,otf}`, // 🎯 ИСПРАВЛЕНО
      dest: `${buildFolder}/fonts/`,
    },
  },
  settings: {
    webpQuality: 70,
    imagemin: {
      jpeg: 75,
      png: 5,
    },
    autoprefixer: ['> 0.5%', 'last 2 versions', 'not dead'],
  },
};
