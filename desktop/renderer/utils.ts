/**
 * Утилиты для рендера отчётов в desktop-приложении.
 *
 * Чистые функции без зависимостей от DOM — могут тестироваться в Node.
 */

import type { LastAnalysisInfo } from '../api-types.js';
import type { DirectorAuditEvent } from '../../src/js/modules/pipeline/director/director-types.js';

// ──────────────────────────────────────────────
// escapeHtmlReport
// ──────────────────────────────────────────────

/** Экранирование HTML в данных отчёта */
export function escapeHtmlReport(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ──────────────────────────────────────────────
// renderAnalysisReport
// ──────────────────────────────────────────────

/**
 * Богатый отчёт на вкладке «Анализ» (в стиле старого report.html):
 * карточки-показатели + таблица активов + ценовые алерты.
 * Текстовая сводка остаётся в analysis-text ниже.
 */
export function renderAnalysisReport(info: LastAnalysisInfo): string {
  const fmtRub = (value: number): string =>
    `${Math.round(value).toLocaleString('ru-RU')} ₽`;
  const fmtPct = (value: number): string => `${value.toFixed(1)}%`;
  const assets = info.assets ?? [];
  const alerts = info.alerts ?? [];
  const totalPnl = assets.reduce(
    (sum, asset) => sum + (asset.unrealizedProfitRub ?? 0),
    0,
  );
  const maxDeviation = assets.reduce(
    (max, asset) =>
      Math.max(max, Math.abs(asset.currentPercent - asset.targetPercent)),
    0,
  );

  const cards = `
    <div class="analysis-cards">
      <div class="analysis-card"><div class="card-label">Стоимость портфеля</div><div class="card-value">${fmtRub(info.totalValue ?? 0)}</div></div>
      <div class="analysis-card"><div class="card-label">Нереализованный P&L</div><div class="card-value ${totalPnl < 0 ? 'neg' : totalPnl > 0 ? 'pos' : ''}">${fmtRub(totalPnl)}</div></div>
      <div class="analysis-card"><div class="card-label">Активов</div><div class="card-value">${assets.length}</div></div>
      <div class="analysis-card"><div class="card-label">Макс. отклонение</div><div class="card-value ${maxDeviation > 15 ? 'neg' : ''}">${fmtPct(maxDeviation)}</div></div>
    </div>`;

  const rows = assets
    .map((asset) => {
      const deviation = asset.currentPercent - asset.targetPercent;
      const pnl = asset.unrealizedProfitRub;
      const flags = asset.isConcentrated ? ['концентрация'] : [];
      const ticker = escapeHtmlReport(asset.ticker);
      const name = escapeHtmlReport(asset.name);
      const status = escapeHtmlReport(asset.status);
      const flagsHtml =
        flags.length > 0
          ? `<div class="muted">${escapeHtmlReport(flags.join(', '))}</div>`
          : '';
      const deviationHtml = `<span class="${deviation > 2 ? 'neg' : deviation < -2 ? 'pos' : ''}">${deviation > 0 ? '+' : ''}${deviation.toFixed(1)} п.п.</span>`;
      const pnlHtml =
        pnl === undefined
          ? '—'
          : `<span class="${pnl < 0 ? 'neg' : 'pos'}">${fmtRub(pnl)}</span>`;
      return `<tr${asset.isConcentrated ? ' class="warn"' : ''}><td><b>${ticker}</b><div class="muted">${name}</div></td><td class="num">${fmtPct(asset.currentPercent)}</td><td class="num">${fmtPct(asset.targetPercent)}</td><td class="num">${deviationHtml}</td><td class="num">${pnlHtml}</td><td>${status}${flagsHtml}</td></tr>`;
    })
    .join('');
  const table =
    rows.length === 0
      ? ''
      : `<h2>📋 Структура портфеля</h2><table class="history-table analysis-assets-table"><thead><tr><th>Актив</th><th class="num">Доля (тек.)</th><th class="num">Доля (цель)</th><th class="num">Отклонение</th><th class="num">P&L</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>`;

  const alertsHtml =
    alerts.length === 0
      ? ''
      : `<h2>🔔 Ценовые алерты</h2><ul>${alerts
          .map((alert) => {
            const price =
              alert.currentPrice !== undefined
                ? ` (цена ${alert.currentPrice})`
                : '';
            return `<li><b>${escapeHtmlReport(alert.ticker)}</b> — ${escapeHtmlReport(alert.alertLevel ?? 'alert')}${price}</li>`;
          })
          .join('')}</ul>`;

  return cards + table + alertsHtml;
}

// ──────────────────────────────────────────────
// activityCssClass
// ──────────────────────────────────────────────

export function activityCssClass(event: DirectorAuditEvent): string {
  switch (event.type) {
    case 'director.plan_created':
      return 'type-plan';
    case 'director.consilium_started':
    case 'director.consilium_round_completed':
    case 'director.consilium_completed':
      return 'type-consilium';
    case 'director.agent_result_received':
    case 'director.task_delegated':
      return 'type-agent';
    case 'director.recommendation_formed':
      return 'type-error';
    default:
      return '';
  }
}

// ──────────────────────────────────────────────
// formatLocalTime
// ──────────────────────────────────────────────

/** Локальное время из ISO-метки (для «Последнего запуска» диспетчера) */
export function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
