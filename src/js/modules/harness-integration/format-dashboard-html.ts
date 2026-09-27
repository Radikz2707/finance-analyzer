/**
 * formatDashboardHtml — готовый HTML-фрагмент блока «🛰 Harness»
 * для вставки в веб-дашборд.
 *
 * Фрагмент самодостаточен: инлайн-стили, не зависит от SCSS проекта,
 * не требует правок сборки. Кнопка «Ручной запуск анализа» получает
 * обработчик через window.__FINANCE_HARNESS__.manualRun() (см. README).
 */

import type { HarnessDashboardPayload } from './types.js';

/** Сколько аномалий и новостей попадает в блок */
export const MAX_ANOMALIES_IN_BLOCK = 5;
export const MAX_NEWS_IN_BLOCK = 5;

/** Порог «устаревания» данных дашборда: 15 минут */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** Информация о свежести payload для отображения */
export interface FreshnessInfo {
  /** Человекочитаемая метка: «обновлено N мин назад» / «только что» */
  label: string;
  /** true, если данные старше STALE_AFTER_MS или время неизвестно */
  isStale: boolean;
}

/**
 * Посчитать свежесть payload по generatedAt.
 * @param generatedAt — ISO-метка генерации payload
 * @param nowMs — текущее время (инъекция для детерминированных тестов)
 */
export function formatFreshness(
  generatedAt: string,
  nowMs: number = Date.now(),
): FreshnessInfo {
  const generatedMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedMs)) {
    // Время неизвестно: данные нельзя считать свежими
    return { label: 'время недоступно', isStale: true };
  }
  const ageMs = Math.max(0, nowMs - generatedMs);
  const ageMin = Math.floor(ageMs / 60_000);

  let label: string;
  if (ageMin < 1) {
    label = 'только что';
  } else if (ageMin < 60) {
    label = `обновлено ${ageMin} мин назад`;
  } else if (ageMin < 1440) {
    const hours = Math.floor(ageMin / 60);
    const minutes = ageMin % 60;
    label =
      minutes > 0
        ? `обновлено ${hours} ч ${minutes} мин назад`
        : `обновлено ${hours} ч назад`;
  } else {
    const days = Math.floor(ageMin / 1440);
    label = `обновлено ${days} д назад`;
  }

  return { label, isStale: ageMs > STALE_AFTER_MS };
}

const MODE_LABEL: Record<string, string> = {
  active: '🟢 активен',
  sleeping: '😴 спит',
  manual: '✋ ручной',
};

const RISK_LABEL: Record<string, string> = {
  low: '🟢 низкий',
  medium: '🟡 средний',
  high: '🔴 высокий',
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');

/**
 * Собрать HTML-фрагмент блока «🛰 Harness» из payload.
 * @param payload — результат HarnessBridge.getDashboardPayload()
 */
export function formatDashboardHtml(payload: HarnessDashboardPayload): string {
  const scheduler = payload.scheduler;
  const hasScheduler = scheduler !== null;

  // ── Статус диспетчера ─────────────────────────
  const modeText = scheduler
    ? (MODE_LABEL[scheduler.mode] ?? scheduler.mode)
    : 'не запущен';
  const lastRunText = scheduler?.lastRunAt
    ? new Date(scheduler.lastRunAt).toLocaleString('ru-RU')
    : '—';
  const resourceText = scheduler
    ? `CPU ${scheduler.cpuUsagePct}% · RAM ${scheduler.memoryUsagePct}% · пропущено циклов: ${scheduler.skippedCycles}`
    : '—';

  // ── Аномалии ──────────────────────────────────
  const anomaliesRows =
    payload.anomalies.length === 0
      ? '<div class="h-item h-muted">Аномалий не обнаружено</div>'
      : payload.anomalies
          .slice(0, MAX_ANOMALIES_IN_BLOCK)
          .map((a) => {
            const lastFlag = a.isLastAnomaly ? ' ⚠️' : '';
            const anomalyClass = a.isLastAnomaly
              ? ' h-anomaly h-anomaly--danger'
              : ' h-anomaly';
            return (
              `<div class="h-item${anomalyClass}">` +
              `<span class="h-ticker">${escapeHtml(a.ticker)}</span>${lastFlag}` +
              ` — z=${a.zScoreLast.toFixed(2)}, риск ${RISK_LABEL[a.riskLevel] ?? a.riskLevel}` +
              `, вол ${a.volatilityAnnual.toFixed(1)}%` +
              '</div>'
            );
          })
          .join('');

  // ── Новости QUIK ──────────────────────────────
  const newsRows =
    payload.quikNews.length === 0
      ? '<div class="h-item h-muted">Новостей QUIK нет</div>'
      : payload.quikNews
          .slice(0, MAX_NEWS_IN_BLOCK)
          .map((n) => {
            const text =
              n.text.length > 120 ? `${n.text.slice(0, 120)}…` : n.text;
            return (
              '<div class="h-item h-news">' +
              `<span class="h-news-time">${escapeHtml(n.time)}</span> ` +
              `<span class="h-news-text">${escapeHtml(text)}</span>` +
              '</div>'
            );
          })
          .join('');

  const buttonDisabled = hasScheduler ? '' : ' disabled';
  const ordersText = payload.activeOrdersCount.toString();

  // Свежесть данных: «обновлено N мин назад» + класс h-fresh/h-stale
  const freshness = formatFreshness(payload.generatedAt);
  const freshnessClass = freshness.isStale ? 'h-stale' : 'h-fresh';

  return (
    `<section class="harness-block ${freshnessClass}" style="` +
    'border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0;' +
    'font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
    'background:#f8fafc;color:#0f172a;">' +
    '<h3 style="margin:0 0 12px;font-size:16px;">🛰 Harness — фоновый анализ</h3>' +
    `<div class="h-freshness ${freshnessClass} h-muted">${escapeHtml(freshness.label)}</div>` +
    // Статус диспетчера
    '<div class="h-section" style="margin-bottom:12px;">' +
    '<strong>Диспетчер:</strong> ' +
    `<span class="h-mode h-mode--${scheduler?.mode ?? 'manual'}">${escapeHtml(modeText)}</span>` +
    `<div class="h-item h-muted">Последний запуск: ${escapeHtml(lastRunText)}</div>` +
    `<div class="h-item h-muted">${escapeHtml(resourceText)}</div>` +
    '</div>' +
    // Аномалии
    '<div class="h-section" style="margin-bottom:12px;">' +
    '<strong>Аномалии:</strong>' +
    anomaliesRows +
    '</div>' +
    // Новости QUIK + заявки
    '<div class="h-section" style="margin-bottom:12px;">' +
    `<strong>Новости QUIK:</strong> <span class="h-muted">(активных заявок: ${ordersText})</span>` +
    newsRows +
    '</div>' +
    // Кнопка ручного запуска
    '<button id="harnessManualRun" class="harness-run" data-harness-run' +
    ` type="button"${buttonDisabled} style="` +
    'margin-top:4px;padding:8px 16px;border:none;border-radius:8px;' +
    'background:#2563eb;color:#fff;cursor:pointer;font-size:14px;' +
    (hasScheduler ? '' : 'opacity:.5;') +
    '">🚀 Ручной запуск анализа</button>' +
    '</section>'
  );
}
