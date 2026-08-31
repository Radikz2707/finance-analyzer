import fs from 'fs';
import glob from 'glob';

if (!fs.existsSync('.audit')) {
  fs.mkdirSync('.audit');
}

// Используем классический метод .sync(), совместимый со всеми версиями
const files = [
  ...glob.sync('src/components/**/*.ts'),
  'gulpfile.js',
  'gulp.config.js',
  'gulp.create.js',
  'gulp.init.js',
  'gulp.module.js',
  'gulp.remove.js',
  'gulp.help.js',
  ...glob.sync('gulp/**/*.js'),
];

let result = '';

files.forEach((f) => {
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    result += `\n=== FILE: ${f} ===\n${fs.readFileSync(f, 'utf8')}\n`;
  }
});

fs.writeFileSync('.audit/audit.md', result, 'utf8');
console.log('✅ Сквозной аудит успешно сгенерирован в .audit/audit.md');
