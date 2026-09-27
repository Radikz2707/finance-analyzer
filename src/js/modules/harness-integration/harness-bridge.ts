/**
 * HarnessBridge — агрегатор состояния для UI-интеграции.
 *
 * Собирает единый {@link HarnessDashboardPayload} из трёх источников:
 * - AdaptiveScheduler (режим, CPU/RAM, пропущенные циклы);
 * - источник аномалий (loadAnomalies — чтобы не дёргать Python каждый раз);
 * - QuikGateway (новости + активные заявки).
 *
 * Все внешние вызовы обёрнуты в try/catch: одиночный сбой источника
 * не роняет сборку payload (пострадавший раздел возвращается пустым).
 */

// ⚠️ Type-only импорты: классы используются только в сигнатурах, поэтому
// мост не тянет Node-зависимости (os/fs) в браузерный бандл.
// Логгер — browser-safe (console-бэкенд по умолчанию).
import { getLogger } from '../logger/logger.js';
import type { AdaptiveScheduler } from '../adaptive-scheduler/adaptive-scheduler.js';
import type { QuikGateway } from '../quik-gateway/quik-gateway.js';
import type { AnomalyDetectionResult } from '../python-engine/types.js';
import type {
  AnomalyBrief,
  HarnessDashboardPayload,
  QuikNewsBrief,
  SchedulerStatusInfo,
} from './types.js';

/** Сколько новостей QUIK попадает в payload */
export const MAX_QUIK_NEWS = 10;

/** Логгер модуля (браузеро-безопасен: по умолчанию console) */
const log = getLogger('harness-bridge');

/** Зависимости моста (все опциональны — для тестируемости без сети/файлов) */
export interface HarnessBridgeDeps {
  /**
   * Фасад QUIK-канала. Если не передан — QUIK-раздел payload пуст.
   * Структурный тип Pick позволяет подменять gateway в тестах.
   */
  gateway?: Pick<QuikGateway, 'isAvailable' | 'readNews' | 'readOrders'>;
  /**
   * Функция загрузки результатов детекции аномалий (результат DataAgent
   * шага 10). Если не передана — аномалии не собираются.
   */
  loadAnomalies?: () => Promise<AnomalyDetectionResult[]>;
}

/**
 * Мост между бэкендом и UI: дашборд/бот читают состояние через
 * getDashboardPayload(), а не напрямую трогают диспетчер и gateway.
 */
export class HarnessBridge {
  private scheduler: AdaptiveScheduler | null = null;
  private readonly gateway: HarnessBridgeDeps['gateway'];
  private readonly loadAnomalies: HarnessBridgeDeps['loadAnomalies'];

  constructor(deps: HarnessBridgeDeps = {}) {
    this.gateway = deps.gateway;
    this.loadAnomalies = deps.loadAnomalies;
  }

  /**
   * Зарегистрировать запущенный диспетчер для чтения режима.
   * Передача null (или повторный вызов) сбрасывает ссылку.
   */
  attachScheduler(scheduler: AdaptiveScheduler | null): void {
    this.scheduler = scheduler;
  }

  /** Текущий зарегистрированный диспетчер (null, если не передан) */
  getScheduler(): AdaptiveScheduler | null {
    return this.scheduler;
  }

  /**
   * Собрать полный payload для дашборда.
   *
   * Каждый раздел собирается независимо и безопасно:
   * ошибка одного источника не влияет на остальные.
   */
  async getDashboardPayload(): Promise<HarnessDashboardPayload> {
    const [scheduler, anomalies, quik] = await Promise.all([
      this.getSchedulerStatus(),
      this.collectAnomalies(),
      this.collectQuikData(),
    ]);

    return {
      scheduler,
      anomalies,
      quikNews: quik.news,
      activeOrdersCount: quik.activeOrdersCount,
      generatedAt: new Date().toISOString(),
    };
  }

  // ──────────────────────────────────────────────
  // Раздел 1: статус диспетчера
  // ──────────────────────────────────────────────

  private async getSchedulerStatus(): Promise<SchedulerStatusInfo | null> {
    if (!this.scheduler) {
      return null;
    }

    try {
      const snapshot = this.scheduler.getLastSnapshot();
      return {
        mode: this.scheduler.getMode(),
        // Приватный lastRunAtMs недоступен; используем метку последнего
        // снимка ресурсов как индикатор активности диспетчера.
        lastRunAt: snapshot?.timestamp ?? null,
        skippedCycles: this.scheduler.getSkippedCycles(),
        cpuUsagePct: snapshot?.cpuUsagePct ?? 0,
        memoryUsagePct: snapshot?.memoryUsagePct ?? 0,
      };
    } catch (err) {
      log.warn('Ошибка чтения статуса диспетчера:', err);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  // Раздел 2: аномалии цен
  // ──────────────────────────────────────────────

  private async collectAnomalies(): Promise<AnomalyBrief[]> {
    if (!this.loadAnomalies) {
      return [];
    }

    try {
      const results = await this.loadAnomalies();
      return results.map((result) => ({
        ticker: result.ticker,
        zScoreLast: result.zScoreLast,
        isLastAnomaly: result.isLastAnomaly,
        riskLevel: result.riskLevel,
        volatilityAnnual: result.volatilityAnnual,
      }));
    } catch (err) {
      log.warn('Ошибка загрузки аномалий:', err);
      return [];
    }
  }

  // ──────────────────────────────────────────────
  // Раздел 3: QUIK-канал (новости + заявки)
  // ──────────────────────────────────────────────

  private async collectQuikData(): Promise<{
    news: QuikNewsBrief[];
    activeOrdersCount: number;
  }> {
    if (!this.gateway) {
      return { news: [], activeOrdersCount: 0 };
    }

    try {
      const available = await this.gateway.isAvailable();
      if (!available) {
        return { news: [], activeOrdersCount: 0 };
      }

      const [records, orders] = await Promise.all([
        this.gateway.readNews(0),
        this.gateway.readOrders(),
      ]);

      const news = records.slice(0, MAX_QUIK_NEWS).map((record) => ({
        time: record.time,
        text: record.text,
        sourceName: 'QUIK',
      }));

      return { news, activeOrdersCount: orders.length };
    } catch (err) {
      log.warn('Ошибка чтения QUIK-канала:', err);
      return { news: [], activeOrdersCount: 0 };
    }
  }
}
