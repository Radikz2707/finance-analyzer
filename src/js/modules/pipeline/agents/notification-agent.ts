/**
 * NotificationAgent — фасад уведомлений для мультиагентного конвейера.
 *
 * Собирает результаты агентов (data/analysis/ai/review/scenario/
 * strategist/consilium) в отчёт и сохраняет его на диск.
 *
 * Границы подсистем уведомлений: этот агент = СБОРКА ОТЧЁТА для конвейера;
 * доменная логика «что и когда слать» — modules/notifications; транспорт
 * ОС (системные уведомления/буфер/ссылки) — pipeline/infrastructure/
 * os-integration (только десктопный контур). См. JSDoc этих модулей.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { resolveReportsDir } from '../../app-paths.js';
import type { DataAgentOutput } from './data-agent.js';
import type { AnalysisAgentOutput } from './analysis-agent.js';
import type { AiAgentOutput } from './ai-agent.js';
// ReviewAgent удалён — используем заглушку
export interface ReviewResult {
  agreement: number;
  agreementPercent: number;
  discrepancies: string[];
  hasDisagreement: boolean;
  timeMs: number;
  successful: number;
  timeouts: number;
  reviewers?: Array<{ role: string; opinion: string }>;
  finalRecommendation?: string;
}
import type { ScenarioAgentOutput } from '../agents/scenario-agent.js';
import type { StrategistAgentOutput } from '../agents/strategist-agent.js';
import type { ConsiliumOutput } from '../agents/consilium.js';
import type { QuikOrder } from '../../xlsx-parser/quik-orders-parser.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { StockQuote } from '../../ai-advisor/report-builders.js';
import { DashboardReportBuilder } from '../../../../components/dashboard/dashboard.js';
import { getMarkdownTemplate } from '../../ai-advisor/report-templates.js';
import { stripJsonBlockFromAiText } from '../../ai-advisor/json-sanitizer.js';
import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type { PortfolioIncome } from './analysis-agent.js';
import {
  buildInteractiveOrders,
  type InteractiveOrder,
} from '../orders/interactive-orders.js';

// ──────────────────────────────────────────────
// 1. Notification Agent output types
// ──────────────────────────────────────────────

/** Результат работы Notification Agent */
export interface NotificationAgentOutput {
  /** Путь к сгенерированному HTML-файлу */
  htmlPath: string;
  /** Путь к сгенерированному Markdown-файлу */
  mdPath: string;
  /** HTML-контент */
  htmlContent: string;
  /** Markdown-контент */
  mdContent: string;
  /** Успешно ли открыт отчёт в браузере */
  browserOpened: boolean;
  /** Интерактивные ордера для UI/Telegram */
  interactiveOrders: InteractiveOrder[];
}

// ──────────────────────────────────────────────
// 2. Notification Agent
// ──────────────────────────────────────────────

/**
 * Notification Agent — генерация и публикация отчётов.
 *
 * Задачи:
 * - Сборка HTML-дашборда (DashboardReportBuilder)
 * - Генерация Markdown-отчёта (report-templates)
 * - Запись файлов (report.html, report.md)
 * - Открытие отчёта в браузере (start/open)
 * - (Опционально) отправка через Telegram Bot
 *
 * Этот агент запускается ПОСЛЕ завершения всех upstream-агентов,
 * так как ему нужны все данные для сборки финального отчёта.
 */
export class NotificationAgent extends AgentBase {
  private htmlPath: string;
  private mdPath: string;

  constructor(config?: AgentConfig) {
    super(config ?? { name: 'NotificationAgent' });
    // Упакованное приложение (Program Files) писать рядом нельзя —
    // отчёты уходят в %APPDATA%/finance-analyzer/reports.
    const reportsDir = resolveReportsDir();
    this.htmlPath = path.join(reportsDir, 'report.html');
    this.mdPath = path.join(reportsDir, 'report.md');
  }

