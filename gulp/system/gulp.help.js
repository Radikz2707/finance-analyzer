export const help = (done) => {
  const c = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
  };

  console.log(`
${c.cyan}${c.bold}==========================================
🚀  GULP + TYPESCRIPT — ШПАРГАЛКА
==========================================${c.reset}
${c.green}${c.bold}npm run dev${c.reset}          — запуск сервера и разработки
${c.green}${c.bold}npm run build${c.reset}        — финальная сборка (сжатие, ZIP)
${c.green}${c.bold}npm run lint${c.reset}         — проверка кода (TS/SCSS/HTML)
${c.green}${c.bold}npm run clean${c.reset}        — полная очистка папки dist
${c.green}${c.bold}npm run test${c.reset}         — запуск тестов (Watch режим)
${c.green}${c.bold}npm run test:run${c.reset}     — одиночный прогон тестов (CI)
${c.green}${c.bold}npm run create-post${c.reset}  — создать новую статью в блоге
${c.green}${c.bold}npm run deploy:gh${c.reset}    — деплой на GitHub Pages
${c.cyan}${c.bold}КОНСТРУКТОР КОМПОНЕНТОВ:${c.reset}${c.yellow}${c.bold}gulp create --имя${c.reset}    — создать БЛОК (HTML + SCSS + TS)
                          ${c.cyan}* для секций сайта (header, hero, services)${c.reset}

${c.yellow}${c.bold}gulp module --имя${c.reset}    — создать МОДУЛЬ (TS + SCSS)
                          ${c.cyan}* для логики и скриптов (slider, forms, tabs)${c.reset}

${c.yellow}${c.bold}gulp remove --имя${c.reset}    — УДАЛИТЬ компонент или модуль
                          ${c.cyan}* полностью вырезает все импорты и файлы${c.reset}

${c.cyan}------------------------------------------
Пути и настройки меняются в: ${c.bold}gulp.config.js${c.reset}
${c.cyan}==========================================${c.reset}
  `);
  done();
};
