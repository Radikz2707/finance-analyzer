/**
 * Harness Start — Node-entry для фонового (серверного) режима гибридного
 * анализа: активирует диспетчер и рассылает Telegram-алерты о смене режима.
 *
 * Запуск:
 *   npm run harness            (→ node --import tsx scripts/harness-start.ts)
 *
 * Что делает:
 * 1. initHarness() из harness-bootstrap.ts (QuikGateway + AdaptiveScheduler
 *    с коллбэком PipelineCoordinator + HarnessBridge + TelegramNotifier).
 * 2. Подписка на scheduler.onModeChange(): при переходах active ↔ sleeping
 *    (и первом старте) отправляет formatSchedulerAlert через notifier.
 * 3. Keep-alive: скрипт остаётся жить (setInterval), пока не придёт
 *    SIGINT/SIGTERM — тогда подписка отписывается и scheduler.stop().
 *
 * Безопасность: без токена/отправителя алерты не отправляются (no-op),
 * скрипт продолжает работать; любые ошибки логируются, а не роняют процесс.
 */

import { initHarness } from '../src/js/modules/harness-integration/harness-bootstrap.js';
import type { AdaptiveScheduler } from '../src/js/modules/adaptive-scheduler/adaptive-scheduler.js';
import type { AdaptiveSchedulerEvent } from '../src/js/modules/adaptive-scheduler/types.js';
import type { SchedulerStatusInfo } from '../src/js/modules/harness-integration/types.js';

/** Период keep-alive-таймера: 24 часа (держит event loop живым) */
const KEEP_ALIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Собрать компактный статус диспетчера из события перехода режима.
 * Метка последнего запуска берётся из последнего снимка ресурсов
 * (fallback — timestamp события), как в HarnessBridge.getSchedulerStatus().
 */
function toSchedulerStatus(
  scheduler: AdaptiveScheduler,
  event: AdaptiveSchedulerEvent,
): SchedulerStatusInfo {
  return {
    mode: event.to,
    lastRunAt: scheduler.getLastSnapshot()?.timestamp ?? event.timestamp,
    skippedCycles: scheduler.getSkippedCycles(),
    cpuUsagePct: event.snapshot.cpuUsagePct,
    memoryUsagePct: event.snapshot.memoryUsagePct,
  };
}

/** Режимы, о которых имеет смысл уведомлять (не 'manual' — служебный) */
function isNotifiableMode(mode: AdaptiveSchedulerEvent['to']): boolean {
  return mode === 'active' || mode === 'sleeping';
}

function main(): void {
  const handle = initHarness({ autoStart: true });

  if (!handle) {
    console.error(
      '[harness-start] Диспетчер не активирован — проверьте окружение (Node, данные, Python). Завершение.',
    );
    process.exitCode = 1;
    return;
  }

  const { scheduler, notifier } = handle;
  console.log(
    `[harness-start] Гибридный диспетчер запущен (режим: ${scheduler.getMode()})`,
  );

  // Алерты о смене режима: active ↔ sleeping (первый снимок тоже придёт сюда).
  const unsubscribe = scheduler.onModeChange((event) => {
    if (!isNotifiableMode(event.to)) {
      return;
    }
    const status = toSchedulerStatus(scheduler, event);
    void notifier.sendSchedulerAlert(status).then((sent) => {
      if (sent) {
        console.log(
          `[harness-start] Алерт отправлен: режим ${event.from} → ${event.to}`,
        );
      }
    });
  });
  console.log('[harness-start] Алерты о смене режима: активны');

  // Keep-alive: скрипт живёт, пока работает диспетчер.
  const keepAlive = setInterval(() => {
    // no-op: просто удерживаем процесс от завершения
  }, KEEP_ALIVE_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[harness-start] Получен ${signal} — корректное завершение...`);

    clearInterval(keepAlive);
    unsubscribe();
    scheduler.stop();

    // Даём микро-паузу на завершение текущих задач (например, отправки).
    setTimeout(() => {
      process.exit(0);
    }, 250);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
