export const help = (done) => {
  const c = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
  };

  console.log(`
${c.cyan}${c.bold}==========================================
🚀  GULP + TYPESCRIPT — ШПАРГАЛКА
==========================================${c.reset}

${c.green}${c.bold}БАЗОВЫЕ КОМАНДЫ:${c.reset}
${c.green}${c.bold}npm run dev${c.reset}          — запуск dev-сервера
${c.green}${c.bold}npm run build${c.reset}        — тесты + продакшен-сборка (ZIP)
${c.green}${c.bold}npm run lint${c.reset}         — stylelint + eslint + tsc
${c.green}${c.bold}npm run clean${c.reset}        — полная очистка папки dist
${c.green}${c.bold}npm run test${c.reset}         — vitest (watch режим)
${c.green}${c.bold}npm run test:run${c.reset}     — vitest (одиночный прогон, CI)

${c.green}${c.bold}КОНСТРУКТОРЫ РЕСУРСОВ:${c.reset}${c.dim} (создание/удаление — ТОЛЬКО через них)${c.reset}
${c.yellow}${c.bold}npm run init${c.reset}        — развернуть базовую структуру (H-M-F)
${c.yellow}${c.bold}npm run create -- --имя${c.reset}  — создать БЛОК (HTML + SCSS + TS)
${c.yellow}${c.bold}npm run module -- --имя${c.reset}  — создать МОДУЛЬ (TS + SCSS)
${c.yellow}${c.bold}npm run plugin -- --имя${c.reset}  — создать ПЛАГИН
${c.yellow}${c.bold}npm run remove -- --имя${c.reset}  — УДАЛИТЬ ресурс (вырезает импорты)
${c.yellow}${c.bold}   ... --force${c.reset}           — удалить «рабочий код» принудительно

${c.cyan}${c.bold}ПРАВИЛА БЕЗОПАСНОСТИ:${c.reset}
${c.red}•${c.reset} Имена ресурсов: латиница/цифры/дефис (${c.bold}my-block-2${c.reset}).
${c.red}•${c.reset} Системные имена защищены: app, index, main, types, config,
  gulp, src, dist, data, python и др. — удаление запрещено.
${c.red}•${c.reset} Каталоги с рабочим кодом удаляются только с ${c.bold}--force${c.reset}.
${c.red}•${c.reset} HTML-инклуд подключается вручную: ${c.bold}@@include('components/<имя>/<имя>.html')${c.reset}

${c.green}${c.bold}АНАЛИТИКА И АВТОМАТИЗАЦИЯ:${c.reset}
${c.green}${c.bold}npm run audit${c.reset}        — сквозной аудит кода (.audit/audit.md)
${c.green}${c.bold}npm run blueprint${c.reset}    — схема структуры проекта
${c.green}${c.bold}npm run watch${c.reset}        — слежение за изменениями (TS)
${c.green}${c.bold}npm run pipeline${c.reset}     — запуск пайплайна анализа
${c.green}${c.bold}npm run harness${c.reset}      — запуск harness-моста

${c.green}${c.bold}GIT:${c.reset}
${c.green}${c.bold}npm run push${c.reset}         — commit + push в текущую ветку

${c.cyan}------------------------------------------
Пути и настройки: ${c.bold}gulp.config.js${c.reset}
Полный список скриптов: ${c.bold}package.json → "scripts"${c.reset}
${c.cyan}==========================================${c.reset}
  `);
  done();
};
