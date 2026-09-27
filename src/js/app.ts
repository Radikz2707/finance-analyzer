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
import { memoryLayer } from './modules/memory-layer/memory-layer.js';

// 🛰 HARNESS INTEGRATION — гибридный фоновый анализ.
// В браузерный бандл попадают ТОЛЬКО лёгкие классы (type-only импорты
// Node-классов); Node-зависимая сборка (os/fs/child_process) загружается
// динамически через harness-bootstrap при наличии Node-рантайма.
import { HarnessBridge } from './modules/harness-integration/harness-bridge.js';
import { mountDashboardBlock } from './modules/harness-integration/mount-dashboard-block.js';
import type { AdaptiveScheduler } from './modules/adaptive-scheduler/adaptive-scheduler.js';
import type { TelegramNotifier } from './modules/harness-integration/telegram-notifier.js';
import type { HarnessDashboardPayload } from './modules/harness-integration/types.js';

// ──────────────────────────────────────────────
// 🛰 Harness: состояние подсистемы (синглтоны)
// ──────────────────────────────────────────────

/** Диспетчер фонового анализа (null, если активация не удалась) */
let harnessScheduler: AdaptiveScheduler | null = null;

/** Мост состояния для дашборда/бота */
let harnessBridge: HarnessBridge | null = null;

/** Адаптер Telegram-уведомлений (отправитель регистрируется внешне) */
let telegramNotifier: TelegramNotifier | null = null;

/** Публичное API для дашборда (window.__FINANCE_HARNESS__) */
interface HarnessWindowApi {
  /** Получить текущий payload для рендеринга блока «🛰 Harness» */
  getPayload(): Promise<HarnessDashboardPayload | null>;
  /** Ручной запуск фонового анализа (кнопка дашборда) */
  manualRun(): Promise<void>;
  /** Адаптер уведомлений (для регистрации отправителя извне) */
  notifier: TelegramNotifier | null;
}

/**
 * Активация гибридного фонового анализа.
 *
 * Диспетчер зависит от Node-API (os, fs, child_process, Python-мост),
 * поэтому в браузере активация — no-op, а приложение работает как раньше.
 * В Node-среде bootstrap загружается динамически; все его сбои (нет
 * данных, выключена Ollama и т.п.) перехватываются try/catch.
 */
function initHarness(): void {
  // Мост для дашборда доступен всегда: в браузерном режиме payload
  // будет со scheduler: null (диспетчер не запущен).
  if (typeof window !== 'undefined') {
    const api: HarnessWindowApi = {
      getPayload: async () => harnessBridge?.getDashboardPayload() ?? null,
      manualRun: async () => {
        if (harnessScheduler) {
          await harnessScheduler.manualRun();
        }
      },
      notifier: telegramNotifier,
    };
    (
      window as unknown as {
        __FINANCE_HARNESS__?: HarnessWindowApi;
      }
    ).__FINANCE_HARNESS__ = api;
  }

  // Браузер не имеет Node API — фоновый анализ невозможен.
  const isNode =
    typeof process !== 'undefined' &&
    typeof (process as { versions?: { node?: string } }).versions?.node ===
      'string';
  if (!isNode) {
    return;
  }

  void (async () => {
    try {
      const spec = './modules/harness-integration/harness-bootstrap.js';
      const bootstrap = await import(/* webpackIgnore: true */ spec);
      const handle = bootstrap.initHarness();
      if (!handle) {
        return;
      }
      harnessBridge = handle.bridge;
      harnessScheduler = handle.scheduler;
      telegramNotifier = handle.notifier;
    } catch (err) {
      console.warn(
        '[Harness] Диспетчер не активирован (приложение продолжает работу):',
        err,
      );
    }
  })();
}

// Инициализация компонентов
const initApp = () => {
  document.body.classList.add('_js-ready');
  isWebp();

  dashboard();
  // [ДИНАМИЧЕСКИЕ МОДУЛИ]
  dbManager();
  // Telegram-бот загружается лениво (Node-контур): модуль не должен попадать
  // в браузерный бандл и в строгую tsc-проверку (см. tsconfig exclude).
  void importTelegramBot();
  memoryLayer();

  // 🛰 Harness: фоновый анализ стартует независимо от остальных модулей
  initHarness();

  // Рендер блока «🛰 Harness»: контейнер #harnessBlock (если есть),
  // автобновление каждые 60 с. Без контейнера/API — тихий no-op.
  mountDashboardBlock('#harnessBlock');
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

console.log('🚀 Radik.Dev: TypeScript успешно инициализирован');