  protected async executeInternal(input: {
    data: DataAgentOutput;
    analysis: AnalysisAgentOutput;
    ai: AiAgentOutput;
    review?: ReviewResult;
    scenario?: ScenarioAgentOutput;
    strategist?: StrategistAgentOutput;
    consilium?: ConsiliumOutput;
  }): Promise<NotificationAgentOutput> {
    // silent — отчёт генерируется в файлы, не в консоль

    const { data, analysis, ai } = input;
    const { activeOrders, quotes } = data;
    const { portfolioAnalysis } = analysis;

    console.log(
      '[NotificationAgent] Starting buildHtmlReport with scenario=' +
        !!input.scenario +
        ', strategist=' +
        !!input.strategist,
    );

    // ── Шаг 1: Сборка HTML-дашборда ──
    const htmlContent = this.buildHtmlReport(
      activeOrders,
      portfolioAnalysis.assetsAnalysis,
      quotes,
      data,
      analysis,
      ai,
      input.scenario,
      input.strategist,
    );

    console.log(
      '[NotificationAgent] buildHtmlReport returned ' +
        htmlContent.length +
        ' chars',
    );

    // ── Шаг 2: Генерация Markdown-отчёта ──
    const mdContent = this.buildMarkdownReport(
      data,
      analysis,
      ai,
      input.scenario,
      input.strategist,
    );

    // ── Шаг 3: Запись файлов (ошибка записи не должна ронять pipeline) ──
    let htmlWritten = '';
    let mdWritten = '';
    try {
      fs.mkdirSync(path.dirname(this.htmlPath), { recursive: true });
      fs.writeFileSync(this.htmlPath, htmlContent, 'utf-8');
      fs.writeFileSync(this.mdPath, mdContent, 'utf-8');
      htmlWritten = this.htmlPath;
      mdWritten = this.mdPath;
      console.log(
        '[NotificationAgent] ✅ Файлы записаны: ' +
          `report.html (${htmlContent.length} байт), ` +
          `report.md (${mdContent.length} байт)`,
      );
    } catch (err) {
      console.warn(
        '[NotificationAgent] ⚠️ Не удалось записать отчёт: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    // ── Шаг 4: Генерация интерактивных ордеров ──
    // ИСПРАВЛЕНИЕ P0: передаём mathAiAgreements для обязательной проверки
    const interactiveOrders = buildInteractiveOrders(
      analysis.portfolioAnalysis.assetsAnalysis,
      activeOrders,
      ai.mathAiAgreements,
    );

    if (interactiveOrders.length > 0) {
      console.log(
        '[NotificationAgent] 📋 Сформировано интерактивных ордеров:',
        interactiveOrders.map((o) => `${o.ticker}(${o.action})`).join(', '),
      );
    }

    // ── Шаг 5: Открытие в браузере (только если HTML записан) ──
    const browserOpened = htmlWritten !== '' && this.openInBrowser(htmlWritten);

    return {
      htmlPath: htmlWritten,
      mdPath: mdWritten,
      htmlContent,
      mdContent,
      browserOpened,
      interactiveOrders,
    };
  }

  // ── Helpers ──

  private buildHtmlReport(
    orders: QuikOrder[],
    assetsAnalysis: AssetAnalysis[],
    quotes: Record<string, DataAgentOutput['quotes'][string]>,
    data: DataAgentOutput,
    analysis: AnalysisAgentOutput,
    ai: AiAgentOutput,
    scenario?: ScenarioAgentOutput,
    strategist?: StrategistAgentOutput,
  ): string {
    // Преобразуем quotes в StockQuote[]
    const stockQuotes: StockQuote[] = Object.entries(quotes).map(
      ([ticker, q]) => ({
        ticker,
        name: q.name,
        shortName: q.shortName,
        currentPrice: q.currentPrice,
        dailyDynamicsPercent: q.dailyDynamicsPercent,
      }),
    );

    // Строим DashboardReportBuilder с KPI-данными (единый вызов, без two-phase init)
    // ИСПРАВЛЕНИЕ P1: единый знаменатель и документирование финансовых показателей.
    // totalBalance (totalVal) = macroGoals.totalBalance из Excel (лист «Отчет по сделкам», C10 = Итого активов).
    // profitC10 = реализованная прибыль/убыток (исторический результат из Excel).
    // profitC11 = нереализованная прибыль/убыток (текущий финансовый результат из Excel).
    // investedNet = чистые вложенные средства (взносы - выводы).
    //
    // НИЧЕГО НЕ суммируется дважды: totalBalance включает текущую стоимость всех позиций.
    // profitC10 и profitC11 — разные метрики, а не дубли.
    const totalVal = data.macroGoals.totalBalance;
    const totalNetProfitRub = data.historicalTrades.profitC11;
    const aiBoxHtml = this.buildAiBoxHtml(analysis, ai);

    const reportBuilder = DashboardReportBuilder.fromOrdersAndAssets(
      orders,
      assetsAnalysis,
      stockQuotes,
      {
        totalVal,
        freeCash: data.macroGoals.freeCash,
        totalInvested: data.investedFunds.totalNet,
        resultC10: data.historicalTrades.profitC10,
        profitC11: totalNetProfitRub,
        investedNet: data.investedFunds.totalNet,
        c10Color: data.historicalTrades.profitC10 >= 0 ? '#56d364' : '#ff7b72',
        c11Color: totalNetProfitRub >= 0 ? '#56d364' : '#ff7b72',
        // ИСПРАВЛЕНИЕ P1: используем реальную ставку ЦБ из data.cbrRateData
        cbrRate: data.cbrRateData?.rate ?? 0,
        dateStr: new Date().toLocaleDateString('ru-RU'),
        timeStr: new Date().toLocaleTimeString('ru-RU'),
        aiBoxHtml,
      },
    );

    // Добавляем сценарии "что если" в HTML отчет
    let html = reportBuilder.buildHtml();
    console.log(
      `[NotificationAgent] scenario=${!!scenario}, scenarios.length=${scenario?.scenarios?.length ?? 0}, ` +
        `bestScenarioId=${scenario?.bestScenarioId ?? 'null'}`,
    );
    console.log(
      `[NotificationAgent] strategist=${!!strategist}, decisions.length=${strategist?.decisions?.length ?? 0}`,
    );
    if (scenario && scenario.scenarios.length > 0) {
      console.log('[NotificationAgent] Calling buildScenarioSectionHtml...');
      const scenarioHtml = this.buildScenarioSectionHtml(scenario);
      console.log(
        `[NotificationAgent] buildScenarioSectionHtml returned ${scenarioHtml.length} chars`,
      );
      html += scenarioHtml;
    }

    // Добавляем стратега в HTML отчет
    if (strategist && strategist.decisions.length > 0) {
      console.log('[NotificationAgent] Calling buildStrategistSectionHtml...');
      const strategistHtml = this.buildStrategistSectionHtml(strategist);
      console.log(
        `[NotificationAgent] buildStrategistSectionHtml returned ${strategistHtml.length} chars`,
      );
      html += strategistHtml;
    }

    // ── Скрипт для обработки кнопок обратной связи ──
    html += `
<script>
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.feedback-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var ticker = this.getAttribute('data-ticker');
      var action = this.getAttribute('data-action');
      // Отправляем сообщение в parent window
      window.parent.postMessage({
        type: 'recommendation:feedback',
        ticker: ticker,
        feedback: action
      }, '*');
      
      // Визуальная обратная связь — показываем выбор
      var item = this.closest('.recommendation-item');
      var buttons = item.querySelectorAll('.feedback-btn');
      
      // Сбросить все кнопки
      buttons.forEach(function(b) {
        b.style.opacity = '0.3';
        b.style.transform = 'scale(0.95)';
        b.disabled = true;
      });
      
      // Выбранная кнопка — яркая
      this.style.opacity = '1';
      this.style.transform = 'scale(1.15)';
      this.style.boxShadow = '0 0 12px rgba(86, 211, 100, 0.5)';
      
      // Показать текстовую метку
      var feedbackLabel = item.querySelector('.feedback-label');
      if (!feedbackLabel) {
        feedbackLabel = document.createElement('div');
        feedbackLabel.className = 'feedback-label';
        feedbackLabel.style.cssText = 'font-size: 11px; margin-top: 6px; color: #8b949e; font-style: italic;';
        item.appendChild(feedbackLabel);
      }
      
      if (action === 'good') {
        feedbackLabel.textContent = '✅ Спасибо! Рекомендация отмечена как верная.';
        feedbackLabel.style.color = '#56d364';
      } else {
        feedbackLabel.textContent = '✅ Спасибо! Рекомендация отмечена как неверная.';
        feedbackLabel.style.color = '#ff7b72';
      }
    });
  });
});
</script>`;

    return html;
  }

  private buildMarkdownReport(
    data: DataAgentOutput,
    analysis: AnalysisAgentOutput,
    ai: AiAgentOutput,
    scenario?: ScenarioAgentOutput,
    strategist?: StrategistAgentOutput,
  ): string {
    const { assetsAnalysis } = analysis.portfolioAnalysis;
    const { income, priceAlertsMd } = analysis;
    const { macroGoals } = data;

    // Список активов для Markdown
    const assetsListMd = assetsAnalysis
      .map(
        (item) =>
          `- ${item.name}: Текущая доля ${item.currentPercent.toFixed(1)}%, ` +
          `Целевая доля: ${item.targetPercent !== undefined ? item.targetPercent.toFixed(1) : '—'}%. ` +
          `Status: ${item.status}`,
      )
      .join('\n');

    // Формируем Markdown-шаблон
    const totalVal = data.macroGoals.totalBalance;
    const stocksPct = this.calcStocksPercent(assetsAnalysis);
    const bondsPct = this.calcBondsPercent(assetsAnalysis);

    const stocksListText = income.stocks
      .map((s) => `${s.name} (${s.ticker}): ${s.quantity} шт.`)
      .join(', ');

    // Предупреждение о новых активах без целевой доли
    const newAssets = assetsAnalysis.filter((item) => item.status === 'NEW');
    let newAssetsWarningMd = '';
    if (newAssets.length > 0) {
      newAssetsWarningMd =
        '\n⚠️ ВНИМАНИЕ: Обнаружены новые активы без указанной цели в Excel:\n' +
        newAssets
          .map((item) => `* ${item.name} (Укажите целевой % в столбце S)`)
          .join('\n') +
        '\n';
    }

    const mdData = getMarkdownTemplate(
      new Date().toLocaleDateString('ru-RU'),
      totalVal.toLocaleString('ru-RU'),
      macroGoals.freeCash.toLocaleString('ru-RU'),
      stocksPct,
      bondsPct,
      assetsListMd +
        newAssetsWarningMd +
        '\n' +
        priceAlertsMd +
        '\n\n### 💰 Доходность портфеля: НКД и дивиденды\n' +
        `* НКД по облигациям (накопленный купон): **${income.totalNkd.toLocaleString('ru-RU')} ₽**\n` +
        `* Дивиденды (грязные, до налога): **${income.totalDivs.toLocaleString('ru-RU')} ₽**\n` +
        `* Дивиденды (чистые, после НДФЛ ${Math.round(PortfolioConfig.tax.dividendNdflRate * 100)}%): **${income.totalDivsNet.toLocaleString('ru-RU')} ₽**\n` +
        `* Итого чистый доход (НКД + дивиденды): **${(income.totalNkd + income.totalDivsNet).toLocaleString('ru-RU')} ₽**\n` +
        (income.stocks.length > 0
          ? '* Дивидендные позиции:\n' +
            income.stocks
              .map(
                (s) =>
                  `  - ${s.name} (${s.ticker}): ${s.quantity} шт. × ${s.rate.toLocaleString('ru-RU')} ₽ = ` +
                  `${s.grossIncome.toLocaleString('ru-RU')} ₽ грязными / ${s.netIncome.toLocaleString('ru-RU')} ₽ чистыми`,
              )
              .join('\n') +
            '\n'
          : '') +
        `* Действующие долевые позиции: ${stocksListText || 'Данные не получены'}\n`,
    );

    // Добавляем AI-текст в конец Markdown
    // (очищенный от raw structured JSON — narrative приходит уже чистым,
    // здесь повторная страховка на display-слое)
    let md = mdData;
    if (ai.aiNarrative) {
      md += '\n\n---\n\n' + stripJsonBlockFromAiText(ai.aiNarrative);
    }

    // Добавляем сценарии "что если"
    if (scenario && scenario.scenarios.length > 0) {
      md += '\n\n---\n\n';
      md += this.buildScenarioSectionMd(scenario);
    }

    // Добавляем стратега
    if (strategist && strategist.decisions.length > 0) {
      md += '\n\n---\n\n';
      md += this.buildStrategistSectionMd(strategist);
    }

    return md;
  }

  /**
   * HTML-виджет «Доходность портфеля: НКД и дивиденды».
   * Показывает грязные и чистые суммы (после НДФЛ) + таблицу позиций.
   * Оформлен в тёмной теме dashboard (GitHub dark).
   */
  private buildIncomeWidgetHtml(income: PortfolioIncome): string {
    const fmt = (n: number): string => n.toLocaleString('ru-RU');
    const taxRate = PortfolioConfig.tax.dividendNdflRate;
    const totalNet = income.totalNkd + income.totalDivsNet;

    const card = (title: string, value: string, sub: string, color: string) =>
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;text-align:center;">' +
      `<div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:bold;margin-bottom:4px;">${title}</div>` +
      `<div style="font-size:18px;font-weight:bold;color:${color};">${value}</div>` +
      `<div style="font-size:11px;color:#8b949e;margin-top:4px;">${sub}</div>` +
      '</div>';

    let html =
      '<div style="margin-bottom:15px;padding:15px;background:#161b22;border:1px solid #30363d;border-radius:6px;">' +
      '<h3 style="margin:0 0 12px 0;font-size:14px;color:#fff;border-bottom:1px solid #30363d;padding-bottom:8px;">' +
      '💰 Доходность портфеля: НКД и дивиденды</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;">' +
      card('НКД (облигации)', fmt(income.totalNkd) + ' ₽', 'накопленный купонный доход', '#e3b341') +
      card('Дивиденды грязные', fmt(income.totalDivs) + ' ₽', 'до налога', '#fff') +
      card(
        'Дивиденды чистые',
        fmt(income.totalDivsNet) + ' ₽',
        `после НДФЛ ${Math.round(taxRate * 100)}%`,
        '#56d364',
      ) +
      card('Итого чистый доход', fmt(totalNet) + ' ₽', 'НКД + дивиденды', '#58a6ff') +
      '</div>';

    if (income.stocks.length > 0) {
      const th =
        'style="text-align:right;padding:8px;color:#8b949e;border-bottom:1px solid #30363d;"';
      const thL =
        'style="text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #30363d;"';
      const td =
        'style="padding:8px;border-bottom:1px solid #30363d;text-align:right;color:#c9d1d9;"';
      const tdL =
        'style="padding:8px;border-bottom:1px solid #30363d;color:#c9d1d9;"';

      html +=
        '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
        '<thead><tr>' +
        `<th ${thL}>Позиция</th>` +
        `<th ${th}>Кол-во</th>` +
        `<th ${th}>Ставка</th>` +
        `<th ${th}>Грязные</th>` +
        `<th ${th}>Чистые (-${Math.round(taxRate * 100)}%)</th>` +
        '</tr></thead><tbody>';

      for (const s of income.stocks) {
        html +=
          '<tr>' +
          `<td ${tdL}><strong style="color:#fff;">${s.name}</strong> ` +
          `<span style="color:#58a6ff;">(${s.ticker})</span></td>` +
          `<td ${td}>${s.quantity}</td>` +
          `<td ${td}>${fmt(s.rate)} ₽</td>` +
          `<td ${td}><span style="color:#fff;font-weight:600;">${fmt(s.grossIncome)} ₽</span></td>` +
          `<td ${td}><span style="color:#56d364;font-weight:600;">${fmt(s.netIncome)} ₽</span></td>` +
          '</tr>';
      }
      html += '</tbody></table>';
    } else {
      html +=
        '<div style="color:#8b949e;font-size:12px;text-align:center;padding:8px;">' +
        'Дивиденды не объявлены или не заполнены в Excel-файле</div>';
    }

    html += '</div>';
    return html;
  }

  /**
   * Построить секцию структурированных рекомендаций с кнопками обратной связи.
   */
  private buildRecommendationsWithFeedback(ai: AiAgentOutput): string {
    const recs = ai.structuredRecommendations;
    if (!recs || recs.size === 0) {
      return '';
    }

    let html = '<div class="recommendations-section" style="margin-top: 20px; padding: 15px; background: rgba(86, 211, 100, 0.05); border: 1px solid rgba(86, 211, 100, 0.3); border-radius: 8px;">\n';
    html += '<h3 style="margin: 0 0 15px 0; color: #56d364; font-size: 16px;">📊 Рекомендации ИИ-советника</h3>\n';
    html += '<div class="recommendations-list" style="display: flex; flex-direction: column; gap: 10px;">\n';

    for (const [ticker, rec] of recs) {
      const action = rec.recommendedAction ?? 'HOLD';
      const confidence = rec.confidence ?? 0;
      const actionColor = action === 'BUY' ? '#56d364' : action === 'SELL' || action === 'REDUCE' ? '#ff7b72' : '#ffd166';
      const actionLabel = action === 'BUY' ? '🟢 Покупать' : action === 'SELL' || action === 'REDUCE' ? '🔴 Продавать' : '🟡 Держать';

      html += '<div class="recommendation-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 6px; border-left: 3px solid ' + actionColor + ';">\n';
      html += '<div style="flex: 1;">\n';
      html += '<div style="font-weight: bold; color: #e6edf3; font-size: 14px;">' + ticker + (rec.name ? ' — ' + rec.name : '') + '</div>\n';
      html += '<div style="color: ' + actionColor + '; font-size: 13px; margin-top: 4px;">' + actionLabel + '</div>\n';
      html += '<div style="color: #8b949e; font-size: 12px; margin-top: 2px;">Уверенность: ' + Math.round(confidence * 100) + '%</div>\n';
      if (rec.rationale) {
        html += '<div style="color: #8b949e; font-size: 11px; margin-top: 4px; font-style: italic;">' + rec.rationale + '</div>\n';
      }
      html += '</div>\n';
      html += '<div class="feedback-buttons" style="display: flex; gap: 8px; margin-left: 15px;">\n';
      html += '<button class="feedback-btn feedback-good" data-ticker="' + ticker + '" data-action="good" style="background: rgba(86, 211, 100, 0.1); border: 1px solid rgba(86, 211, 100, 0.4); color: #56d364; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 14px;">👍</button>\n';
      html += '<button class="feedback-btn feedback-bad" data-ticker="' + ticker + '" data-action="bad" style="background: rgba(255, 123, 114, 0.1); border: 1px solid rgba(255, 123, 114, 0.4); color: #ff7b72; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 14px;">👎</button>\n';
      html += '</div>\n';
      html += '</div>\n';
    }

    html += '</div>\n';
    html += '<div style="margin-top: 10px; font-size: 11px; color: #8b949e;">Оцените рекомендации: 👍 если рекомендация верна, 👎 если нет. Это поможет улучшить анализ в будущем.</div>\n';
    html += '</div>\n';

    return html;
  }

  private buildAiBoxHtml(
    analysis: AnalysisAgentOutput,
    ai: AiAgentOutput,
  ): string {
    const generatedAt = new Date().toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const currentMonth = new Date().toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });

    let html =
      '<div class="ai-box-styled">' +
      this.buildIncomeWidgetHtml(analysis.income) +
      `📋 Экспертное заключение ИИ-советника (${currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1)})\n` +
      `🕒 Сформировано: ${generatedAt}\n` +
      `🤖 Использована модель: ${ai.aiClientResult.modelUsed}\n\n`;

    // Предупреждение о новых активах
    const newAssets = analysis.portfolioAnalysis.assetsAnalysis.filter(
      (item) => item.status === 'NEW',
    );
    if (newAssets.length > 0) {
      html +=
        '<div class="warning-box" style="padding: 15px; background: rgba(163, 113, 247, 0.1); border: 1px solid #a371f7; border-radius: 6px; margin-bottom: 15px;">' +
        '⚠️ Внимание: В вашем портфеле обнаружены новые инструменты без установленной целевой доли: ' +
        newAssets.map((item) => item.name).join(', ') +
        '. Пожалуйста, пропишите желаемый процент в столбце S вашей Excel-таблицы.</div>\n\n';
    }

    // Ценовые алерты
    if (analysis.priceAlerts.length > 0) {
      html += '⚠️ <b>Ценовые алерты:</b>\n';
      for (const alert of analysis.priceAlerts) {
        html += `- ${alert.ticker}: ${alert.alertLevel} ${alert.threshold}%\n`;
      }
      html += '\n';
    }

    // Предупреждения валидации
    if (ai.validationWarnings.length > 0) {
      html += '⚠️ <b>Предупреждения валидации:</b>\n';
      for (const warning of ai.validationWarnings) {
        html += `- ${warning}\n`;
      }
      html += '\n';
    }

    // ── Структурированные рекомендации с кнопками обратной связи ──
    html += this.buildRecommendationsWithFeedback(ai);

    // AI-текст (raw structured JSON никогда не должен попадать в дашборд —
    // stripJsonBlockFromAiText удаляет ```json / {"ticker": ...} блоки)
    html += stripJsonBlockFromAiText(ai.aiNarrative);
    html += '</div>';

    return html;
  }

