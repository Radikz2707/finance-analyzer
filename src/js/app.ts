/** Проверка поддержки WebP */
function isWebP(): void {
  function testWebP(callback: (support: boolean) => void): void {
    const webP = new Image();
    webP.onload = webP.onerror = function (): void {
      callback(webP.height === 2);
    };
    webP.src =
      'data:image/webp;base64,UklGRjoAAABXRUJQVlA4IC4AAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6WWgAA/veff/0PP8bA//LwYAAA';
  }

  testWebP(function (support: boolean): void {
    const className = support === true ? 'webp' : 'no-webp';
    document.documentElement.classList.add(className);
  });
}

// ==========================================
// 📦 ВНЕШНИЕ БИБЛИОТЕКИ И СИСТЕМНЫЕ МОДУЛИ
// ==========================================
import { dbManager } from './modules/db-manager/db-manager.js';
import { memoryLayer } from './modules/memory-layer/memory-layer.js';
import { initDirectorChat } from './modules/pipeline/director/director-init.js';

// ──────────────────────────────────────────────
// 🧠 Director Agent — интеграция чата
// ──────────────────────────────────────────────

/**
 * Инициализация приложения.
 * Загружает все модули и инициализирует Director Chat.
 */
const initApp = () => {
  document.body.classList.add('_js-ready');
  isWebP();

  // [ДИНАМИЧЕСКИЕ МОДУЛИ]
  dbManager();
  // Telegram-бот загружается лениво (Node-контур): модуль не должен попадать
  // в браузерный бандл и в строгую tsc-проверку (см. tsconfig exclude).
  void importTelegramBot();
  memoryLayer();

  // 🧠 Director: чат-интерфейс с инвестиционным координатором
  initDirectorChat();
};

/** Ленивая загрузка Telegram-бота (асинхронно, ошибки не роняют приложение) */
async function importTelegramBot(): Promise<void> {
  try {
    const spec = './modules/telegram-bot/telegram-bot.js';
    const bot = await import(/* webpackIgnore: true */ spec);
    bot.telegramBot();
  } catch {
    // Модуль недоступен в текущем окружении — приложение продолжает работу
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

console.log('🚀 Finance Analyzer: TypeScript успешно инициирован');
