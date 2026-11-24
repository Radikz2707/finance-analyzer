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
import { resolveReportsDir } from '../../../shared/app-paths.js';
import type { DataAgentOutput } from './data-agent.js';
import type { AnalysisAgentOutput } from './analysis-agent.js';
import type { AiAgentOutput } from './ai-agent.js';
import type { ScenarioAgentOutput } from '../agents/scenario-agent.js';
import type { StrategistAgentOutput } from '../agents/strategist-agent.js';
import type { ConsiliumOutput } from '../agents/consilium.js';
import type { QuikOrder } from '../../../data/xlsx-parser/quik-orders-parser.js';
import type { AssetAnalysis } from '../../../portfolio/portfolio-math/portfolio-math.js';
import {
  buildActiveStockPositionsText,
  type StockQuote,
} from '../../../ai/ai-advisor/report-builders.js';
import { getBuildId } from '../../../shared/build-info.js';
import type { BondCardInfo } from '../../../ai/ai-advisor/structured-ai-recommendation.js';
import { DashboardReportBuilder } from '../../../../../components/dashboard/dashboard.js';
import { getMarkdownTemplate } from '../../../ai/ai-advisor/report-templates.js';
import { stripJsonBlockFromAiText } from '../../../ai/ai-advisor/json-sanitizer.js';
import { stripRecommendationsTableFromNarrative } from '../../../ai/ai-advisor/narrative-sanitizer.js';
import { restoreLostPercentRanges } from '../../../ai/ai-advisor/text-fixes.js';
import {
  applyPolicyToNarrative,
  isSellBlockedByPolicy,
  sanitizeBuyDirectivesForAction,
  sanitizePolicyCardText,
  normalizeLatexMarkup,
} from '../../../ai/ai-advisor/policy-text-guard.js';
import { PortfolioConfig } from '../../../../config/portfolio-config.js';
import { loadUserPolicy } from '../../../../config/user-policy.js';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type { PortfolioIncome } from './analysis-agent.js';
import {
  buildInteractiveOrders,
  type InteractiveOrder,
} from '../orders/interactive-orders.js';
import { resolveCardAction } from './strategy-validator.js';

/**
 * Единая точка санации AI-нарратива для обоих рендеров (Markdown и HTML).
 * Важно: sanitizer получает ВЕСЬ текст с сохранением переводов строк,
 * чтобы line-context режим мог связать тикер из заголовка с sell-строками ниже.
 */
