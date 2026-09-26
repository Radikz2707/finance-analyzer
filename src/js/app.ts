/** Проверка поддержки WebP */
function isWebp(): void {
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
import { init as dashboard } from './modules/dashboard/dashboard.js';
import { dbManager } from './modules/db-manager/db-manager.js';
import { telegramBot } from './modules/telegram-bot/telegram-bot.js';
import { memoryLayer } from './modules/memory-layer/memory-layer.js';

// Инициализация компонентов
const initApp = () => {
  document.body.classList.add('_js-ready');
  isWebp();

  dashboard();
// [ДИНАМИЧЕСКИЕ МОДУЛИ]
  dbManager();
  telegramBot();
  memoryLayer();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

console.log('🚀 Radik.Dev: TypeScript успешно инициализирован');
