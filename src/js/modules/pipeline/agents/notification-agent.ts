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
import type { ReviewResult } from '../review/review-agent.js';
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
    const mdContent = this.buildMarkdownReport(data, analysis, ai);

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
    // Используем totalBalance из "Отчет по сделкам" (C10 = Итого активов),
    // а не пересчитываем из assetsAnalysis (там currentPrice берётся из "Стоимость" = ликвидационная цена)
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
    if (ai.aiNarrative) {
      return mdData + '\n\n---\n\n' + stripJsonBlockFromAiText(ai.aiNarrative);
    }

    return mdData;
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
      this.buildIncomeWidgetHtml(analysis.income) +
      `📋 Экспертное заключение ИИ-советника (${currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1)})\n` +
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