  private calcStocksPercent(assetsAnalysis: AssetAnalysis[]): number {
    return (
      Math.round(
        assetsAnalysis
          .filter((a) => a.assetType === 'А' || a.assetType === 'Акция')
          .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
      ) / 100
    );
  }

  private calcBondsPercent(assetsAnalysis: AssetAnalysis[]): number {
    return (
      Math.round(
        assetsAnalysis
          .filter((a) => a.assetType === 'О' || a.assetType === 'Облигация')
          .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
      ) / 100
    );
  }

  // ── Markdown секции ──

  private buildScenarioSectionMd(scenario: ScenarioAgentOutput): string {
    const fmtRub = (v: number): string =>
      new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
    const fmtPct = (v: number): string => v.toFixed(1) + '%';

    let md = '## 🎯 Сценарии «Что будет, если?»\n\n';

    // Сводка
    md += '**Сводка:**\n\n';
    md += `- Построено сценариев: ${scenario.summary.scenariosBuilt}\n`;
    md += `- Baseline отклонение: ${fmtPct(scenario.summary.baselineDeviationPct)}\n`;
    md += `- Лучшее улучшение: ${fmtPct(scenario.summary.bestImprovementPct)}\n\n`;

    // Таблица
    md += '| Сценарий | Вердикт | Отклонение | P&L прогноз | Зафик. убыток |\n';
    md += '|----------|---------|------------|-------------|---------------|\n';

    for (const s of scenario.scenarios) {
      const bestMarker = s.id === scenario.bestScenarioId ? ' ⭐' : '';
      const verdictLabel =
        s.verdict === 'IMPROVES'
          ? 'УЛУЧШАЕТ'
          : s.verdict === 'WORSENS'
            ? 'УХУДШАЕТ'
            : 'НЕЙТРАЛЬНЫЙ';

      md += `| ${s.title}${bestMarker} | ${verdictLabel} | ${fmtPct(s.structureDeviationPct)} | ${fmtRub(s.projectedUnrealizedPnL)} | ${fmtRub(s.realizedLossRub)} |\n`;

      if (s.rationale) {
        md += `| _${s.rationale}_ | | | | |\n`;
      }
    }

    md += '\n';
    return md;
  }