function sanitizeNarrativeForDisplay(
  aiNarrative: string,
  assets: AssetAnalysis[],
): string {
  const policySafe = applyPolicyToNarrative(
    stripRecommendationsTableFromNarrative(
      stripJsonBlockFromAiText(aiNarrative),
    ),
    assets,
    loadUserPolicy(),
  );
  // Свободный текст тоже попадает в HTML/PDF: «510%» в нарративе
  // облигации чинится здесь, а не только в per-asset полях карточки.
  return (
    restoreLostPercentRanges(
      policySafe,
      PortfolioConfig.textFixes.maxPlausiblePct,
    ) ?? policySafe
  );
}

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
  private feedbackStats?: {
    total: number;
    userGood: number;
    userBad: number;
    factualCorrect: number;
    factualIncorrect: number;
    pending: number;
  };

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
    scenario?: ScenarioAgentOutput;
    strategist?: StrategistAgentOutput;
    consilium?: ConsiliumOutput;
    /** Статистика обратной связи по рекомендациям */
    feedbackStats?: {
      total: number;
      userGood: number;
      userBad: number;
      factualCorrect: number;
      factualIncorrect: number;
      pending: number;
    };
  }): Promise<NotificationAgentOutput> {
    // silent — отчёт генерируется в файлы, не в консоль

    const { data, analysis, ai, feedbackStats } = input;
    const { activeOrders, quotes } = data;
    const { portfolioAnalysis } = analysis;

    // Сохраняем статистику для использования в buildRecommendationsWithFeedback
    this.feedbackStats = feedbackStats;

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
        volumeTodayRub: q.volumeTodayRub,
        source: q.source,
        asOf: q.asOf,
      }),
    );

    // Строим DashboardReportBuilder с KPI-данными (единый вызов, без two-phase init)
    // C9 (Текущие активы) = ликвидационная (рыночная) стоимость позиций ОБОИХ счетов
    // (обычный + ИИС) + свободный рублёвый кэш из QUIK.
    // totalLiqValue = Σ aggregated[].totalLiquidationValue (цена × количество, все счета).
    // macroGoals.totalBalance (балансовая стоимость из Excel) как замена НЕ используется.
    const totalLiqValue = data.aggregated.reduce(
      (sum, a) => sum + (a.totalLiquidationValue || 0),
      0,
    );
    const marketValueUnavailable = !(totalLiqValue > 0);
    const currentAssets = marketValueUnavailable
      ? 0
      : Math.round((totalLiqValue + data.macroGoals.freeCash) * 100) / 100;
    const totalVal = currentAssets;
    // C11 (Чистый итог) = C9 − чистые вложенные средства (пересчитывается от C9).
    const totalNetProfitRub = marketValueUnavailable
      ? 0
      : Math.round((currentAssets - data.investedFunds.totalNet) * 100) / 100;
    const marketValueWarningHtml = marketValueUnavailable
      ? "<div style='margin-bottom:12px;padding:10px;border:1px solid #ff7b72;" +
        "border-radius:6px;background:rgba(255,123,114,0.08);color:#ff7b72;font-size:12px;'>" +
        '⚠️ Рыночная стоимость портфеля недоступна (нет котировок) — C9 и C11 не рассчитаны. ' +
        'Балансовая стоимость как замена не используется.</div>'
      : '';
    const aiBoxHtml = this.buildAiBoxHtml(analysis, ai, strategist);

    const reportBuilder = DashboardReportBuilder.fromOrdersAndAssets(
      orders,
      assetsAnalysis,
      stockQuotes,
      {
        totalVal,
        freeCash: data.macroGoals.freeCash,
        marketValueUnavailable,
        marketValueWarningHtml,
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
        buildId: getBuildId(),
        // Данные о взносах
        averageMonthlyDeposit: data.investedFunds.averageMonthlyDeposit,
        anomalousDepositsTotal: data.investedFunds.anomalousDepositsTotal,
        currentMonthDeposits: data.investedFunds.currentMonthDeposits,
        lastMonthDeposits: data.investedFunds.lastMonthDeposits,
        currentYearDeposits: data.investedFunds.currentYearDeposits,
        lastYearDeposits: data.investedFunds.lastYearDeposits,
        totalPurchases: data.investedFunds.totalPurchases,
        totalSales: data.investedFunds.totalSales,
        totalWithdrawals: data.investedFunds.totalWithdrawals,
        totalDeposits: data.investedFunds.totalDeposits,
        // XIRR
        xirr: data.xirr
          ? {
              rate: data.xirr.rate,
              reason: data.xirr.reason,
              withdrawalsHaveDates: data.xirr.withdrawalsHaveDates,
            }
          : undefined,
      },
      strategist?.strategies?.[0]?.steps,
    );

    // Предупреждения о ценах, которые не удалось нормализовать.
    const priceWarningsHtml =
      data.priceWarnings && data.priceWarnings.length > 0
        ? "<div style='margin-bottom:12px;padding:10px;border:1px solid #d29922;" +
          "border-radius:6px;background:rgba(210,153,34,0.08);color:#d29922;font-size:12px;'>" +
          '<div style="font-weight:bold;margin-bottom:4px;">⚠️ Цены требуют проверки:</div>' +
          data.priceWarnings
            .map((warning) => `<div>• ${this.escapeHtml(warning)}</div>`)
            .join('') +
          '</div>'
        : '';

    // Добавляем сценарии "что если" в HTML отчет
    let html = priceWarningsHtml + reportBuilder.buildHtml();

    if (scenario && scenario.scenarios.length > 0) {
      const scenarioHtml = this.buildScenarioSectionHtml(scenario);
      html += scenarioHtml;
    }

    // Добавляем стратега в HTML отчет
    if (strategist && strategist.decisions.length > 0) {
      const strategistHtml = this.buildStrategistSectionHtml(
        strategist,
        assetsAnalysis,
      );
      html += strategistHtml;
    }

    // Новостной фон убран — не несёт практической ценности для пользователя

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

    // Формируем Markdown-шаблон. Рыночная стоимость бумаг = Σ по обоим счетам.
    const totalLiqValue = data.aggregated.reduce(
      (sum, a) => sum + (a.totalLiquidationValue || 0),
      0,
    );
    const marketValueUnavailable = !(totalLiqValue > 0);
    const totalVal = totalLiqValue;
    const stocksPct = this.calcStocksPercent(assetsAnalysis);
    const bondsPct = this.calcBondsPercent(assetsAnalysis);

    // Действующие долевые позиции — из портфеля, а не из дивидендного листа.
    const stocksListText = buildActiveStockPositionsText(assetsAnalysis);

    // Fail-closed до визуального слоя: если источники дивидендов не ответили,
    // нельзя показывать «0 ₽» — это читается как «выплат нет».
    const dividendText = (value: number): string => {
      if (income.dividendDataStatus === 'UNAVAILABLE') return 'недоступно';
      if (income.dividendDataStatus === 'EMPTY') return 'нет данных';
      return `${value.toLocaleString('ru-RU')} ₽`;
    };
    const dividendStatusNote =
      income.dividendDataStatus === 'UNAVAILABLE'
        ? ' (источники MOEX ISS / smart-lab не ответили)'
        : income.dividendDataStatus === 'EMPTY'
          ? ' (источники ответили: подтверждённых выплат за 13 мес нет)'
          : income.dividendDataStatus === 'MIXED'
            ? ' (часть тикеров без подтверждённых данных)'
            : '';

    // Предупреждение о новых активах без целевой доли
    const newAssets = assetsAnalysis.filter((item) => item.status === 'NEW');
    // Предупреждения о ценах, которые не удалось нормализовать.
    const priceWarningsMd =
      data.priceWarnings && data.priceWarnings.length > 0
        ? '\n⚠️ **Цены требуют проверки:**\n\n' +
          data.priceWarnings.map((warning) => `• ${warning}`).join('\n') +
          '\n\n'
        : '';

    let newAssetsWarningMd = '';
    if (newAssets.length > 0) {
      newAssetsWarningMd =
        '\n⚠️ ВНИМАНИЕ: Обнаружены новые активы без указанной цели в Excel:\n' +
        newAssets
          .map(
            (item) =>
              `* ${item.name} (Укажите целевой % в столбце "Целевая доля, %")`,
          )
          .join('\n') +
        '\n';
    }

    const mdData = getMarkdownTemplate(
      new Date().toLocaleDateString('ru-RU'),
      marketValueUnavailable ? '—' : totalVal.toLocaleString('ru-RU'),
      macroGoals.freeCash.toLocaleString('ru-RU'),
      stocksPct,
      bondsPct,
      assetsListMd +
        newAssetsWarningMd +
        '\n' +
        priceAlertsMd +
        '\n\n### 💰 Доходность портфеля: НКД и дивиденды\n' +
        `* НКД по облигациям: **${income.totalNkd.toLocaleString('ru-RU')} ₽**\n` +
        (income.totalCouponsGross
          ? `* Купоны LTM (по графику MOEX ISS, чистые): **${(income.totalCouponsNet ?? 0).toLocaleString('ru-RU')} ₽** ` +
            `(грязные ${income.totalCouponsGross.toLocaleString('ru-RU')} ₽, ${income.couponBonds?.length ?? 0} бумаг, статус ${income.couponStatus ?? '—'})\n` +
            (income.couponWarnings && income.couponWarnings.length > 0
              ? income.couponWarnings.map((w) => `  ⚠️ ${w}`).join('\n') + '\n'
              : '')
          : '') +
        `* Фактические купоны по облигациям: **${income.stocks
          .filter((s) => s.kind !== 'LTM')
          .reduce((sum, s) => sum + s.grossIncome, 0)
          .toLocaleString('ru-RU')} ₽**\n` +
        `* Дивиденды LTM (чистые, после НДФЛ ${Math.round(PortfolioConfig.tax.dividendNdflRate * 100)}%): **${dividendText(income.totalDivsNet)}**${dividendStatusNote}\n` +
        ((income.declaredDivs ?? 0) > 0
          ? `* Объявленные будущие дивиденды (чистые): **${(income.declaredDivsNet ?? 0).toLocaleString('ru-RU')} ₽**\n`
          : '') +
        `* Итого чистый доход: **${(income.totalNkd + (income.totalCouponsNet ?? 0) + income.totalDivsNet).toLocaleString('ru-RU')} ₽** ` +
        `(НКД ${income.totalNkd.toLocaleString('ru-RU')} ₽` +
        (income.totalCouponsNet
          ? ` + купоны LTM ${(income.totalCouponsNet ?? 0).toLocaleString('ru-RU')} ₽`
          : '') +
        ` + дивиденды LTM ${income.totalDivsNet.toLocaleString('ru-RU')} ₽)` +
        (income.dividendDataStatus === 'UNAVAILABLE' ||
        income.dividendDataStatus === 'EMPTY'
          ? ' — дивидендная часть не подтверждена'
          : '') +
        '\n' +
        (income.stocks.length > 0
          ? '* Дивидендные позиции:\n' +
            income.stocks
              .map(
                (s) =>
                  `  - ${s.name} (${s.ticker}): ${s.quantity} шт. × ${s.rate.toLocaleString('ru-RU')} ₽ = ` +
                  `${s.grossIncome.toLocaleString('ru-RU')} ₽ грязными / ${s.netIncome.toLocaleString('ru-RU')} ₽ чистыми` +
                  (s.source
                    ? ` · ${s.source}${s.asOf ? ` (${s.asOf.slice(0, 10)})` : ''}`
                    : ''),
              )
              .join('\n') +
            '\n'
          : '') +
        (stocksListText
          ? `* Действующие долевые позиции: ${stocksListText}\n`
          : ''),
      getBuildId(),
    );

    // Добавляем AI-текст в конец Markdown
    // (очищенный от raw structured JSON и от таблицы рекомендаций —
    // narrative приходит уже чистым, здесь повторная страховка на display-слое)
    let md = marketValueUnavailable
      ? '⚠️ Рыночная стоимость портфеля недоступна (нет котировок) — балансовая стоимость как замена не используется.\n\n' +
        mdData
      : mdData;
    md = priceWarningsMd + md;
    if (ai.aiNarrative) {
      const cleanedText = sanitizeNarrativeForDisplay(
        ai.aiNarrative,
        analysis.portfolioAnalysis.assetsAnalysis,
      );
      if (cleanedText) {
        md += '\n\n---\n\n' + cleanedText;
      }
    }

    // Новостной фон убран — не несёт практической ценности для пользователя

    // Добавляем общий анализ портфеля от ИИ
    if (ai.portfolioSummary) {
      md += '\n\n---\n\n';
      md += '## 📊 Анализ ИИ-советника\n\n';
      md += ai.portfolioSummary + '\n\n';
    }

    // Добавляем сценарии "что если"
    if (scenario && scenario.scenarios.length > 0) {
      md += '\n\n---\n\n';
      md += this.buildScenarioSectionMd(scenario);
    }

    // Добавляем стратега
    if (strategist && strategist.decisions.length > 0) {
      md += '\n\n---\n\n';
      md += this.buildStrategistSectionMd(strategist, assetsAnalysis);
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
    // Fail-closed: при недоступности источника показываем статус, не «0 ₽».
    const dividendText = (value: number): string => {
      if (income.dividendDataStatus === 'UNAVAILABLE') return 'недоступно';
      if (income.dividendDataStatus === 'EMPTY') return 'нет данных';
      return fmt(value) + ' ₽';
    };
    const dividendSub = (base: string): string =>
      income.dividendDataStatus === 'UNAVAILABLE'
        ? 'источники MOEX ISS / smart-lab не ответили'
        : income.dividendDataStatus === 'EMPTY'
          ? 'подтверждённых выплат за 13 мес нет'
          : base;

    const card = (title: string, value: string, sub: string, color: string) =>
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;text-align:center;">' +
      `<div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:bold;margin-bottom:4px;">${title}</div>` +
      `<div style="font-size:18px;font-weight:bold;color:${color};">${value}</div>` +
      `<div style="font-size:11px;color:#8b949e;margin-top:4px;">${sub}</div>` +
      '</div>';

    console.log(
      `[DIVIDENDS_TILE] positions=${income.stocks.length} ` +
        `status=${income.dividendDataStatus ?? 'OK'} totalNet=${totalNet}`,
    );

    let html =
      // Плитка дохода не должна разрываться между страницами PDF: таблица
      // дивидендов уезжала отдельным блоком без заголовка.
      '<div style="margin-bottom:15px;padding:15px;background:#161b22;border:1px solid #30363d;border-radius:6px;page-break-inside:avoid;break-inside:avoid;">' +
      '<h3 style="margin:0 0 12px 0;font-size:14px;color:#fff;border-bottom:1px solid #30363d;padding-bottom:8px;">' +
      '💰 Доходность портфеля: НКД и дивиденды</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;">' +
      card(
        'НКД (облигации)',
        fmt(income.totalNkd) + ' ₽',
        'накопленный купонный доход',
        '#e3b341',
      ) +
      card(
        'Дивиденды LTM грязные',
        dividendText(income.totalDivs),
        dividendSub('полученные, до налога'),
        income.dividendDataStatus === 'OK' ||
          income.dividendDataStatus === 'MIXED' ||
          income.dividendDataStatus == null
          ? '#fff'
          : '#8b949e',
      ) +
      card(
        'Дивиденды LTM чистые',
        dividendText(income.totalDivsNet),
        dividendSub(`после НДФЛ ${Math.round(taxRate * 100)}%`),
        income.dividendDataStatus === 'OK' ||
          income.dividendDataStatus === 'MIXED' ||
          income.dividendDataStatus == null
          ? '#56d364'
          : '#8b949e',
      ) +
      card(
        'Итого чистый доход',
        fmt(totalNet) + ' ₽',
        'НКД + дивиденды LTM',
        '#58a6ff',
      ) +
      '</div>';

    if ((income.declaredDivs ?? 0) > 0) {
      html +=
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:12px;">' +
        card(
          'Ожидаемые дивиденды',
          fmt(income.declaredDivs ?? 0) + ' ₽',
          'объявленные форвардные выплаты, до налога',
          '#ffd166',
        ) +
        card(
          'Ожидаемые дивиденды чистые',
          fmt(income.declaredDivsNet ?? 0) + ' ₽',
          `после НДФЛ ${Math.round(taxRate * 100)}%, не входит в итог LTM`,
          '#ffd166',
        ) +
        '</div>';
    }

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
        '<div style="page-break-inside:avoid;break-inside:avoid;">' +
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
      html += '</tbody></table></div>';
    } else {
      const reason =
        (income.dividendWarnings ?? []).length > 0
          ? (income.dividendWarnings ?? []).join('; ')
          : 'дивидендная колонка не заполнена';
      html +=
        '<div style="color:#8b949e;font-size:12px;text-align:center;padding:8px;">' +
        `Дивиденды LTM не объявлены или не заполнены в Excel-файле (${reason})</div>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * Построить секцию структурированных рекомендаций с кнопками обратной связи.
   */
  /**
   * Санация per-asset поля карточки при активной no-sell политике.
   *
   * Работает БЕЗ условия policyBlocked: даже если upstream не успел пометить
   * карточку, sell-директивы по заблокированному тикеру не должны попадать
   * в отчёт. Пишет `[POLICY_TEXT] section=card ...` при реальной замене.
   */
  private sanitizeCardField(
    text: string | null | undefined,
    ticker: string,
    _asset: AssetAnalysis | undefined,
    field: string,
    action?: string | null,
    aiVote?: string | null,
  ): string | null {
    if (!text) return text ?? null;

    // Ремонт слипшихся диапазонов («510%» → «5–10%») — на слое рендера.
    const repaired = (value: string | null) =>
      restoreLostPercentRanges(
        value,
        PortfolioConfig.textFixes.maxPlausiblePct,
      );

    // ВСЕГДА чистим sell-директивы из model-текста, не только для no-sell.
    // Раньше санация вызывалась только при policyBlocked — для SBER и других
    // разрешённых тикеров модельные sell-директивы проходили в rationale
    // и секцию «Как покупать/продавать».
    const result = sanitizePolicyCardText(text, ticker);
    if (result.changed) {
      console.warn(
        `[POLICY_TEXT] section=card ticker=${ticker} field=${field}`,
      );
    }

    // Финальная сверка с действием, которое реально видит пользователь.
    // Действие карточки на рендере = resolveCardAction(strategist → math),
    // поэтому заглушка «ядро: HOLD» не должна оставаться при BUY, а
    // no-sell-шаблон допустим только для явного списка политики.
    let output = result.text;
    if (action) {
      const policy = loadUserPolicy();
      const buyClean = sanitizeBuyDirectivesForAction(
        output,
        ticker,
        action,
        aiVote ?? null,
        policy.noSellTickers,
      );
      if (buyClean.changed) {
        console.warn(
          `[POLICY_TEXT] section=card ticker=${ticker} field=${field} ` +
            `action=${action} rule=buy-directives`,
        );
        output = buyClean.text;
      }
    }
    return repaired(output);
  }

  private buildRecommendationsWithFeedback(
    ai: AiAgentOutput,
    assetsAnalysis: AssetAnalysis[] = [],
    strategist?: StrategistAgentOutput,
  ): string {
    const recs = ai.structuredRecommendations;
    if (!recs || recs.size === 0) {
      return '';
    }

    const stats = this.feedbackStats;

    let html =
      '<div class="recommendations-section" style="margin-top: 20px; padding: 15px; background: rgba(86, 211, 100, 0.05); border: 1px solid rgba(86, 211, 100, 0.3); border-radius: 8px;">\n';
    html +=
      '<h3 style="margin: 0 0 15px 0; color: #56d364; font-size: 16px;">📊 Рекомендации ИИ-советника</h3>\n';

    // Статистика обратной связи
    if (stats && stats.total > 0) {
      html +=
        '<div style="margin-bottom: 15px; padding: 10px; background: rgba(56, 139, 255, 0.08); border: 1px solid rgba(56, 139, 255, 0.2); border-radius: 6px; font-size: 12px;">\n';
      html +=
        '<div style="font-weight: bold; color: #58a6ff; margin-bottom: 6px;">📈 Статистика рекомендаций:</div>\n';
      html += '<div style="display: flex; gap: 15px; flex-wrap: wrap;">\n';
      html += `<div>👍 <b>${stats.userGood}</b> 👎 <b>${stats.userBad}</b> <span style="color: #8b949e;">(субъективно)</span></div>\n`;
      html += `<div>✅ <b>${stats.factualCorrect}</b> ❌ <b>${stats.factualIncorrect}</b> ⏳ <b>${stats.pending}</b> <span style="color: #8b949e;">(по факту через 30 дней)</span></div>\n`;
      html += '</div>\n';
      html += '</div>\n';
    }

    html +=
      '<div class="recommendations-list" style="display: flex; flex-direction: column; gap: 16px;">\n';

    for (const [ticker, rec] of recs) {
      // Действие карточки — единый источник: стратег → PortfolioMath → AI.
      // Раньше карточка брала действие напрямую из AI, из-за чего карточка
      // и стратегия говорили на разных языках в одном документе.
      const asset = assetsAnalysis.find(
        (candidate) => candidate.ticker.toUpperCase() === ticker.toUpperCase(),
      );
      const decision =
        strategist?.decisions.find(
          (candidate) =>
            candidate.ticker.toUpperCase() === ticker.toUpperCase(),
        ) ?? null;
      const aiAction = rec.recommendedAction;
      const cardAction = asset ? resolveCardAction(asset, decision) : aiAction;
      const action = cardAction ?? aiAction ?? 'HOLD';
      // BUY, отложенный из-за нехватки кэша, показывается как «Докупать из
      // ежемесячного взноса», а не как «Держать»: действие математики — BUY,
      // но исполняется оно из пополнения, а не из свободного кэша.
      const deferredBuyRub = rec.deferredBuyRub ?? null;
      const monthlyContributionRub = rec.monthlyContributionRub ?? null;
      const deferredAmount =
        monthlyContributionRub !== null && monthlyContributionRub > 0
          ? monthlyContributionRub
          : deferredBuyRub;
      const deferredLabel =
        deferredBuyRub !== null && deferredAmount !== null
          ? `🟢 Докупать из ежемесячного взноса (${Math.round(
              deferredAmount,
            ).toLocaleString('ru-RU')} ₽/мес)`
          : null;
      const actionMismatch =
        deferredBuyRub === null &&
        aiAction !== null &&
        cardAction !== null &&
        aiAction !== cardAction;
      // confidence от модели — НЕ вероятность. Показываем raw + clamped.
      const confidenceRaw =
        ((rec as unknown as Record<string, unknown>).confidenceRaw as
          number | undefined) ?? rec.confidence;
      const confidenceClamped = rec.confidence;
      const confidenceClampedApplied =
        confidenceRaw !== null &&
        confidenceClamped !== null &&
        confidenceRaw !== confidenceClamped;

      let confidenceDisplay = '';
      if (confidenceClamped !== null && confidenceClamped !== undefined) {
        const clampedPercent = Math.round(confidenceClamped * 100);
        if (confidenceClampedApplied) {
          const rawPercent = Math.round(confidenceRaw * 100);
          confidenceDisplay = ` · оценка модели: ${clampedPercent}% (raw: ${rawPercent}%, макро устарело)`;
        } else {
          confidenceDisplay = ` · оценка модели: ${clampedPercent}% (не вероятность)`;
        }
      }
      const catalystsCount = rec.keyCatalysts?.length ?? 0;
      const risksCount = rec.keyRisks?.length ?? 0;
      const argumentBalance = `Аргументы за/против: ${catalystsCount}/${risksCount}`;
      const actionColor =
        deferredLabel !== null || action === 'BUY'
          ? '#56d364'
          : action === 'SELL' || action === 'REDUCE'
            ? '#ff7b72'
            : '#ffd166';
      const actionLabel =
        deferredLabel ??
        (action === 'BUY'
          ? '🟢 Покупать'
          : action === 'SELL' || action === 'REDUCE'
            ? '🔴 Продавать'
            : '🟡 Держать');
      // Баннер no-sell — только когда действие действительно было
      // sell/reduce и заменено политикой. При BUY/HOLD (например,
      // АЛРОСА1Р1: «Покупать» + no-sell) баннер не показывается:
      // покупка политикой не запрещена.
      const policyBlocked = rec.policyBlocked === true;
      const displayRationale = normalizeLatexMarkup(
        this.sanitizeCardField(
          rec.rationale,
          ticker,
          asset,
          'rationale',
          action,
          aiAction,
        ),
      );

      html +=
        '<div class="recommendation-item" style="padding: 20px 24px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; border-left: 4px solid ' +
        actionColor +
        '; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">\n';

      // ─── Шапка карточки: тикер, действие, метаданные ───
      html +=
        '<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.06);">\n';
      html += '<div style="flex: 1;">\n';
      html +=
        '<div style="font-weight: 700; color: #e6edf3; font-size: 16px; line-height: 1.3;">' +
        ticker +
        (rec.name
          ? ' <span style="color: #8b949e; font-weight: 400;">— ' +
            rec.name +
            '</span>'
          : '') +
        '</div>\n';
      html +=
        '<div style="color: ' +
        actionColor +
        '; font-size: 14px; font-weight: 600; margin-top: 4px;">' +
        actionLabel +
        '</div>\n';
      if (actionMismatch && asset) {
        const deviationPp =
          asset.currentPercent - (asset.targetPercent ?? asset.currentPercent);
        html +=
          '<div style="color: #d29922; font-size: 11px; margin-top: 6px; padding: 4px 8px; background: rgba(210,153,34,0.08); border-radius: 4px; display: inline-block;">' +
          `⚠️ Расхождение сигналов: AI — ${aiAction}, PortfolioMath — ${asset.status} ` +
          `(${deviationPp > 0 ? '+' : ''}${deviationPp.toFixed(1).replace('.', ',')} п.п.)` +
          '</div>\n';
      }
      if (policyBlocked) {
        const policyText =
          rec.policyNote && rec.policyNote.trim().length > 0
            ? rec.policyNote
            : 'Заблокировано политикой no-sell';
        html +=
          '<div style="margin-top: 6px; padding: 5px 10px; background: rgba(255,123,114,0.08); ' +
          'border: 1px solid rgba(255,123,114,0.25); border-radius: 5px; ' +
          `color: #ff7b72; font-size: 11px; display: inline-block;">⛔ ${policyText}</div>\n`;
      }
      if (asset?.holdOnly === true && !policyBlocked) {
        html +=
          '<div style="margin-top: 6px; padding: 5px 10px; background: rgba(255,209,102,0.08); ' +
          'border: 1px solid rgba(255,209,102,0.25); border-radius: 5px; ' +
          'color: #ffd166; font-size: 11px; display: inline-block;">' +
          '\u25CF Позиция только для удержания (holdOnly)</div>\n';
      }
      // Концентрация — отдельное предупреждение, не путать с confidence модели.
      if (asset?.isConcentrated === true) {
        html +=
          '<div style="margin-top: 6px; padding: 5px 10px; background: rgba(255,165,0,0.08); ' +
          'border: 1px solid rgba(255,165,0,0.25); border-radius: 5px; ' +
          'color: #ffa500; font-size: 11px; display: inline-block;">' +
          `⚠️ Концентрация: ${asset.currentPercent.toFixed(1)}% портфеля (лимит 20%)</div>\n`;
      }
      html += '</div>\n';
      // Метаданные справа
      html +=
        '<div style="text-align: right; flex-shrink: 0; min-width: 140px;">\n';
      html +=
        '<div style="color: #8b949e; font-size: 11px; margin-bottom: 4px;">' +
        argumentBalance +
        '</div>\n';
      if (confidenceDisplay) {
        html +=
          '<div style="color: #6e7681; font-size: 10px; line-height: 1.3;">' +
          confidenceDisplay +
          '</div>\n';
      }
      html += '</div>\n';
      html += '</div>\n';

      // ─── Секция: Обоснование ───
      if (displayRationale) {
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(88,166,255,0.03); border: 1px solid rgba(88,166,255,0.1); border-radius: 7px;">\n';
        html +=
          '<div style="color: #58a6ff; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">💡 Обоснование</div>\n';
        html +=
          '<div style="color: #c9d1d9; font-size: 13px; line-height: 1.65;">' +
          displayRationale +
          '</div>\n';
        html += '</div>\n';
      }

      // ─── Фундаментальный анализ ───
      const fundamentalAnalysis = (
        rec as { fundamentalAnalysis?: string | null }
      ).fundamentalAnalysis;
      const displayFundamentalAnalysis = normalizeLatexMarkup(
        this.sanitizeCardField(
          fundamentalAnalysis,
          ticker,
          asset,
          'fundamentalAnalysis',
          action,
          aiAction,
        ),
      );
      if (displayFundamentalAnalysis) {
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(88,166,255,0.03); border: 1px solid rgba(88,166,255,0.1); border-radius: 7px;">\n';
        html +=
          '<div style="color: #58a6ff; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">📊 Фундаментал</div>\n';
        html +=
          '<div style="color: #c9d1d9; font-size: 13px; line-height: 1.65;">' +
          displayFundamentalAnalysis +
          '</div>\n';
        html += '</div>\n';
      }

      // ─── Ликвидность (для акций и облигаций, детерминированно) ───
      const liquidityLevel = (rec as { liquidityLevel?: string })
        .liquidityLevel;
      const dailyTurnover = (rec as { dailyTurnover?: number | null })
        .dailyTurnover;
      const liquidationDays = (rec as { liquidationDays?: number | null })
        .liquidationDays;
      if (liquidityLevel && liquidityLevel !== 'UNKNOWN') {
        const levelEmoji: Record<string, string> = {
          HIGH: '🟢',
          MEDIUM: '🟡',
          LOW: '🟠',
          CRITICAL: '🔴',
        };
        const levelLabel: Record<string, string> = {
          HIGH: 'Высокая',
          MEDIUM: 'Средняя',
          LOW: 'Низкая',
          CRITICAL: 'Критическая',
        };
        const emoji = levelEmoji[liquidityLevel] || '⚪';
        const label = levelLabel[liquidityLevel] || liquidityLevel;
        let liquidityText = `${emoji} Ликвидность: ${label}`;
        if (dailyTurnover != null && dailyTurnover > 0) {
          const turnoverFormatted =
            dailyTurnover >= 1e9
              ? `${(dailyTurnover / 1e9).toFixed(1)} млрд ₽`
              : dailyTurnover >= 1e6
                ? `${(dailyTurnover / 1e6).toFixed(0)} млн ₽`
                : `${dailyTurnover.toLocaleString('ru-RU')} ₽`;
          liquidityText += ` — оборот ${turnoverFormatted}/день`;
        }
        if (liquidationDays != null && liquidationDays > 0) {
          liquidityText += `, продажа за ${liquidationDays} дн.`;
        }
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(86,211,100,0.03); border: 1px solid rgba(86,211,100,0.1); border-radius: 7px;">\n';
        html +=
          '<div style="color: #58a6ff; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">💧 Ликвидность</div>\n';
        html +=
          '<div style="color: #c9d1d9; font-size: 13px; line-height: 1.65;">' +
          liquidityText +
          '</div>\n';
        html += '</div>\n';
      }

      // ─── Предупреждение: неизвестная ликвидность ───
      if (liquidityLevel === 'UNKNOWN') {
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(210,153,34,0.04); border: 1px solid rgba(210,153,34,0.15); border-radius: 7px;">\n';
        html +=
          '<div style="color: #58a6ff; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">⚠️ Ликвидность</div>\n';
        html +=
          '<div style="color: #d29922; font-size: 13px; line-height: 1.65;">' +
          'Нет данных по обороту — проверьте столбец «Оборот» в листе «Акции» Excel.' +
          '</div>\n';
        html += '</div>\n';
      }

      // ─── Облигация: тип купона и кредитный статус (детерминированно) ───
      const bondCard = (rec as { bondCard?: BondCardInfo | null }).bondCard;
      if (bondCard) {
        const floating =
          bondCard.couponType === 'FLOATER' ||
          bondCard.couponType === 'MICROFIX';
        // Атрибуция даты: Excel (дата файла) / MOEX ISS / smart-lab.
        const nextCouponSourceNote =
          bondCard.nextCouponDateSource === 'EXCEL'
            ? ', EXCEL, дата файла'
            : bondCard.nextCouponDateSource === 'MOEX_ISS'
              ? ', MOEX ISS'
              : bondCard.nextCouponDateSource === 'SMART_LAB'
                ? ', smart-lab'
                : '';
        const nextCoupon = bondCard.nextCouponDate
          ? `${new Date(bondCard.nextCouponDate).toLocaleDateString('ru-RU')}${nextCouponSourceNote}`
          : bondCard.nextCouponDateSource
            ? `дата не найдена (источник: ${bondCard.nextCouponDateSource})`
            : 'дата не указана (нет NEXTCOUPON в Excel/ISS/smart-lab)';

        // Срез карточки в лог: видно, почему тип/дата именно такие.
        console.log(
          `[BOND_CARD] isin=${bondCard.isin} couponType=${bondCard.couponType} ` +
            `reason=${bondCard.couponTypeReason ?? 'none'} ` +
            `nextCouponDate=${bondCard.nextCouponDate ?? 'null'} ` +
            `source=${bondCard.nextCouponDateSource ?? 'none'}`,
        );

        const couponUnknown = bondCard.couponType === 'UNKNOWN';
        const isZeroCoupon = bondCard.couponType === 'ZERO_COUPON';
        const unknownReason =
          bondCard.couponTypeReason === 'excel_conflict'
            ? (bondCard.couponTypeReasonDetail ??
              'конфликт источников: Excel FIXED против подтверждённого FLOATER')
            : bondCard.couponTypeReason === 'ofz_no_coupon'
              ? 'в источнике нет размера купона для ОФЗ-ПД (серия 25/26xxx)'
              : bondCard.couponTypeReason === 'type_unconfirmed'
                ? (bondCard.couponTypeReasonDetail ??
                  'тип купона не подтверждён ни ISS, ни серией')
                : 'источник не подтвердил условия выпуска';

        // Источник типа купона: ISS (description) / серия / Excel.
        const couponSourceNote = bondCard.couponTypeSource
          ? `, подтверждено: ${bondCard.couponTypeSource}`
          : '';

        // У бескупонной бумаги не бывает следующей выплаты — оксюморон.
        const nextCouponDisplay = isZeroCoupon
          ? '— (бескупонная бумага)'
          : nextCoupon;

        const couponLine = isZeroCoupon
          ? `Купон: бескупонная (${bondCard.couponType}${couponSourceNote}); следующая выплата: ${nextCouponDisplay}`
          : couponUnknown
            ? `Купон: тип не подтверждён (UNKNOWN) — причина: ${unknownReason}; следующая выплата: ${nextCouponDisplay}`
            : floating
              ? `Купон плавающий (${bondCard.couponType}${couponSourceNote})` +
                (bondCard.floatIndex
                  ? `, привязан к ${bondCard.floatIndex}`
                  : '') +
                (bondCard.floatSpreadPct != null
                  ? ` + ${bondCard.floatSpreadPct}%`
                  : '') +
                `; следующая выплата: ${nextCouponDisplay}`
              : `Купон фиксированный (${bondCard.couponType}${couponSourceNote}); ` +
                `следующая выплата: ${nextCouponDisplay}`;
        // Пункт 3 в рендере: при UNKNOWN + MISSING — «нет подтверждённых данных».
        const isUnknownCoupon = bondCard.couponType === 'UNKNOWN';
        // Атрибуция источника доходности
        const yieldSourceLabel = (() => {
          switch (bondCard.yieldSource) {
            case 'SMART_LAB_PROBE':
              return ` (Smart-Lab, ${new Date().toLocaleDateString('ru-RU')})`;
            case 'EXCEL_COLUMN':
              return ' (Excel, колонка доходности)';
            case 'EXCEL_COMPUTED':
              return ' (Excel, вычислено)';
            default:
              return '';
          }
        })();
        const yieldLine = floating
          ? `Текущая доходность: ${
              bondCard.currentYield != null
                ? bondCard.currentYield.toFixed(2) + '%'
                : 'недоступна'
            }. YTM — проекция при предположении неизменной ставки ` +
            `(методика: ${bondCard.ytmMethod ?? 'FLOATER_ASSUMED_CONSTANT_RATE'}), ` +
            'не доходность к погашению.' +
            yieldSourceLabel
          : bondCard.dataQuality === 'MISSING' ||
              (isUnknownCoupon && bondCard.dataQuality === 'PARTIAL')
            ? 'Нет подтверждённых данных по доходности'
            : bondCard.ytm != null
              ? `Доходность к погашению: ${bondCard.ytm.toFixed(2)}%` +
                (bondCard.ytmMethod
                  ? ` (методика: ${bondCard.ytmMethod})`
                  : '') +
                yieldSourceLabel
              : 'Доходность к погашению: недоступна';
        const ratingLine = bondCard.creditRating
          ? `Рейтинг ${bondCard.creditRating.agency}: ${bondCard.creditRating.rating} (прогноз: ${bondCard.creditRating.outlook})`
          : 'Рейтинг: нет подтверждённых данных';
        const creditAsOf = bondCard.creditAsOf
          ? new Date(bondCard.creditAsOf).toLocaleDateString('ru-RU')
          : 'дата не указана';
        const creditLine =
          `Кредитное качество: ${bondCard.creditQuality} ` +
          `(${bondCard.creditSource}, ${creditAsOf})`;
        const defaultFlag =
          bondCard.creditRating?.outlook?.toUpperCase().includes('DEFAULT') ||
          bondCard.creditQuality === 'LOW';

        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(210,153,34,0.04); border: 1px solid rgba(210,153,34,0.12); border-radius: 7px;">\n';
        html +=
          '<div style="color: #d29922; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">📜 Облигация</div>\n';
        // Две оценки: балансовая (Excel/QUIK) и ликвидационная (C9/MOEX) — раздельно.
        const priceLines: string[] = [];
        if (bondCard) {
          const bal = (rec as { balancePrice?: number }).balancePrice;
          const cur = (rec as { currentPrice?: number | null }).currentPrice;
          if (bal != null && bal > 0)
            priceLines.push(
              `Балансовая стоимость (Excel): ${bal.toLocaleString('ru-RU')} ₽`,
            );
          if (cur != null && cur > 0)
            priceLines.push(
              `Ликвидационная стоимость (C9): ${cur.toLocaleString('ru-RU')} ₽`,
            );
        }
        // Поле ликвидности
        const liquidityLine = (() => {
          if (
            bondCard.turnoverFromSmartLab != null &&
            bondCard.turnoverFromSmartLab > 0
          ) {
            return `Ликвидность: оборот ${bondCard.turnoverFromSmartLab.toLocaleString('ru-RU')} млн руб./день`;
          }
          return 'Ликвидность: нет данных по обороту';
        })();
        html +=
          '<div style="color: #c9d1d9; line-height: 1.65;">' +
          couponLine +
          (priceLines.length > 0 ? '<br>' + priceLines.join('<br>') : '') +
          '<br>' +
          yieldLine +
          '<br>' +
          liquidityLine +
          '<br>' +
          creditLine +
          '<br>' +
          ratingLine +
          '</div>\n';
        if (defaultFlag) {
          html +=
            '<div style="color: #ff7b72; margin-top: 8px; padding: 6px 8px; background: rgba(255,123,114,0.06); border-radius: 4px; font-weight: 600; font-size: 11px;">⛔ Дефолт/реструктуризация: покупка запрещена, высокая доходность — компенсация кредитного риска</div>\n';
        }
        html += '</div>\n';
      }

      // ─── Расширенные данные из Excel ───
      const minPrice = (rec as { minPrice?: number | null }).minPrice;
      const maxPrice = (rec as { maxPrice?: number | null }).maxPrice;
      const ratingTotal = (rec as { ratingTotal?: number | null }).ratingTotal;
      const rangePosition = (rec as { rangePosition?: number | null })
        .rangePosition;
      const entrySignal = (rec as { entrySignal?: string | null }).entrySignal;
      const ratingDynamic = (rec as { ratingDynamic?: number | null })
        .ratingDynamic;
      const ratingVolume = (rec as { ratingVolume?: number | null })
        .ratingVolume;

      if (
        minPrice != null ||
        maxPrice != null ||
        ratingTotal != null ||
        entrySignal != null
      ) {
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(139,148,158,0.04); border: 1px solid rgba(139,148,158,0.12); border-radius: 7px;">\n';
        html +=
          '<div style="color: #58a6ff; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">📋 Данные Excel</div>\n';
        html +=
          '<div style="color: #c9d1d9; font-size: 13px; line-height: 1.65;">';

        const parts: string[] = [];
        if (minPrice != null && maxPrice != null) {
          parts.push(
            `Диапазон: ${minPrice.toFixed(2)}–${maxPrice.toFixed(2)} ₽`,
          );
        }
        if (rangePosition != null && rangePosition > 0) {
          parts.push(`Позиция в диапазоне: ${rangePosition.toFixed(0)}%`);
        }
        if (ratingTotal != null && ratingTotal > 0) {
          parts.push(`Общий рейтинг: ${ratingTotal}/100`);
        }
        if (ratingDynamic != null && ratingDynamic > 0) {
          parts.push(`Рейтинг динамики: ${ratingDynamic}/100`);
        }
        if (ratingVolume != null && ratingVolume > 0) {
          parts.push(`Рейтинг объёма: ${ratingVolume}/100`);
        }
        if (entrySignal) {
          const signalColor = entrySignal.toLowerCase().includes('выгодн')
            ? '#56d364'
            : entrySignal.toLowerCase().includes('нейтрал')
              ? '#ffd166'
              : '#c9d1d9';
          parts.push(
            `<span style="color: ${signalColor}; font-weight: 600;">Сигнал входа: ${entrySignal}</span>`,
          );
        }

        if (parts.length > 0) {
          html += parts.join(' · ');
        } else {
          html += 'Нет данных';
        }

        html += '</div>\n';
        html += '</div>\n';
      }

      // ─── Технический timing ───
      const technicalTiming = (rec as { technicalTiming?: string | null })
        .technicalTiming;
      if (technicalTiming) {
        // Defense-in-depth: policy-blocked карточка не должна показывать
        // «точку для фиксации части прибыли» даже если upstream не успел.
        const displayTechnicalTiming = normalizeLatexMarkup(
          this.sanitizeCardField(
            technicalTiming,
            ticker,
            asset,
            'technicalTiming',
            action,
            aiAction,
          ) ?? technicalTiming,
        );
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(227,179,65,0.04); border: 1px solid rgba(227,179,65,0.12); border-radius: 7px;">\n';
        html +=
          '<div style="color: #e3b341; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">🎯 Лучшая точка для сделки</div>\n';
        html +=
          '<div style="color: #c9d1d9; font-size: 13px; line-height: 1.65;">' +
          displayTechnicalTiming +
          '</div>\n';
        html += '</div>\n';
      }

      // ─── Стратегия входа/выхода ───
      const entryStrategy = (rec as { entryStrategy?: string | null })
        .entryStrategy;
      if (entryStrategy) {
        // Defense-in-depth: даже если upstream не успел почистить текст,
        // для policy-blocked карточки sell-директивы не показываем.
        const displayEntryStrategy = normalizeLatexMarkup(
          this.sanitizeCardField(
            entryStrategy,
            ticker,
            asset,
            'entryStrategy',
            action,
            aiAction,
          ) ?? entryStrategy,
        );
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(163,113,247,0.04); border: 1px solid rgba(163,113,247,0.12); border-radius: 7px;">\n';
        html +=
          '<div style="color: #a371f7; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">📈 Как покупать/продавать</div>\n';
        html +=
          '<div style="color: #c9d1d9; font-size: 13px; line-height: 1.65;">' +
          displayEntryStrategy +
          '</div>\n';
        html += '</div>\n';
      }

      // ─── Контекст эмитента ───
      const issuerContext = (rec as { issuerContext?: string | null })
        .issuerContext;
      const displayIssuerContext = normalizeLatexMarkup(
        this.sanitizeCardField(
          issuerContext,
          ticker,
          asset,
          'issuerContext',
          action,
          aiAction,
        ),
      );
      if (displayIssuerContext) {
        html +=
          '<div style="margin-bottom: 14px; padding: 12px 14px; background: rgba(86,211,100,0.04); border: 1px solid rgba(86,211,100,0.12); border-radius: 7px;">\n';
        html +=
          '<div style="color: #56d364; font-weight: 600; font-size: 12px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">🏢 Контекст эмитента</div>\n';
        html +=
          '<div style="color: #c9d1d9; font-size: 13px; line-height: 1.65;">' +
          displayIssuerContext +
          '</div>\n';
        html += '</div>\n';
      }

      html += '</div>\n';
      // ─── Кнопки обратной связи ───
      html +=
        '<div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 8px;">\n';
      html +=
        '<button class="feedback-btn feedback-good" data-ticker="' +
        ticker +
        '" data-action="good" style="background: rgba(86, 211, 100, 0.1); border: 1px solid rgba(86, 211, 100, 0.3); color: #56d364; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.2s;">👍</button>\n';
      html +=
        '<button class="feedback-btn feedback-bad" data-ticker="' +
        ticker +
        '" data-action="bad" style="background: rgba(255, 123, 114, 0.1); border: 1px solid rgba(255, 123, 114, 0.3); color: #ff7b72; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; transition: all 0.2s;">👎</button>\n';
      html += '</div>\n';
      html += '</div>\n';
    }

    html += '</div>\n';
    html +=
      '<div style="margin-top: 10px; font-size: 11px; color: #8b949e;">Оцените рекомендации: 👍 если рекомендация верна, 👎 если нет. Это поможет улучшить анализ в будущем.</div>\n';
    html += '</div>\n';

    return html;
  }

  private buildAiBoxHtml(
    analysis: AnalysisAgentOutput,
    ai: AiAgentOutput,
    strategist?: StrategistAgentOutput,
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
        '. Пожалуйста, пропишите желаемый процент в столбце "Целевая доля, %" вашей Excel-таблицы.</div>\n\n';
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
      // Легенда: расхождение направлений — справочное. Без неё пользователь
      // воспринимает DIRECTION_CONFLICT как смену рекомендации карточки.
      if (
        ai.validationWarnings.some((warning) =>
          warning.startsWith('[DIRECTION_CONFLICT]'),
        )
      ) {
        html +=
          '<div style="color: #8b949e; font-size: 12px; margin: 4px 0 6px;">' +
          'Конфликты направлений носят справочный характер: итоговое действие ' +
          'в карточке определяется расчётным ядром PortfolioMath, направление ' +
          'ИИ — мнение модели для ручной проверки.</div>\n';
      }
      for (const warning of ai.validationWarnings) {
        html += `- ${normalizeLatexMarkup(warning) ?? warning}\n`;
      }
      html += '\n';
    }

    // ── Общий анализ портфеля (portfolioSummary) ──
    if (ai.portfolioSummary) {
      // Конвертируем \n в <br> для корректного отображения абзацев
      const formattedSummary = ai.portfolioSummary
        .replace(/\\n/g, '\n')
        .replace(/\n/g, '<br>');
      html +=
        '<div style="margin-bottom: 20px; padding: 15px; background: rgba(88, 166, 255, 0.05); border: 1px solid rgba(88, 166, 255, 0.2); border-radius: 6px;">' +
        '<h3 style="margin: 0 0 12px 0; color: #58a6ff; font-size: 15px;">📊 Общий анализ портфеля</h3>' +
        '<div style="font-size: 13px; color: #c9d1d9; line-height: 1.65;">' +
        formattedSummary +
        '</div></div>\n';
    }

    // ── Структурированные рекомендации с кнопками обратной связи ──
    html += this.buildRecommendationsWithFeedback(
      ai,
      analysis.portfolioAnalysis.assetsAnalysis,
      strategist,
    );

    // AI-текст (raw structured JSON никогда не должен попадать в дашборд —
    // stripJsonBlockFromAiText удаляет ```json / {"ticker": ...} блоки)
    // Таблица рекомендаций по активам тоже удаляется: её дублируют
    // структурированные карточки, собранные из валидированного JSON.
    const aiText = sanitizeNarrativeForDisplay(
      ai.aiNarrative,
      analysis.portfolioAnalysis.assetsAnalysis,
    );
    html += this.convertMarkdownTablesToHtml(aiText);

    return html;
  }

  /**
   * Преобразует Markdown-таблицы в тексте в HTML-таблицы <table>.
   * Позволяет корректно переносить таблицу между страницами при печати в PDF.
   *
   * Алгоритм:
   * 1. Находим блок, начинающийся с | и содержащий строку-разделитель (| :--- |).
   * 2. Склейка разорванных строк: если строка начинается с | но не заканчивается на |,
   *    присоединяем следующую строку через пробел.
   * 3. Первая строка → <thead>, строка-разделитель → пропускаем, остальные → <tbody>.
   */
  private convertMarkdownTablesToHtml(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;

      // Проверяем, начинается ли строка с | (возможная таблица)
      if (line.trimStart().startsWith('|')) {
        // Ищем строку-разделитель в ближайших строках
        let sepIdx = -1;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (/^\|?[\s:|-]+\|?\s*$/.test(lines[j]!)) {
            sepIdx = j;
            break;
          }
        }

        if (sepIdx > i + 1) {
          // Нашли таблицу: от i до sepIdx — заголовок, sepIdx+1 — тело
          const headerLine = this.joinBrokenLines(
            lines[i]!,
            lines[i + 1] ?? '',
          );
          const headers = this.parseTableRow(headerLine);

          // Склеиваем тело таблицы
          const bodyLines: string[] = [];
          let k = sepIdx + 1;
          while (k < lines.length) {
            const bLine = lines[k]!;
            // Конец таблицы: строка не начинается с | или пустая
            if (!bLine.trimStart().startsWith('|') || bLine.trim() === '')
              break;
            bodyLines.push(bLine);
            k++;
          }

          // Склейка разорванных строк в теле
          const joinedBody: string[] = [];
          for (const bl of bodyLines) {
            if (bl.trimStart().startsWith('|') && !bl.trimEnd().endsWith('|')) {
              // Строка разорвана — склеиваем с предыдущей
              if (joinedBody.length > 0) {
                joinedBody[joinedBody.length - 1] =
                  joinedBody[joinedBody.length - 1]! + ' ' + bl.trim();
              }
            } else {
              joinedBody.push(bl);
            }
          }

          // Генерируем HTML-таблицу
          let htmlTable =
            '<table class="ai-narrative-table" style="width:100%;border-collapse:collapse;margin:12px 0;font-size:12px;">';
          htmlTable += '<thead><tr>';
          for (const h of headers) {
            htmlTable +=
              '<th style="background-color:#f6f8fa;color:#24292f;font-weight:600;padding:6px 8px;text-align:left;border:1px solid #d0d7de;font-size:12px;">' +
              this.escapeHtml(h) +
              '</th>';
          }
          htmlTable += '</tr></thead><tbody>';

          for (const bl of joinedBody) {
            const cells = this.parseTableRow(bl);
            if (cells.length === 0) continue;
            htmlTable += '<tr>';
            for (const cell of cells) {
              htmlTable +=
                '<td style="padding:6px 8px;border:1px solid #d0d7de;text-align:left;font-size:12px;">' +
                this.escapeHtml(cell) +
                '</td>';
            }
            htmlTable += '</tr>';
          }
          htmlTable += '</tbody></table>';

          result.push(htmlTable);
          i = k; // Пропускаем все строки таблицы
          continue;
        }
      }

      result.push(line);
      i++;
    }

    return result.join('\n');
  }

  /**
   * Склейка разорванной строки таблицы с следующей.
   * Если line не заканчивается на |, присоединяем next через пробел.
   */
  private joinBrokenLines(line: string, next: string): string {
    if (line.trimEnd().endsWith('|')) return line;
    return line.trimEnd() + ' ' + next.trimStart();
  }

  /**
   * Парсит строку Markdown-таблицы в массив ячеек.
   */
  private parseTableRow(line: string): string[] {
    const parts = line.split('|');
    // Убираем пустые элементы в начале и конце (от ведущих/ведущих |)
    let start = 0;
    if (parts[0]!.trim() === '') start = 1;
    let end = parts.length - 1;
    if (parts[end]!.trim() === '') end = parts.length - 2;
    return parts.slice(start, end + 1).map((c) => c.trim());
  }

  /**
   * Экранирует HTML-сущности в содержимом ячейки.
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

    let md = '## 📊 Анализ сценариев и рекомендации\n\n';

    // Введение
    md +=
      'Этот блок показывает, как изменения в структуре портфеля могут повлиять на ваш результат. ' +
      'Каждый сценарий оценивает конкретное действие — покупку, продажу или удержание активов.\n\n';

    // Сводка
    md += '**Ключевые показатели:**\n\n';
    md += `- Всего рассмотрено вариантов: ${scenario.summary.scenariosBuilt}\n`;
    md += `- Лучшее улучшение: +${fmtPct(scenario.summary.bestImprovementPct)}\n`;
    md += `- Текущее отклонение от цели: ${fmtPct(scenario.summary.baselineDeviationPct)}\n\n`;

    // Таблица сценариев — упрощённая и понятная
    md +=
      '| Вариант | Что произойдёт | Влияние на портфель | P&L (unrealized + realized) |\n';
    md += '|---------|---------------|---------------------|-------------|\n';

    for (const s of scenario.scenarios) {
      const bestMarker =
        s.id === scenario.bestScenarioId ? ' ⭐ **Рекомендуем**' : '';
      // «Структура улучшается, P&L нейтрально»: IMPROVES по структуре,
      // но отклонение совокупного P&L от baseline в пределах 1000 ₽.
      const pnlNeutral =
        s.verdict === 'IMPROVES' && Math.abs(s.pnlDeltaVsBaselineRub) <= 1000;
      const verdictIcon = pnlNeutral
        ? '📈 Структура улучшается, P&L нейтрально'
        : s.verdict === 'IMPROVES'
          ? '📈 Улучшает'
          : s.verdict === 'WORSENS'
            ? '📉 Ухудшает'
            : '➡️ Нейтральный';

      // ИСПРАВЛЕНИЕ Этап 2.1: показываем PARTIAL/INSUFFICIENT_DATA вместо 0.
      // P&L — единый totalPnLRub (unrealized + realized).
      const totalPnl = s.totalPnLRub;
      const isPnlNotCalculated = s.pnlCalculationStatus === 'INSUFFICIENT_DATA';
      const isPnlPartial = s.pnlCalculationStatus === 'PARTIAL';
      const pnlDisplay = isPnlNotCalculated ? 'Нет данных' : fmtRub(totalPnl);
      const pnlColor = !isPnlNotCalculated && totalPnl >= 0 ? '✅' : '⚠️';

      md += `| ${s.title}${bestMarker} | ${verdictIcon} | ${fmtPct(s.structureDeviationPct)} от цели | ${pnlColor} ${pnlDisplay}${isPnlPartial ? ' (частично)' : ''} |\n`;

      if (s.rationale) {
        md += `| _${s.rationale}_ | | | |\n`;
      }
    }

    // Рекомендация
    const bestScenario = scenario.scenarios.find(
      (s) => s.id === scenario.bestScenarioId,
    );
    if (bestScenario) {
      md += '\n**💡 Рекомендация:** ';
      md += `Сценарий «${bestScenario.title}» показывает лучший результат. `;
      if (bestScenario.rationale) {
        md += bestScenario.rationale;
      }
      md += '\n';
    }

    md += '\n';
    return md;
  }

  /**
   * Санация текста шага стратегии по активной no-sell политике.
   * Контекст тикера задан шагом, поэтому sell-директивы вычищаются,
   * даже если тикер не упомянут в тексте.
   */
  private sanitizeStrategyStepText(
    text: string,
    ticker: string,
    order: number,
    assetsAnalysis: AssetAnalysis[],
  ): string {
    // Ремонт слипшихся диапазонов — на том же слое рендера, что и карточки.
    const repaired =
      restoreLostPercentRanges(
        text,
        PortfolioConfig.textFixes.maxPlausiblePct,
      ) ?? text;

    const asset = assetsAnalysis.find(
      (candidate) => candidate.ticker.toUpperCase() === ticker.toUpperCase(),
    );
    if (!asset || !isSellBlockedByPolicy(asset, loadUserPolicy())) {
      return repaired;
    }

    const result = sanitizePolicyCardText(repaired, ticker);
    if (result.changed) {
      console.warn(
        `[POLICY_TEXT] section=strategy step=${order} ticker=${ticker}`,
      );
    }
    return restoreLostPercentRanges(result.text ?? repaired) ?? repaired;
  }

  private buildStrategistSectionMd(
    strategist: StrategistAgentOutput,
    assetsAnalysis: AssetAnalysis[] = [],
  ): string {
    let md = '## 🛡️ Стратег — Правила защиты\n\n';

    md += `**Цель:** ${strategist.summary.goal} | **Проверено активов:** ${strategist.summary.assetsChecked}\n\n`;

    if (strategist.policyWarnings && strategist.policyWarnings.length > 0) {
      md += '⚠️ **Пользовательская политика:**\n\n';
      for (const warning of strategist.policyWarnings) {
        md += `• ${warning}\n`;
      }
      md += '\n';
    }

    md += '| Актив | Действие | Решение | Обоснование |\n';
    md += '|-------|----------|---------|-------------|\n';

    for (const d of strategist.decisions) {
      md += `| ${d.ticker} | ${d.suggestedAction || '—'} | ${d.finalAction || '—'} | ${d.note || '—'} |\n`;
    }

    md += '\n';

    // ─── 3 инвестиционные стратегии (детерминированный рендер) ───
    const strategies = strategist.strategies;
    if (strategies && strategies.length > 0) {
      md += '### 🛡️ Инвестиционные стратегии\n\n';

      for (const strategy of strategies) {
        const medal =
          strategy === strategies[0]
            ? '🥇'
            : strategy === strategies[1]
              ? '🥈'
              : '🥉';
        md += `#### ${medal} ${strategy.name}\n\n`;
        const safeDescription =
          restoreLostPercentRanges(
            applyPolicyToNarrative(
              strategy.description,
              assetsAnalysis,
              loadUserPolicy(),
            ),
          ) ?? strategy.description;
        md += `${safeDescription}\n\n`;

        md += '**Шаги:**\n\n';
        for (const step of strategy.steps) {
          const safeRationale = this.sanitizeStrategyStepText(
            step.rationale,
            step.ticker,
            step.order,
            assetsAnalysis,
          );
          md += `${step.order}. **${step.action}** ${step.ticker} — ${step.amount}\n`;
          md += `   _${safeRationale}_\n\n`;
        }

        md += '**Купонно-дивидендный якорь:**\n\n';
        md += `${
          restoreLostPercentRanges(strategy.incomeAnchor.text) ??
          strategy.incomeAnchor.text
        }\n\n`;
        if (strategy.incomeAnchor.bondYieldPercent !== null) {
          md += `• Купонная часть: ~${strategy.incomeAnchor.bondYieldPercent.toFixed(1).replace('.', ',')}% годовых\n`;
        }
        if (strategy.incomeAnchor.dividendYieldPercent !== null) {
          md += `• Дивидендная часть: ~${strategy.incomeAnchor.dividendYieldPercent.toFixed(1).replace('.', ',')}% годовых\n`;
        }
        if (strategy.incomeAnchor.unavailableReason) {
          md += `• Причина: ${strategy.incomeAnchor.unavailableReason}\n`;
        }
        md += `\n**Риск:** ${strategy.riskLevel}\n\n`;
        md += '---\n\n';
      }

      if (
        strategist.strategyConflicts &&
        strategist.strategyConflicts.length > 0
      ) {
        md += '⚠️ **STRATEGY_CONFLICT:**\n\n';
        for (const conflict of strategist.strategyConflicts) {
          md += `• ${conflict.strategyName}, шаг ${conflict.stepOrder}, ${conflict.ticker}: ${conflict.reason}\n`;
        }
        md += '\n';
      }
    }

    return md;
  }

  // ── Анализ сценариев (HTML) ──

  private buildScenarioSectionHtml(scenario: ScenarioAgentOutput): string {
    const fmtRub = (v: number): string =>
      new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';
    const fmtPct = (v: number): string => v.toFixed(1) + '%';

    let html =
      '<div style="margin-bottom:20px;padding:20px;background:#161b22;border:1px solid #30363d;border-radius:6px;">' +
      '<h3 style="margin:0 0 15px 0;font-size:16px;color:#fff;border-bottom:1px solid #30363d;padding-bottom:8px;">' +
      '📊 Анализ сценариев и рекомендации</h3>';

    // Введение
    html +=
      '<div style="font-size:12px;color:#8b949e;margin-bottom:12px;">' +
      'Этот блок показывает, как изменения в структуре портфеля могут повлиять на ваш результат. ' +
      'Каждый сценарий оценивает конкретное действие — покупку, продажу или удержание активов.</div>';

    // Сводка
    html +=
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:15px;">' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:10px;text-align:center;">' +
      '<div style="font-size:11px;color:#8b949e;text-transform:uppercase;">Вариантов рассмотрено</div>' +
      `<div style="font-size:18px;font-weight:bold;color:#58a6ff;margin-top:4px;">${scenario.summary.scenariosBuilt}</div>` +
      '</div>' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:10px;text-align:center;">' +
      '<div style="font-size:11px;color:#8b949e;text-transform:uppercase;">Текущее отклонение</div>' +
      `<div style="font-size:18px;font-weight:bold;color:#ffd166;margin-top:4px;">${fmtPct(scenario.summary.baselineDeviationPct)}</div>` +
      '</div>' +
      '<div style="background:#0d1117;border:1px solid #30363d;border-radius:4px;padding:10px;text-align:center;">' +
      '<div style="font-size:11px;color:#8b949e;text-transform:uppercase;">Лучшее улучшение</div>' +
      `<div style="font-size:18px;font-weight:bold;color:#56d364;margin-top:4px;">+${fmtPct(scenario.summary.bestImprovementPct)}</div>` +
      '</div>' +
      '</div>';

    // Таблица сценариев — упрощённая и понятная
    html +=
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html +=
      '<thead><tr style="border-bottom:1px solid #30363d;">' +
      '<th style="text-align:left;padding:8px;color:#8b949e;">Вариант</th>' +
      '<th style="text-align:left;padding:8px;color:#8b949e;">Что произойдёт</th>' +
      '<th style="text-align:right;padding:8px;color:#8b949e;">Влияние</th>' +
      '<th style="text-align:right;padding:8px;color:#8b949e;">P&L (unrealized + realized)</th>' +
      '</tr></thead><tbody>';

    for (const s of scenario.scenarios) {
      const isBest = s.id === scenario.bestScenarioId;
      const rowStyle = isBest
        ? 'background:rgba(88,166,255,0.08);border-left:3px solid #58a6ff;'
        : '';

      const pnlNeutral =
        s.verdict === 'IMPROVES' && Math.abs(s.pnlDeltaVsBaselineRub) <= 1000;
      const verdictIcon = pnlNeutral
        ? '📈 Структура улучшается, P&L нейтрально'
        : s.verdict === 'IMPROVES'
          ? '📈 Улучшает'
          : s.verdict === 'WORSENS'
            ? '📉 Ухудшает'
            : '➡️ Нейтральный';

      // ИСПРАВЛЕНИЕ Этап 2.1: показываем PARTIAL/INSUFFICIENT_DATA вместо 0.
      // P&L — единый totalPnLRub (unrealized + realized).
      const totalPnl = s.totalPnLRub;
      const isPnlNotCalculated = s.pnlCalculationStatus === 'INSUFFICIENT_DATA';
      const isPnlPartial = s.pnlCalculationStatus === 'PARTIAL';
      const pnlDisplay = isPnlNotCalculated ? 'Нет данных' : fmtRub(totalPnl);
      const pnlColor = isPnlNotCalculated
        ? '#8b949e'
        : totalPnl >= 0
          ? '#56d364'
          : '#ff7b72';
      const pnlIcon = !isPnlNotCalculated && totalPnl >= 0 ? '✅' : '⚠️';

      html +=
        '<tr style="border-bottom:1px solid #30363d;">' +
        `<td style="padding:8px;color:#c9d1d9;${rowStyle}"><strong>${s.title}</strong>${
          isBest
            ? ' ⭐ <span style="color:#58a6ff;font-size:11px;">Рекомендуем</span>'
            : ''
        }</td>` +
        `<td style="padding:8px;color:${isBest ? '#58a6ff' : '#c9d1d9'};${rowStyle}">${verdictIcon}</td>` +
        `<td style="padding:8px;text-align:right;color:#c9d1d9;${rowStyle}">${fmtPct(s.structureDeviationPct)} от цели</td>` +
        `<td style="padding:8px;text-align:right;color:${pnlColor};${rowStyle}">${pnlIcon} ${pnlDisplay}${isPnlPartial ? ' (частично)' : ''}</td>` +
        '</tr>';

      // Rationale (если есть)
      if (s.rationale) {
        html += `<tr><td colspan="4" style="padding:4px 8px 8px 20px;color:#8b949e;font-size:12px;${rowStyle}">${s.rationale}</td></tr>`;
      }
    }

    html += '</tbody></table>';

    // Рекомендация
    const bestScenario = scenario.scenarios.find(
      (s) => s.id === scenario.bestScenarioId,
    );
    if (bestScenario) {
      html +=
        '<div style="margin-top:12px;padding:10px;background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);border-radius:4px;font-size:12px;">' +
        '<div style="font-weight:bold;color:#58a6ff;margin-bottom:4px;">💡 Рекомендация:</div>' +
        `Сценарий «${bestScenario.title}» показывает лучший результат. `;
      if (bestScenario.rationale) {
        html += bestScenario.rationale;
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  private buildStrategistSectionHtml(
    strategist: StrategistAgentOutput,
    assetsAnalysis: AssetAnalysis[] = [],
  ): string {
    const fmtPct = (v: number | null): string =>
      v !== null ? (v >= 0 ? '+' : '') + v.toFixed(1) + '%' : '—';

    let html =
      '<div style="margin-bottom:20px;padding:20px;background:#161b22;border:1px solid #30363d;border-radius:6px;">' +
      '<h3 style="margin:0 0 15px 0;font-size:16px;color:#fff;border-bottom:1px solid #30363d;padding-bottom:8px;">' +
      '🛡️ Стратег — Правила защиты</h3>';

    // Сводка с долями сегментов
    // ИСПРАВЛЕНИЕ Этап 2: REDUCE считается ТОЛЬКО как продажа/сокращение, НЕ как покупка.
    // BUY, SELL, REDUCE, EXIT — каждая категория отдельно.
    // STABLE не входит в тип AiAction finalAction, поэтому не проверяем его.
    const buyCount = strategist.decisions.filter(
      (d) => d.finalAction === 'BUY',
    ).length;
    const sellCount = strategist.decisions.filter(
      (d) =>
        d.finalAction === 'SELL' ||
        d.finalAction === 'REDUCE' ||
        d.finalAction === 'EXIT',
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

    html +=
      '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
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
          : d.finalAction === 'SELL' ||
              d.finalAction === 'REDUCE' ||
              d.finalAction === 'EXIT'
            ? '#ff7b72'
            : '#8b949e';

      // Формируем примечание с данными о просадке и концентрации
      let note = d.note || '';
      const isConflict = d.hasConflict === true;
      if (isConflict) {
        note += (note ? ' · ' : '') + '⚠️ Conflict: requires manual review';
      }
      if (d.drawdownPercent !== null && d.drawdownPercent < 0) {
        note += (note ? ' · ' : '') + '📉 ' + fmtPct(d.drawdownPercent);
      }
      if (d.concentrationPercent !== null && d.concentrationPercent > 10) {
        note += (note ? ' · ' : '') + '⚠️ ' + fmtPct(d.concentrationPercent);
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

    if (strategist.policyWarnings && strategist.policyWarnings.length > 0) {
      html +=
        '<div style="margin-top: 8px; padding: 8px; background: rgba(255, 209, 102, 0.08); border: 1px solid rgba(255, 209, 102, 0.35); border-radius: 4px; font-size: 11px; color: #ffd166;">\n';
      html +=
        '<div style="font-weight: bold; margin-bottom: 4px;">⚠️ Пользовательская политика:</div>\n';
      for (const warning of strategist.policyWarnings) {
        html += '<div>• ' + warning + '</div>\n';
      }
      html += '</div>\n';
    }

    // ─── 3 инвестиционные стратегии (детерминированный рендер) ───
    const strategies = strategist.strategies;
    if (strategies && strategies.length > 0) {
      html +=
        '<h4 style="margin: 15px 0 10px 0; color: #58a6ff; font-size: 14px;">🛡️ Инвестиционные стратегии</h4>\n';

      for (const strategy of strategies) {
        const medal =
          strategy === strategies[0]
            ? '🥇'
            : strategy === strategies[1]
              ? '🥈'
              : '🥉';
        const riskColor =
          strategy.riskLevel === 'HIGH'
            ? '#ff7b72'
            : strategy.riskLevel === 'MEDIUM'
              ? '#e3b341'
              : '#56d364';
        const borderColor =
          strategy.riskLevel === 'HIGH'
            ? 'rgba(255, 123, 114, 0.3)'
            : strategy.riskLevel === 'MEDIUM'
              ? 'rgba(227, 179, 65, 0.3)'
              : 'rgba(86, 211, 100, 0.3)';

        html +=
          '<div style="margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid ' +
          borderColor +
          '; border-radius: 6px;">\n';
        html +=
          '<div style="font-weight: bold; color: #e6edf3; font-size: 13px;">' +
          medal +
          ' ' +
          strategy.name +
          '</div>\n';
        const safeDescription =
          restoreLostPercentRanges(
            applyPolicyToNarrative(
              strategy.description,
              assetsAnalysis,
              loadUserPolicy(),
            ),
          ) ?? strategy.description;
        html +=
          '<div style="color: #8b949e; font-size: 11px; margin-top: 2px;">' +
          safeDescription +
          '</div>\n';

        // Шаги
        html += '<div style="margin-top: 8px;">\n';
        html +=
          '<div style="color: #58a6ff; font-weight: bold; font-size: 11px; margin-bottom: 4px;">📋 Шаги:</div>\n';
        for (const step of strategy.steps) {
          html +=
            '<div style="font-size: 11px; color: #c9d1d9; padding: 2px 0; border-bottom: 1px solid rgba(48, 54, 61, 0.5);">\n';
          html +=
            '<span style="color: #58a6ff; font-weight: bold;">' +
            step.order +
            '.</span> ';
          html +=
            '<span style="color: ' +
            (step.action.includes('Прод')
              ? '#ff7b72'
              : step.action.includes('Куп')
                ? '#56d364'
                : '#e3b341') +
            ';">' +
            step.action +
            '</span> ';
          html += '<strong>' + step.ticker + '</strong> — ' + step.amount;
          const safeRationale = this.sanitizeStrategyStepText(
            step.rationale,
            step.ticker,
            step.order,
            assetsAnalysis,
          );
          html +=
            '<div style="color: #8b949e; font-size: 10px; margin-left: 16px;">→ ' +
            safeRationale +
            '</div>\n';
          html += '</div>\n';
        }
        html += '</div>\n';

        // Купонно-дивидендный якорь (только арифметика из данных)
        html +=
          '<div style="margin-top: 8px; padding: 6px 8px; background: rgba(88, 166, 255, 0.05); border: 1px solid rgba(88, 166, 255, 0.15); border-radius: 4px; font-size: 11px;">\n';
        html +=
          '<div style="color: #58a6ff; font-weight: bold; margin-bottom: 4px;">📊 Купонно-дивидендный якорь:</div>\n';
        html +=
          '<div>' +
          (restoreLostPercentRanges(strategy.incomeAnchor.text) ??
            strategy.incomeAnchor.text) +
          '</div>\n';
        if (strategy.incomeAnchor.bondYieldPercent !== null) {
          html +=
            '<div style="color: #56d364; margin-top: 3px;">Купонная часть: ~' +
            strategy.incomeAnchor.bondYieldPercent
              .toFixed(1)
              .replace('.', ',') +
            '% годовых</div>\n';
        }
        if (strategy.incomeAnchor.dividendYieldPercent !== null) {
          html +=
            '<div style="color: #56d364; margin-top: 3px;">Дивидендная часть: ~' +
            strategy.incomeAnchor.dividendYieldPercent
              .toFixed(1)
              .replace('.', ',') +
            '% годовых</div>\n';
        }
        if (strategy.incomeAnchor.unavailableReason) {
          html +=
            '<div style="color: #ffd166; margin-top: 3px;">Причина: ' +
            (restoreLostPercentRanges(
              strategy.incomeAnchor.unavailableReason,
            ) ?? strategy.incomeAnchor.unavailableReason) +
            '</div>\n';
        }
        html += '</div>\n';

        // Риск
        html +=
          '<div style="margin-top: 4px; font-size: 10px; color: ' +
          riskColor +
          ';">Риск: ' +
          strategy.riskLevel +
          '</div>\n';
        html += '</div>\n';
      }

      if (
        strategist.strategyConflicts &&
        strategist.strategyConflicts.length > 0
      ) {
        html +=
          '<div style="margin-top: 8px; padding: 8px; background: rgba(255, 123, 114, 0.08); border: 1px solid rgba(255, 123, 114, 0.3); border-radius: 4px; font-size: 11px; color: #ff7b72;">\n';
        html +=
          '<div style="font-weight: bold; margin-bottom: 4px;">⚠️ STRATEGY_CONFLICT:</div>\n';
        for (const conflict of strategist.strategyConflicts) {
          html +=
            '<div>• ' +
            conflict.strategyName +
            ', шаг ' +
            conflict.stepOrder +
            ', ' +
            conflict.ticker +
            ': ' +
            conflict.reason +
            '</div>\n';
        }
        html += '</div>\n';
      }
    }

    html += '</div>';
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
