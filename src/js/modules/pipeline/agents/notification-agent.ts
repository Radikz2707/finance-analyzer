import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'node:child_process';
import type { DataAgentOutput } from './data-agent.js';
import type { AnalysisAgentOutput } from './analysis-agent.js';
import type { AiAgentOutput } from './ai-agent.js';
import type { QuikOrder } from '../../xlsx-parser/quik-orders-parser.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { StockQuote } from '../../ai-advisor/report-builders.js';
import { DashboardReportBuilder } from '../../../../components/dashboard-report/dashboard-report.js';
import { getMarkdownTemplate } from '../../ai-advisor/report-templates.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import { buildInteractiveOrders, type InteractiveOrder } from '../orders/interactive-orders.js';

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
    this.htmlPath = path.join(process.cwd(), 'report.html');
    this.mdPath = path.join(process.cwd(), 'report.md');
  }

  protected async executeInternal(
    input: {
      data: DataAgentOutput;
      analysis: AnalysisAgentOutput;
      ai: AiAgentOutput;
    },
  ): Promise<NotificationAgentOutput> {
    console.log('[NotificationAgent] >>> Генерация отчётов');

    const { data, analysis, ai } = input;
    const { activeOrders, quotes } = data;
    const { portfolioAnalysis } = analysis;

    // ── Шаг 1: Сборка HTML-дашборда ──
    const htmlContent = this.buildHtmlReport(
      activeOrders,
      portfolioAnalysis.assetsAnalysis,
      quotes,
      data,
      analysis,
      ai,
    );

    // ── Шаг 2: Генерация Markdown-отчёта ──
    const mdContent = this.buildMarkdownReport(
      data,
      analysis,
      ai,
    );

    // ── Шаг 3: Запись файлов ──
    fs.writeFileSync(this.htmlPath, htmlContent, 'utf-8');
    fs.writeFileSync(this.mdPath, mdContent, 'utf-8');

    console.log(
      '[NotificationAgent] ✅ Файлы записаны: ' +
      `report.html (${htmlContent.length} байт), ` +
      `report.md (${mdContent.length} байт)`,
    );

    // ── Шаг 4: Генерация интерактивных ордеров ──
    const interactiveOrders = buildInteractiveOrders(
      analysis.portfolioAnalysis.assetsAnalysis,
      activeOrders,
    );

    if (interactiveOrders.length > 0) {
      console.log(
        '[NotificationAgent] 📋 Сформировано интерактивных ордеров:',
        interactiveOrders.map((o) => `${o.ticker}(${o.action})`).join(', '),
      );
    }

    // ── Шаг 5: Открытие в браузере ──
    const browserOpened = this.openInBrowser(this.htmlPath);

    return {
      htmlPath: this.htmlPath,
      mdPath: this.mdPath,
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
    const totalVal = this.calculateTotalVal(assetsAnalysis);
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
        cbrRate: 0, // будет из macroResearch в будущем
        dateStr: new Date().toLocaleDateString('ru-RU'),
        timeStr: new Date().toLocaleTimeString('ru-RU'),
        aiBoxHtml,
      },
    );

    return reportBuilder.buildHtml();
  }

  private buildMarkdownReport(
    data: DataAgentOutput,
    analysis: AnalysisAgentOutput,
    ai: AiAgentOutput,
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
    const totalVal = this.calculateTotalVal(assetsAnalysis);
    const stocksPct = this.calcStocksPercent(assetsAnalysis);
    const bondsPct = this.calcBondsPercent(assetsAnalysis);

    const stocksListText = income.stocks
      .map((s) => `${s.name} (${s.ticker}): ${s.quantity} шт.`)
      .join(', ');

    const mdData = getMarkdownTemplate(
      new Date().toLocaleDateString('ru-RU'),
      totalVal.toLocaleString('ru-RU'),
      macroGoals.freeCash.toLocaleString('ru-RU'),
      stocksPct,
      bondsPct,
      assetsListMd +
        '\n' +
        priceAlertsMd +
        '\n\n### 💰 Динамическая аналитика купонов и объявленных дивидендов:\n' +
        `* Суммарный накопленный НКД по всем облигациям в портфеле: ${income.totalNkd.toLocaleString('ru-RU')} ₽\n` +
        `* Действующие долевые позиции: ${stocksListText || 'Данные не получены'}\n` +
        `* Суммарный чистый ожидаемый дивидендный поток: ${income.totalDivsNet.toLocaleString('ru-RU')} ₽\n`,
    );

    // Добавляем AI-текст в конец Markdown
    if (ai.aiNarrative) {
      return mdData + '\n\n---\n\n' + ai.aiNarrative;
    }

    return mdData;
  }

  private buildAiBoxHtml(
    analysis: AnalysisAgentOutput,
    ai: AiAgentOutput,
  ): string {
    const currentMonth = new Date().toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });

    let html =
      '<div class="ai-box-styled">' +
      `📋 Экспертное заключение ИИ-советника (${currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1)})\n` +
      `🤖 Использована модель: ${ai.aiClientResult.modelUsed}\n\n`;

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

    // AI-текст
    html += ai.aiNarrative;
    html += '</div>';

    return html;
  }

  private calculateTotalVal(assetsAnalysis: AssetAnalysis[]): number {
    return assetsAnalysis.reduce((sum, a) => {
      const liqValue = (a.quantity ?? 0) * (a.currentPrice ?? 0);
      return sum + liqValue;
    }, 0);
  }

  private calcStocksPercent(assetsAnalysis: AssetAnalysis[]): number {
    return Math.round(
      assetsAnalysis
        .filter((a) => a.assetType === 'А' || a.assetType === 'Акция')
        .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
    ) / 100;
  }

  private calcBondsPercent(assetsAnalysis: AssetAnalysis[]): number {
    return Math.round(
      assetsAnalysis
        .filter((a) => a.assetType === 'О' || a.assetType === 'Облигация')
        .reduce((sum, a) => sum + a.currentPercent, 0) * 100,
    ) / 100;
  }

  private openInBrowser(filePath: string): boolean {
    try {
      const cleanPath = filePath.replace(/\\/g, '/');
      const openCommand =
        process.platform === 'win32'
          ? `start "" "${cleanPath}"`
          : `open "${cleanPath}"`;
      exec(openCommand);
      console.log(`[NotificationAgent] 🌐 Отчёт открыт в браузере: ${filePath}`);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[NotificationAgent] ❌ Ошибка открытия браузера: ${errorMsg}`);
      return false;
    }
  }
}
