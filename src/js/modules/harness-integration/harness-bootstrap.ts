/**
 * Harness Bootstrap — Node-only фабрика гибридного фонового анализа.
 *
 * Этот модуль ТЯНЕТ Node-зависимости (os, fs, child_process) и поэтому
 * НЕ должен попадать в браузерный бандл: из app.ts он загружается
 * динамически (import с пометкой webpackIgnore) и только при наличии
 * Node-рантайма.
 *
 * Отсюда диспетчер реально запускается:
 * - фронтенд под Node/SSR: app.ts → initHarness();
 * - CLI/скрипты: import { initHarness } from '.../harness-bootstrap.js'.
 *
 * Все компоненты обёрнуты в try/catch: падение любого элемента (нет
 * данных, выключена Ollama, недоступен Python) не роняет приложение.
 */

import { getLogger, initFileLogging } from '../logger/index.js';
import { AdaptiveScheduler } from '../adaptive-scheduler/adaptive-scheduler.js';
import { PipelineCoordinator } from '../pipeline/pipeline-coordinator.js';
import { QuikGateway } from '../quik-gateway/quik-gateway.js';
import { aiMemoryImpl } from '../pipeline/ai-memory/index.js';
import { savePortfolioKpi } from '../pipeline/ai-memory/kpi-sink.js';
import { createAnomalySource } from './anomaly-source.js';
import { HarnessBridge } from './harness-bridge.js';
import { TelegramNotifier } from './telegram-notifier.js';
import { TelegramHttpSender } from './telegram-http-sender.js';
import { PriceAlertNotifier } from './price-alert-notifier.js';
import type { HarnessDashboardPayload } from './types.js';
import { validateEnv } from '../../config/index.js';
import { createActionAgentFactory } from '../pipeline/agents/agent-factory.js';
import { SecurityAgent } from '../pipeline/agents/security-agent.js';
import { DirectorAgent } from '../pipeline/director/director.js';
import { DirectorAgentFacade } from '../pipeline/director/agent-facade.js';
import type { DirectorConfig } from '../pipeline/director/director-types.js';

/** Логгер подсистемы Harness */
const log = getLogger('harness');

/** Собранный комплект подсистемы */
export interface HarnessHandle {
  /** Мост состояния для дашборда/бота */
  bridge: HarnessBridge;
  /** Гибридный диспетчер (уже запущен) */
  scheduler: AdaptiveScheduler;
  /** Адаптер Telegram-уведомлений */
  notifier: TelegramNotifier;
  /** Уведомитель ценовых алертов (провайдер можно задать через setProvider) */
  priceAlertNotifier: PriceAlertNotifier;
}

/** Публичное API для дашборда (window.__FINANCE_HARNESS__) */
export interface HarnessWindowApi {
  /** Получить текущий payload для рендеринга блока «🛰 Harness» */
  getPayload(): Promise<HarnessDashboardPayload>;
  /** Ручной запуск фонового анализа (кнопка дашборда) */
  manualRun(): Promise<void>;
  /** Адаптер уведомлений (для регистрации отправителя извне) */
  notifier: TelegramNotifier;
}

/** Конфигурация сборки */
export interface HarnessBootstrapConfig {
  /** Интервал опроса ресурсов, мс (по умолчанию 60 000) */
  pollIntervalMs?: number;
  /** Минимальная пауза между запусками задачи, мс (по умолчанию 300 000) */
  minRunIntervalMs?: number;
  /** Начинать наблюдение сразу после создания (по умолчанию true) */
  autoStart?: boolean;
  /** Интервал проверки ценовых алертов, мс (по умолчанию 60 000) */
  priceAlertIntervalMs?: number;
}

/**
 * Собрать и запустить подсистему (без try/catch — обёртки снаружи).
 */
