// gulp/seo.js — Абсолютный контроль поисковой оптимизации и карт контента
import { config } from '../gulp.config.js';
import gulp from 'gulp';
import sitemap from 'gulp-sitemap';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import plumber from 'gulp-plumber';
import { onError } from './server.js';
import { getFirstLineOfFile } from './utils/content-processor.js';

dotenv.config();
const { src, dest } = gulp;

/**
 * 🌐 1. Автоматический генератор sitemap.xml на основе собранного HTML
 */
export const generateSitemap = () => {
  const siteUrl = process.env.SITE_URL || 'https://radik.dev';

  return src(`${config.buildFolder}/**/*.html`, {
    read: false,
    allowEmpty: true,
  })
    .pipe(plumber({ errorHandler: onError }))
    .pipe(
      sitemap({
        siteUrl: siteUrl,
        changefreq: 'weekly',
        priority: 0.7,
        mappings: [
          { pages: ['index.html'], priority: 1.0, changefreq: 'daily' },
          { pages: ['blog/index.html'], priority: 0.9, changefreq: 'daily' },
        ],
      }),
    )
    .pipe(dest(config.buildFolder));
};
generateSitemap.displayName = 'seo:sitemap';

/**
 * 📑 2. Кастомный генератор карт контента (content-map.json) без использования through2
 */
export const generateContentMap = async (done) => {
  const contentMap = [];
  const contentRoot = path.join(config.srcFolder, 'content');
  const destDir = config.buildFolder;

  // Безопасный Guard Clause
  if (!fs.existsSync(contentRoot)) {
    console.warn('⚠️ [CONTROL SEO]: Исходная папка контента не найдена.');
    return done();
  }

  try {
    // Рекурсивный обход директории исходников через нативный Node.js fs
    const scanDirectory = async (dir) => {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          await scanDirectory(fullPath); // Рекурсивный спуск в подпапки
        } else if (
          stat.isFile() &&
          path.extname(item).toLowerCase() === '.md'
        ) {
          const fileName = path.basename(item, '.md');

          // Игнорируем индексы и временные файлы Windows / Word
          if (
            fileName.toLowerCase() === 'index' ||
            fileName.startsWith('.') ||
            fileName.startsWith('~$')
          ) {
            continue;
          }

          const relativePath = path.relative(contentRoot, fullPath);
          const category = path.dirname(relativePath).replace(/\\/g, '/');

          // Извлекаем первую строчку-заголовок статьи
          let articleTitle = '';
          try {
            articleTitle = await getFirstLineOfFile(fullPath);
          } catch {
            // Мягкий фолбэк, если файл занят
          }

          if (!articleTitle) {
            articleTitle = fileName.replace(/-/g, ' ');
            articleTitle =
              articleTitle.charAt(0).toUpperCase() + articleTitle.slice(1);
          }

          const articleUrl = `/blog/${category}/${fileName}.html`;

          contentMap.push({
            title: articleTitle,
            url: articleUrl,
            category: category,
            modified: stat.mtime || new Date().toISOString(),
          });
        }
      }
    };

    // Запускаем нативное сканирование
    await scanDirectory(contentRoot);

    // Гарантируем наличие папки dist перед записью JSON
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const destPath = path.join(destDir, 'content-map.json');
    fs.writeFileSync(destPath, JSON.stringify(contentMap, null, 2), 'utf-8');

    console.log('✅ Карта контента content-map.json успешно обновлена в dist/');
    done(); // Намертво закрываем таску Gulp
  } catch (err) {
    console.error(
      '🔴 [CONTROL SEO ERROR] Фатальный сбой сборки карты контента!',
    );
    onError(err);
    done(err);
  }
};
generateContentMap.displayName = 'seo:content-map';
