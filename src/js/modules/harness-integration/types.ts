/**
 * Harness Integration — типы для UI-интеграции гибридного диспетчера,
 * QUIK-канала и Telegram-уведомлений.
 *
 * Модуль агрегирует состояние трёх подсистем:
 * - AdaptiveScheduler (режим, нагрузка CPU/RAM, пропущенные циклы);
 * - Python Engine / DataAgent (аномалии цен);
 * - QuikGateway (новости и активные заявки из терминала QUIK).
 *
 * Модуль не зависит от telegram-bot напрямую: отправка выполняется через
 * внешний отправитель {@link TelegramSender}, который регистрируется
 * методом TelegramNotifier.attach().
 */

/** Режим гибридного диспетчера */
export type SchedulerMode = 'active' | 'sleeping' | 'manual';

/** Компактный статус диспетчера для дашборда/бота */
export interface SchedulerStatusInfo {
  /** Текущий режим: active / sleeping / manual */
  mode: SchedulerMode;
  /** Время последнего запуска анализа (ISO) или null, если ещё не было */
  lastRunAt: string | null;
  /** Количество пропущенных циклов «сна» */
  skippedCycles: number;
  /** Загрузка CPU, % (0..100) */
  cpuUsagePct: number;
  /** Занятость оперативной памяти, % (0..100) */
  memoryUsagePct: number;
}

/** Краткая новость QUIK для ленты дашборда */
export interface QuikNewsBrief {
  /** Время в формате ISO: "ГГГГ-ММ-ДДTЧЧ:ММ:СС" */
  time: string;
  /** Текст новости */
  text: string;
  /** Источник (например, "QUIK") */
  sourceName: string;
}

/** Краткое описание аномалии цены для дашборда/бота */
export interface AnomalyBrief {
  /** Код инструмента */
  ticker: string;
  /** Z-score последней точки */
  zScoreLast: number;
  /** Является ли последняя точка аномалией */
  isLastAnomaly: boolean;
  /** Уровень риска: low / medium / high */
  riskLevel: 'low' | 'medium' | 'high';
  /** Годовая волатильность, % */
  volatilityAnnual: number;
}

/** Полный payload для дашборда: статус + аномалии + QUIK */
export interface HarnessDashboardPayload {
  /** Статус диспетчера (null, если диспетчер не зарегистрирован) */
  scheduler: SchedulerStatusInfo | null;
  /** Аномалии цен (обычно топ по |z|) */
  anomalies: AnomalyBrief[];
  /** Последние новости QUIK (до ~10) */
  quikNews: QuikNewsBrief[];
  /** Количество активных заявок QUIK */
  activeOrdersCount: number;
  /** Метка времени генерации payload (ISO 8601) */
  generatedAt: string;
}

/** Итог фонового/ручного анализа (для UI-ленты диспетчера) */
export interface HarnessRunOutcome {
  ok: boolean;
  summary: string;
}

/**
 * Внешний отправитель Telegram-сообщений.
 *
 * Реализация живёт вне этого модуля (например, в telegram-bot или любом
 * другом адаптере) и регистрируется через TelegramNotifier.attach().
 * Возвращает true при успешной отправке.
 */
export interface TelegramSender {
  sendMessage(text: string): Promise<boolean>;
}