export function createHarness(
  config: HarnessBootstrapConfig = {},
): HarnessHandle {
  // Мягкая валидация окружения: в SSR/браузер-под-Node отсутствие ключей не
  // фатально (везде fallback-режимы). Жёсткую проверку с понятной ошибкой
  // делает assertEnvValid() в CLI-входах (scripts/harness-start.ts).
  if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
    const validation = validateEnv();
    if (!validation.ok) {
      log.warn(
        `Конфигурация окружения неполная (${validation.errors.length} ошиб.): ${validation.errors
          .map((issue) => issue.key)
          .join(', ')} — работа в fallback-режиме.`,
      );
    }
  }

  // Опциональная файловая запись логов (Node-only): LOG_TO_FILE=1 → data/logs/app.log
  if (
    typeof process !== 'undefined' &&
    process.env.LOG_TO_FILE &&
    process.env.LOG_TO_FILE !== '0'
  ) {
    void initFileLogging().catch(() => {
      // Несмертельно: без файлового бэкенда останется console
    });
  }

  const gateway = new QuikGateway();

  // Живые аномалии (z-score) для дашборда: источник повторяет «Шаг 10»
  // DataAgent; при недоступности данных/сети/Python вернёт [] без падения.
  const anomalySource = createAnomalySource();

  const bridge = new HarnessBridge({
    gateway,
    loadAnomalies: () => anomalySource.load(),
  });
  const notifier = new TelegramNotifier();

  // Реальный Telegram-отправитель: регистрируется только при полной
  // конфигурации (токен + chatId из process.env/.env).
  const telegramSender = new TelegramHttpSender();
  if (telegramSender.isConfigured()) {
    notifier.attach(telegramSender);
    log.info('Telegram подключён');
  } else {
    log.info('Telegram не настроен (нет токена/chatId)');
  }

  // Коллбэк фонового анализа: обёртка над PipelineCoordinator.
  // Данные могут отсутствовать, Ollama может быть выключена —
  // pipeline НЕ должен ронять приложение.
  const runPipelineTask = async (): Promise<void> => {
    try {
      log.info('Запуск фонового анализа...');
      const coordinator = new PipelineCoordinator(undefined, {
        // Авто-архивация KPI в стратегическую память после успешного run()
        memorySink: async (result) => {
          await savePortfolioKpi(aiMemoryImpl, result);
        },
      });
      await coordinator.run();
      log.info('Фоновый анализ завершён');
    } catch (err) {
      log.error('Ошибка фонового анализа:', err);
    }
  };

  const scheduler = new AdaptiveScheduler(runPipelineTask, {
    pollIntervalMs: config.pollIntervalMs ?? 60_000,
    minRunIntervalMs: config.minRunIntervalMs ?? 300_000,
  });
  bridge.attachScheduler(scheduler);

  if (config.autoStart !== false) {
    scheduler.start();
  }

  // Ценовые алерты → Telegram: отдельный интервал (Node-only, по умолчанию 60с).
  // Провайдер алертов регистрируется извне через priceAlertNotifier.setProvider();
  // без провайдера checkAndNotify() возвращает 0 (безопасный no-op).
  const priceAlertNotifier = new PriceAlertNotifier(notifier);
  if (typeof setInterval === 'function') {
    const alertTimer = setInterval(() => {
      priceAlertNotifier.checkAndNotify().catch((err) => {
        log.warn('Ошибка проверки ценовых алертов:', err);
      });
    }, config.priceAlertIntervalMs ?? 60_000);
    // Не удерживаем процесс Node в тестах/скриптах
    alertTimer.unref?.();
  }

  return { bridge, scheduler, notifier, priceAlertNotifier };
}

/**
 * Собрать DirectorAgent для Node-контура (CLI/SSR/harness).
 *
 * Подключает action-агентов (File/Terminal) через фабрику и прогоняет их
 * через SecurityAgent. В браузерной сборке эти операции недоступны:
 * фасад без actionAgents честно отвечает «доступно в десктопном режиме».
 */
export function createNodeDirector(config?: DirectorConfig): DirectorAgent {
  const registry = createActionAgentFactory();
  const security = new SecurityAgent();
  const facade = new DirectorAgentFacade({
    actionAgents: registry.createDefaultActionAgents(),
    // Адаптер к единому контракту `check` фасада (validate — синхронный)
    security: { check: (request) => security.validate(request) },
  });
  return new DirectorAgent({ facade }, config);
}

/**
 * Инициализация подсистемы с защитой от падений.
 *
 * При успехе вешает window.__FINANCE_HARNESS__ (если есть window),
 * возвращает собранный handle. При любой ошибке возвращает null —
 * приложение продолжает работать без фонового анализа.
 */
export function initHarness(
  config: HarnessBootstrapConfig = {},
): HarnessHandle | null {
  try {
    const handle = createHarness(config);

    // Мост для дашборда: блок «🛰 Harness» читает состояние и
    // вызывает manualRun() через window.__FINANCE_HARNESS__.
    if (typeof window !== 'undefined') {
      const api: HarnessWindowApi = {
        getPayload: async () => handle.bridge.getDashboardPayload(),
        manualRun: async () => {
          await handle.scheduler.manualRun();
        },
        notifier: handle.notifier,
      };
      (
        window as unknown as {
          __FINANCE_HARNESS__?: HarnessWindowApi;
        }
      ).__FINANCE_HARNESS__ = api;
    }

    log.info('Гибридный диспетчер активирован');
    return handle;
  } catch (err) {
    log.warn('Диспетчер не активирован (приложение продолжает работу):', err);
    return null;
  }
}