  private buildStrategistSectionMd(
    strategist: StrategistAgentOutput,
  ): string {
    let md = '## 🛡️ Стратег — Правила защиты\n\n';

    md += `**Цель:** ${strategist.summary.goal} | **Проверено активов:** ${strategist.summary.assetsChecked}\n\n`;

    md += '| Актив | Действие | Решение | Обоснование |\n';
    md += '|-------|----------|---------|-------------|\n';

    for (const d of strategist.decisions) {
      md += `| ${d.ticker} | ${d.suggestedAction || '—'} | ${d.finalAction || '—'} | ${d.note || '—'} |\n`;
    }

    md += '\n';
    return md;
  }

  // ── Сценарии "что если" (HTML) ──

  private buildScenarioSectionHtml(scenario: ScenarioAgentOutput): string {
    const fmtRub = (v: number): string =>
      new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
    const fmtPct = (v: number): string => v.toFixed(1) + '%';

    let html =
      '<div style="margin-bottom:20px;padding:20px;background:#161b22;border:1px solid #30363d;border-radius:6px;">' +
      '<h3 style="margin:0 0 15px 0;font-size:16px;color:#fff;border-bottom:1px solid #30363d;padding-bottom:8px;">' +
      '🎯 Сценарии «Что будет, если?»</h3>';

    // Сводка
    html +=
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:15px;">' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:10px;text-align:center;">' +
      '<div style="font-size:11px;color:#8b949e;text-transform:uppercase;">Построено сценариев</div>' +
      `<div style="font-size:18px;font-weight:bold;color:#58a6ff;margin-top:4px;">${scenario.summary.scenariosBuilt}</div>` +
      '</div>' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:10px;text-align:center;">' +
      '<div style="font-size:11px;color:#8b949e;text-transform:uppercase;">Baseline отклонение</div>' +
      `<div style="font-size:18px;font-weight:bold;color:#fff;margin-top:4px;">${fmtPct(scenario.summary.baselineDeviationPct)}</div>` +
      '</div>' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:10px;text-align:center;">' +
      '<div style="font-size:11px;color:#8b949e;text-transform:uppercase;">Лучшее улучшение</div>' +
      `<div style="font-size:18px;font-weight:bold;color:#56d364;margin-top:4px;">${fmtPct(scenario.summary.bestImprovementPct)}</div>` +
      '</div>' +
      '</div>';

    // Таблица сценариев
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html +=
      '<thead><tr style="border-bottom:1px solid #30363d;">' +
      '<th style="text-align:left;padding:8px;color:#8b949e;">Сценарий</th>' +
      '<th style="text-align:left;padding:8px;color:#8b949e;">Вердикт</th>' +
      '<th style="text-align:right;padding:8px;color:#8b949e;">Отклонение</th>' +
      '<th style="text-align:right;padding:8px;color:#8b949e;">P&L прогноз</th>' +
      '<th style="text-align:right;padding:8px;color:#8b949e;">Зафикс. убыток</th>' +
      '</tr></thead><tbody>';

    for (const s of scenario.scenarios) {
      const isBest = s.id === scenario.bestScenarioId;
      const rowStyle = isBest
        ? 'background:rgba(88,166,255,0.08);border-left:3px solid #58a6ff;'
        : '';

      const verdictColor =
        s.verdict === 'IMPROVES'
          ? '#56d364'
          : s.verdict === 'WORSENS'
            ? '#ff7b72'
            : '#8b949e';
      const verdictLabel =
        s.verdict === 'IMPROVES'
          ? 'УЛУЧШАЕТ'
          : s.verdict === 'WORSENS'
            ? 'УХУДШАЕТ'
            : 'НЕЙТРАЛЬНЫЙ';

      html +=
        '<tr style="border-bottom:1px solid #30363d;">' +
        `<td style="padding:8px;color:#c9d1d9;${rowStyle}"><strong>${s.title}</strong>${
          isBest ? ' ⭐' : ''
        }</td>` +
        `<td style="padding:8px;color:${verdictColor};${rowStyle}"><strong>${verdictLabel}</strong></td>` +
        `<td style="padding:8px;text-align:right;color:#c9d1d9;${rowStyle}">${fmtPct(s.structureDeviationPct)}</td>` +
        `<td style="padding:8px;text-align:right;color:${s.projectedUnrealizedPnL >= 0 ? '#56d364' : '#ff7b72'};${rowStyle}">${fmtRub(s.projectedUnrealizedPnL)}</td>` +
        `<td style="padding:8px;text-align:right;color:${s.realizedLossRub > 0 ? '#ff7b72' : '#8b949e'};${rowStyle}">${fmtRub(s.realizedLossRub)}</td>` +
        '</tr>';

      // Rationale (если есть)
      if (s.rationale) {
        html +=
          `<tr><td colspan="5" style="padding:4px 8px 8px 20px;color:#8b949e;font-size:12px;${rowStyle}">${s.rationale}</td></tr>`;
      }
    }

    html += '</tbody></table></div>';
    return html;
  }

