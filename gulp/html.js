import { config } from '../gulp.config.js';
import gulp from 'gulp';
import plumber from 'gulp-plumber';
import fileInclude from 'gulp-file-include';
import htmlhint from 'gulp-htmlhint';
import htmlBeautify from 'gulp-html-beautify';
import replace from 'gulp-replace';
import { onError, isProd } from './server.js';
import { Transform } from 'stream';
import { getBuildSignature } from './system/gulp.cache.js';

const { src, dest } = gulp;

// Оптимизатор относительных путей ассетов
function fixHtmlPaths() {
  return new Transform({
    objectMode: true,
    transform(file, enc, cb) {
      if (file.isNull() || !file.isBuffer()) return cb(null, file);

      const repoName = config.repoPath ? config.repoPath.split('/') : 'portfolio';
      const pathPrefix = isProd ? `/${repoName}` : './';
      let content = file.contents.toString('utf-8');

      const addPrefix = (match, p1, p2) => {
        const cleanP2 = p2.replace(/^[.\\/]+/, '');
        if (cleanP2.startsWith(pathPrefix) || (pathPrefix === './' && cleanP2.startsWith('/'))) {
          return match;
        }
        return `${p1}${pathPrefix}${cleanP2}`;
      };

      content = content.replace(/(href=["']\s*)(\.?\/?css\/[^"']+\.(?:css))/gi, addPrefix);
      content = content.replace(/(src=["']\s*)(\.?\/?js\/[^"']+\.(?:js)(?:\?[^"']*)?)/gi, (match, p1, p2) => {
        const hasVersion = p2.includes('?v=');
        const version = isProd && !hasVersion ? `?v=${getBuildSignature()}` : '';
        return addPrefix(match, p1, p2 + version);
      });
      content = content.replace(/((?:src|srcset)=["']\s*)(\.?\/?images\/[^"']+\.(?:png|jpg|jpeg|webp|svg|gif|ico))/gi, addPrefix);
      content = content.replace(/(href=["']\s*)(\.?\/?fonts\/[^"']+\.(?:woff2|woff|ttf|otf|eot))/gi, addPrefix);
      content = content.replace(/(href=["']\s*)(\.?\/?images\/favicons\/[^"']+\.(?:png|ico|svg|xml|json|webmanifest))/gi, addPrefix);

      file.contents = Buffer.from(content);
      cb(null, file);
    },
  });
}

// Автогенератор картинок <picture> со слоем WebP
const fixPictureTags = () => {
  return new Transform({
    objectMode: true,
    transform(file, encoding, callback) {
      if (file.isBuffer()) {
        let htmlContent = file.contents.toString('utf-8');
        htmlContent = htmlContent.replace(/<img\s+([^>]*?)src="([^"]+?)"([^>]*?)>/gi, (match, before, srcPath, after) => {
          const allAttributes = `${before} ${after}`;
          if (allAttributes.includes('data-ignore') || allAttributes.includes('img-ignore')) return match;

          const webpPath = srcPath.replace(/\.(?:png|jpg|jpeg)$/i, '.webp');
          const cleanAttributes = `${before.trim()} ${after.trim()}`.trim();
          return `<picture>\n <source srcset="${webpPath}" type="image/webp">\n <img src="${srcPath}"${cleanAttributes ? ' ' + cleanAttributes : ''}>\n</picture>`;
        });
        file.contents = Buffer.from(htmlContent, 'utf-8');
      }
      callback(null, file);
    },
  });
};

// Главная задача сборки HTML
export function html() {
  const pipeline = [
    src([
      `${config.srcFolder}/*.html`,
      `!${config.srcFolder}/components/**/*.html`,
      `!${config.srcFolder}/parts/**/*.html`,
    ]),
    plumber({ errorHandler: onError }),
    fileInclude({ prefix: '@@', basepath: 'src', filters: {}, indent: true }),
    replace(/SITE_NAME/gi, config.siteName),
    replace(/SITE_AUTHOR/gi, config.repoPath),
    replace(/js\/app\.min\.js/gi, `js/app.min.js?v=${getBuildSignature()}`),
  ];

  if (isProd) pipeline.push(fixPictureTags());

  pipeline.push(
    htmlBeautify({
      indent_size: 2,
      indent_char: ' ',
      eol: '\n',
      preserve_newlines: true,
      max_preserve_newlines: 1,
      indent_inner_html: true,
      extra_liners: [],
    })
  );

  pipeline.push(fixHtmlPaths());

  pipeline.push(
    htmlhint({
      'doctype-first': false,
      'tagname-lowercase': true,
      'attr-lowercase': true,
      'attr-value-double-quotes': true,
      'attr-no-duplication': true,
      'id-unique': true,
      'src-not-empty': true,
      'alt-require': true,
      'img-alt-require': true,
      'tag-pair': true,
      'spec-char-escape': true,
    })
  );

  pipeline.push(htmlhint.reporter('htmlhint-stylish', { failReporter: false }));

  return pipeline
    .reduce((stream, plugin) => stream.pipe(plugin))
    .pipe(dest(config.buildFolder));
}