  private buildStrategistSectionHtml(
    strategist: StrategistAgentOutput,
  ): string {
    const fmtPct = (v: number | null): string =>
      v !== null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—';

    let html =
      '<div style="margin-bottom:20px;padding:20px;background:#161b22;border:1px solid #30363d;border-radius:6px;">' +
      '<h3 style="margin:0 0 15px 0;font-size:16px;color:#fff;border-bottom:1px solid #30363d;padding-bottom:8px;">' +
      '🛡️ Стратег — Правила защиты</h3>';

    // Сводка с долями сегментов
    const buyCount = strategist.decisions.filter(
      (d) => d.finalAction === 'BUY' || d.finalAction === 'REDUCE',
    ).length;
    const sellCount = strategist.decisions.filter(
      (d) => d.finalAction === 'SELL' || d.finalAction === 'REDUCE',
    ).length;
    const holdCount = strategist.decisions.filter(
      (d) => d.finalAction === 'HOLD',
    ).length;

    html +=
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;">' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:8px;text-align:center;">' +
      '<div style="font-size:10px;color:#8b949e;text-transform:uppercase;">Активов</div>' +
      `<div style="font-size:16px;font-weight:bold;color:#58a6ff;margin-top:2px;">${strategist.summary.assetsChecked}</div>` +
      '</div>' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:8px;text-align:center;">' +
      '<div style="font-size:10px;color:#8b949e;text-transform:uppercase;">Покупать</div>' +
      `<div style="font-size:16px;font-weight:bold;color:#56d364;margin-top:2px;">${buyCount}</div>` +
      '</div>' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:8px;text-align:center;">' +
      '<div style="font-size:10px;color:#8b949e;text-transform:uppercase;">Продавать</div>' +
      `<div style="font-size:16px;font-weight:bold;color:#ff7b72;margin-top:2px;">${sellCount}</div>` +
      '</div>' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:8px;text-align:center;">' +
      '<div style="font-size:10px;color:#8b949e;text-transform:uppercase;">Держать</div>' +
      `<div style="font-size:16px;font-weight:bold;color:#e3b341;margin-top:2px;">${holdCount}</div>` +
      '</div>' +
      '</div>';

    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html +=
      '<thead><tr style="border-bottom:1px solid #30363d;">' +
      '<th style="text-align:left;padding:6px 8px;color:#8b949e;">Актив</th>' +
      '<th style="text-align:right;padding:6px 8px;color:#8b949e;">Доля</th>' +
      '<th style="text-align:right;padding:6px 8px;color:#8b949e;">Просадка</th>' +
      '<th style="text-align:left;padding:6px 8px;color:#8b949e;">Действие</th>' +
      '<th style="text-align:left;padding:6px 8px;color:#8b949e;">Решение</th>' +
      '<th style="text-align:left;padding:6px 8px;color:#8b949e;">Примечание</th>' +
      '</tr></thead><tbody>';

    for (const d of strategist.decisions) {
      const actionColor =
        d.finalAction === 'BUY' || d.finalAction === 'HOLD'
          ? '#56d364'
          : d.finalAction === 'SELL' || d.finalAction === 'REDUCE' || d.finalAction === 'EXIT'
            ? '#ff7b72'
            : '#8b949e';

      // Формируем примечание с данными о просадке и концентрации
      let note = d.note || '';
      if (d.drawdownPercent !== null && d.drawdownPercent < 0) {
        note += (note ? ' · ' : '') + `📉 ${fmtPct(d.drawdownPercent)}`;
      }
      if (d.concentrationPercent !== null && d.concentrationPercent > 10) {
        note += (note ? ' · ' : '') + `⚠️ ${fmtPct(d.concentrationPercent)}`;
      }
      if (!note) note = '—';

      html +=
        '<tr style="border-bottom:1px solid #30363d;">' +
        `<td style="padding:6px 8px;color:#c9d1d9;font-weight:bold;">${d.name || d.ticker}</td>` +
        `<td style="padding:6px 8px;text-align:right;color:#8b949e;">${fmtPct(d.concentrationPercent)}</td>` +
        `<td style="padding:6px 8px;text-align:right;color:${d.drawdownPercent !== null ? (d.drawdownPercent < -30 ? '#ff7b72' : d.drawdownPercent < 0 ? '#e3b341' : '#56d364') : '#8b949e'};font-weight:bold;">${fmtPct(d.drawdownPercent)}</td>` +
        `<td style="padding:6px 8px;color:#8b949e;font-size:11px;">${d.suggestedAction || '—'}</td>` +
        `<td style="padding:6px 8px;color:${actionColor};font-weight:bold;">${d.finalAction || '—'}</td>` +
        `<td style="padding:6px 8px;color:#8b949e;font-size:11px;">${note}</td>` +
        '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  /**
    * Открыть report.html в браузере ОС по умолчанию.
    *
    * Внутри Electron-приложения отчёт и так показывается во вкладке
    * «Анализ» (iframe из runPipelineReport) — внешний браузер не открываем,
    * иначе каждый прогон анализа плодил бы лишние вкладки.
    * Работает только в CLI-прогонах (npm run pipeline).
    */
  private openInBrowser(filePath: string): boolean {
    // Electron: process.versions.electron определён только в его рантайме
    if (process.versions.electron) {
      return false;
    }
    try {
      if (process.platform === 'win32') {
        // start — внутренняя команда cmd.exe; первый "" — заголовок окна
        exec(`start "" "${filePath}"`, { shell: 'cmd.exe' });
      } else if (process.platform === 'darwin') {
        exec(`open "${filePath}"`);
      } else {
        exec(`xdg-open "${filePath}"`);
      }
      return true;
    } catch {
      return false;
    }
  }
}
