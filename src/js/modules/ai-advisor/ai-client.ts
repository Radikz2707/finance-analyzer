import {
  PortfolioReportData,
  type AssetAnalysis,
} from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import axios from 'axios';
import https from 'https';
import { randomUUID } from 'node:crypto';
import {
  buildSystemPrompt,
  type MacroDataContext,
} from './prompt-templates.js';
import { buildFallbackReport } from './fallback-report-builder.js';
import { UIOrdersData } from './types.js';
import { PortfolioSnapshot } from '../portfolio-snapshot/portfolio-snapshot.js';
import {
  CURRENT_AI_MODEL,
  getAvailableModels,
  type AiModelConfig,
} from './ai-config.js';
import { AiProviderRouter } from './provider-router.js';
import { localCache, getCachedResponse } from './ollama-cache.js';
import {
  streamChat,
  chatWithoutStream,
  type StreamResult,
} from './ollama-stream.js';
import {
  isOllamaRunning,
  listModels,
  pullModel,
  formatModelList,
  cleanAiResponse,
  validateAiOutput,
  validateArithmeticConsistency,
  type DeterministicAmounts,
  type OllamaMessage,
} from './ollama-manager.js';
import { PortfolioConfig } from '../../config/portfolio-config.js';
import type { InvestmentThesisResult } from '../research/investment-thesis/types.js';
import {
  validateStructuredAIJson,
  type RawAIJson,
  type ValidationResult as StructuredValidationResult,
} from './structured-ai-recommendation.js';
import { getLogger } from '../logger/index.js';

/** Задержка (мс) */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Является ли ошибка Ollama транзиентной (стоит повторить запрос).
 * HTTP 5xx и сетевые обрывы — временные сбои (модель ещё грузится,
 * сервер перегружен); повтор обычно проходит успешно.
 */
function isTransientOllamaError(message?: string): boolean {
  if (!message) return false;
  return /50[0-9]|52[0-9]|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|EPIPE|keep-alive/i.test(
    message,
  );
}

/** Результат запроса к ИИ */
interface AiResponseResult {
  /** Текст ответа */
  text: string;
  /** Использованная модель */
  modelUsed: string;
  /** Успешность запроса */
  success: boolean;
  /** Сообщение об ошибке (если success = false) */
  error?: string;
  /** Структурированный JSON от AI (может быть null если не извлечён) */
  structuredJson?: RawAIJson | null;
  /** Массив структурированных JSON-объектов от AI (по одному на каждый актив) */
  structuredJsonArray?: RawAIJson[];
  /** Результат валидации structured JSON */
  structuredValidation?: StructuredValidationResult | null;
}

/**
 * Извлекает JSON-блок из AI-ответа.
 * Ищет блок между ```json ... ``` или ``` ... ``` или прямой JSON.
 */
export function extractJsonFromAiResponse(text: string): RawAIJson | null {
  if (!text) return null;

  // Паттерн 1: ```json { ... } ```
  const jsonBlockPattern = /```json\s*([\s\S]*?)```/;
  let match = text.match(jsonBlockPattern);
  if (match) {
    const jsonText = match[1];
    if (jsonText) {
      try {
        return JSON.parse(jsonText.trim()) as RawAIJson;
      } catch {
        // fall through
      }
    }
  }

  // Паттерн 2: ``` { ... } ```
  const blockPattern = /```\s*([\s\S]*?)```/;
  match = text.match(blockPattern);
  if (match) {
    const jsonText = match[1];
    if (jsonText) {
      try {
        return JSON.parse(jsonText.trim()) as RawAIJson;
      } catch {
        // fall through
      }
    }
  }

  // Паттерн 3: прямой JSON объект
  const objectPattern = /\{\s*"ticker"\s*:/;
  const idx = text.search(objectPattern);
  if (idx >= 0) {
    // Найдем закрывающую скобку
    let braceCount = 0;
    let endIdx = -1;
    for (let i = idx; i < text.length; i++) {
      if (text[i] === '{') braceCount++;
      if (text[i] === '}') braceCount--;
      if (braceCount === 0 && braceCount !== undefined) {
        endIdx = i + 1;
        break;
      }
    }
    if (endIdx > idx) {
      try {
        return JSON.parse(text.substring(idx, endIdx)) as RawAIJson;
      } catch {
        // fall through
      }
    }
  }

  return null;
}

/**
 * Извлекает массив JSON-объектов из AI-ответа.
 * Ожидается формат: ```json [ {...}, {...}, ... ] ```
 * Возвращает массив RawAIJson для всех активов.
 */
export function extractJsonArrayFromAiResponse(text: string): RawAIJson[] {
  if (!text) return [];

  // Паттерн 1: ```json [ ... ] ```
  const jsonBlockPattern = /```json\s*([\s\S]*?)```/;
  let match = text.match(jsonBlockPattern);
  if (match) {
    const jsonText = match[1];
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText.trim());
        if (Array.isArray(parsed)) {
          return parsed as RawAIJson[];
        }
        // Если пришёл одиночный объект — обернём в массив
        if (parsed && typeof parsed === 'object' && 'ticker' in parsed) {
          return [parsed as RawAIJson];
        }
      } catch {
        // fall through
      }
    }
  }

  // Паттерн 2: ``` [ ... ] ```
  const blockPattern = /```\s*([\s\S]*?)```/;
  match = text.match(blockPattern);
  if (match) {
    const jsonText = match[1];
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText.trim());
        if (Array.isArray(parsed)) {
          return parsed as RawAIJson[];
        }
        if (parsed && typeof parsed === 'object' && 'ticker' in parsed) {
          return [parsed as RawAIJson];
        }
      } catch {
        // fall through
      }
    }
  }

  return [];
}

/**
 * Строит массив детерминированных сумм для валидации арифметики AI.
 */
function buildDeterministicAmounts(
  assetsAnalysis: AssetAnalysis[] | undefined | null,
): DeterministicAmounts[] {
  return (assetsAnalysis ?? [])
    .filter((a): a is AssetAnalysis => a.currentPercent > 0)
    .map((a: AssetAnalysis) => {
      const det: DeterministicAmounts = {
        ticker: a.ticker,
        liquidationValue: a.currentPrice * a.quantity,
        currentQuantity: a.quantity,
      };
      if (a.deficitRub > 0) {
        det.buyAmount = a.deficitRub;
      }
      if (a.deficitRub < 0) {
        det.sellAmount = Math.abs(a.deficitRub);
      }
      return det;
    });
}

/**
 * Многомодельный клиент ИИ-советника
 * Поддержка: OpenRouter (Claude/GPT), GigaChat, YandexGPT, локальный fallback
 */
export class AiClient {
  private openRouterKey: string;
  private gigaChatKey: string;
  private yandexGptKey: string;
  /** Маршрутизатор ИИ-провайдеров: circuit breaker + retry + fallback chain */
  private readonly aiRouter = new AiProviderRouter();
  /** Логгер модуля */
  private readonly log = getLogger('ai-client');

  /**
   * Формирует отображение ставки ЦБ со статусом источника.
   */
  private formatCbrRate(macroData?: MacroDataContext): {
    display: string;
    value: number;
    hasData: boolean;
  } {
    const rateValue = macroData?.keyRate ?? 0;
    const isFresh = macroData?.isFresh ?? false;
    const hasData = macroData != null && rateValue > 0;

    const display = hasData
      ? rateValue + '%' + (!isFresh
          ? ' (\u26a0\ufe0f \u0434\u0430\u043d\u043d\u044b\u0435 \u0443\u0441\u0442\u0430\u0440\u0435\u043b\u0438, \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a: ' + (macroData.source || 'unknown') + ')'
          : ' (cbr.ru)')
      : '\u2014 (\u0434\u0430\u043d\u043d\u044b\u0435 \u043d\u0435 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u044b)';

    return { display, value: rateValue, hasData };
  }

  constructor() {
    this.openRouterKey = process.env.OPENROUTER_API_KEY || '';
    // Приоритет: прямой ключ GigaChat > ProxyAPI (прокси-обёртка).
    // Раньше было наоборот: PROXYAPI_KEY (даже placeholder из .env.template)
    // перекрывал настоящий GIGACHAT_API_KEY → GigaChat падал с 403.
    this.gigaChatKey =
      process.env.GIGACHAT_API_KEY || process.env.PROXYAPI_KEY || '';
    this.yandexGptKey = process.env.YANDEXGPT_API_KEY || '';
  }

  /**
   * Построение контекста портфеля для ИИ
   * Усиленная версия: более структурированные данные, жёсткая привязка к реальным данным
   */
  /**
   * Построение контекста портфеля для ИИ.
   * СЖАТАЯ ВЕРСИЯ: агрегированные метрики + таблица активов (~350 символов на актив).
   * Цель: < 5000 символов для 11 активов вместо ~25000.
   */
  private buildPortfolioContext(
    analysis: PortfolioReportData,
    _inc: CalculatedIncome,
    _validation: ValidationResult,
    orders: UIOrdersData,
    snapshot: PortfolioSnapshot | null,
    thesisResults: Map<string, InvestmentThesisResult>,
    _historicalData?: {
      profitC10: number;
      profitC11: number;
      investedNet: number;
      totalPurchases: number;
      totalSales: number;
      commission: number;
      averageMonthlyDeposit?: number;
      anomalousDepositsTotal?: number;
    },
    accountsInfo?: Array<{ name: string; value: number }>,
    macroData?: MacroDataContext,
  ): string {
    const { assetsAnalysis, macro } = analysis;
    const totalVal = macro.totalBalance;

    const snapshotFinancial = snapshot?.financial ?? null;
    const contributedCapital = snapshotFinancial?.contributedCapital ?? 0;
    const currentEquityGap = snapshotFinancial?.currentEquityGap ?? 0;
    const currentEquityGapPct = snapshotFinancial?.currentEquityGapPct ?? 0;
    const freeCash = macro.freeCash ?? 0;

    const totalNetProfit = snapshotFinancial
      ? snapshotFinancial.currentAssets +
        snapshotFinancial.freeCash -
        snapshotFinancial.contributedCapital
      : totalVal - contributedCapital;
    const totalNetProfitPercent =
      contributedCapital > 0 ? (totalNetProfit / contributedCapital) * 100 : 0;

    let stocksPct = 0,
      bondsPct = 0,
      etfPct = 0;
    for (const a of assetsAnalysis) {
      const t = a.assetType.toUpperCase();
      if (t === 'А' || t === 'АКЦИЯ' || t === 'STOCK')
        stocksPct += a.currentPercent;
      if (t === 'О' || t === 'ОБЛИГАЦИЯ' || t === 'BOND')
        bondsPct += a.currentPercent;
      if (t === 'Ф' || t === 'ETF' || t === 'FUND') etfPct += a.currentPercent;
    }
    stocksPct = Math.round(stocksPct * 100) / 100;
    bondsPct = Math.round(bondsPct * 100) / 100;
    etfPct = Math.round(etfPct * 100) / 100;

    // Fallback: если assetType не распознан — используем name/ticker для эвристики
    if (stocksPct === 0 && bondsPct === 0) {
      for (const a of assetsAnalysis) {
        const n = (a.name + ' ' + a.ticker).toUpperCase();
        if (
          n.includes('ОФЗ') ||
          n.includes('ОБЛ') ||
          n.includes('КУПОН') ||
          n.includes('ФОНАРЕК') ||
          n.includes('БРУС') ||
          n.includes('ФОС') ||
          n.includes('СЕЛИГДАР') ||
          n.includes('ГТЛК') ||
          n.includes('ФосАгро')
        ) {
          bondsPct += a.currentPercent;
        } else if (
          n.includes('ETF') ||
          n.includes('ФОНД') ||
          n.includes('GPD') ||
          n.includes('SPDR') ||
          n.includes('TMX') ||
          n.includes('ISHARES') ||
          n.includes('VANGUARD')
        ) {
          etfPct += a.currentPercent;
        } else if (a.currentPercent > 0) {
          stocksPct += a.currentPercent;
        }
      }
      stocksPct = Math.round(stocksPct * 100) / 100;
      bondsPct = Math.round(bondsPct * 100) / 100;
      etfPct = Math.round(etfPct * 100) / 100;
      this.log.info(
        '[AI_CLIENT] Fallback assetType detection: stocksPct:',
        stocksPct,
        '| bondsPct:',
        bondsPct,
        '| etfPct:',
        etfPct,
        '| assetTypes:',
        assetsAnalysis.map((a) => a.assetType).join(', '),
      );
    }

    const currentDate = new Date().toLocaleDateString('ru-RU');
    const { display: rateDisplay } = this.formatCbrRate(macroData);

    let ctx =
      '=== \u0414\u0410\u041d\u041d\u042b\u0415 \u041f\u041e\u0420\u0422\u0424\u0415\u041b\u042f ===\n';
    ctx +=
      '\u0414\u0430\u0442\u0430: ' +
      currentDate +
      ' | \u041f\u043e\u0440\u0442\u0444\u0435\u043b\u044c: ' +
      totalVal.toLocaleString('ru-RU') +
      ' \u20bd\n';
    ctx +=
      '\u0412\u043b\u043e\u0436\u0435\u043d\u043e: ' +
      contributedCapital.toLocaleString('ru-RU') +
      ' \u20bd | \u0418\u043d\u0432\u0435\u0441\u0442-\u0440\u0435\u0437\u0443\u043b\u044c\u0442: ' +
      (totalNetProfit >= 0 ? '+' : '') +
      totalNetProfit.toFixed(2) +
      ' \u20bd (' +
      totalNetProfitPercent.toFixed(2) +
      '%)\n' +
      '\u26a0\ufe0f \u042d\u0442\u043e \u0433\u043e\u0442\u043e\u0432\u044b\u0439 \u0440\u0430\u0441\u0447\u0451\u0442 P&L \u043e\u0442 \u0440\u0435\u0430\u043b\u044c\u043d\u044b\u0445 \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0439. \u041d\u0415 \u043f\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u044b\u0432\u0430\u0439 \u043f\u0440\u043e\u0446\u0435\u043d\u0442 \u0438\u0437 \u0434\u0440\u0443\u0433\u0438\u0445 \u0434\u0430\u043d\u043d\u044b\u0445 (\u0431\u0435\u043d\u0447\u043c\u0430\u0440\u043a, \u0442\u0430\u0431\u043b\u0438\u0446\u0430 \u0430\u043a\u0442\u0438\u0432\u043e\u0432).\n';
    ctx +=
      '\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0439 \u043a\u044d\u0448: ' +
      macro.freeCash.toLocaleString('ru-RU') +
      ' \u20bd | \u0421\u0442\u0430\u0432\u043a\u0430 \u0426\u0411: ' +
      rateDisplay +
      '\n';
    if (snapshotFinancial) {
      ctx +=
        '\u0414\u0435\u0444\u0438\u0446\u0438\u0442 \u0434\u043e\u043b\u0438: ' +
        currentEquityGap.toLocaleString('ru-RU') +
        ' \u20bd (' +
        currentEquityGapPct.toFixed(2) +
        '%)\n';
    }
    ctx +=
      '\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430: \u0410\u043a\u0446\u0438\u0438 ' +
      stocksPct +
      '% | \u041e\u0431\u043b\u0438\u0433\u0430\u0446\u0438\u0438 ' +
      bondsPct +
      '% | \u0424\u043e\u043d\u0434\u044b(ETF) ' +
      etfPct +
      '%\n';

    // Добавляем информацию о регулярных взносах
    const averageMonthlyDeposit = _historicalData?.averageMonthlyDeposit ?? 0;
    if (averageMonthlyDeposit > 0) {
      ctx +=
        '\u0421\u0440\u0435\u0434\u043d\u0438\u0439 \u0435\u0436\u0435\u043c\u0435\u0441\u044f\u0447\u043d\u044b\u0439 \u0432\u0437\u043d\u043e\u0441: ' +
        averageMonthlyDeposit.toLocaleString('ru-RU') +
        ' \u20bd (без \u0430\u043d\u043e\u043c\u0430\u043b\u044c\u043d\u044b\u0445 \u0432\u0437\u043d\u043e\u0441\u043e\u0432)\n';
      ctx +=
        '\u26a0\ufe0f \u0412\u0430\u0436\u043d\u043e: \u043a\u044d\u0448 \u043f\u043e\u043f\u043e\u043b\u043d\u044f\u0435\u0442\u0441\u044f \u043d\u0435 \u0442\u043e\u043b\u044c\u043a\u043e \u0438\u0437 \u043a\u0443\u043f\u043e\u043d\u043e\u0432/\u0434\u0438\u0432\u0438\u0434\u0435\u043d\u0434\u043e\u0432, \u043d\u043e \u0438 \u0438\u0437 \u0440\u0435\u0433\u0443\u043b\u044f\u0440\u043d\u044b\u0445 \u0432\u0437\u043d\u043e\u0441\u043e\u0432 \u0438\u0437 \u0437\u0430\u0440\u043f\u043b\u0430\u0442\u044b.\n';
      ctx +=
        '\u2705 \u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0439 \u0431\u044e\u0434\u0436\u0435\u0442 \u0434\u043b\u044f \u043f\u043e\u043a\u0443\u043f\u043e\u043a: \u043a\u0440\u043e\u043c\u0435 \u0441\u0432\u043e\u0431\u043e\u0434\u043d\u043e\u0433\u043e \u043a\u044d\u0448\u0430 (' +
        freeCash.toLocaleString('ru-RU') +
        ' \u20bd), \u0435\u0436\u0435\u043c\u0435\u0441\u044f\u0447\u043d\u043e \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d ' +
        averageMonthlyDeposit.toLocaleString('ru-RU') +
        ' \u20bd \u0434\u043b\u044f \u043f\u043e\u043a\u0443\u043f\u043a\u0438 \u0430\u043a\u0442\u0438\u0432\u043e\u0432 \u0441 \u0434\u0435\u0444\u0438\u0446\u0438\u0442\u043e\u043c \u0434\u043e\u043b\u0438.\n';
    }

    if (snapshot && snapshot.accounts.length > 0) {
      ctx += '\u0421\u0447\u0435\u0442\u0430:';
      for (const acc of snapshot.accounts) {
        ctx +=
          ' ' +
          acc.accountId +
          '(' +
          acc.accountType +
          '=' +
          acc.totalLiquidationValue.toLocaleString('ru-RU') +
          ' \u20bd)';
      }
      ctx += '\n';
    } else if (accountsInfo && accountsInfo.length > 0) {
      ctx += '\u0421\u0447\u0435\u0442\u0430:';
      accountsInfo.forEach((a) => {
        ctx += ' ' + a.name + '=' + a.value.toLocaleString('ru-RU') + ' \u20bd';
      });
      ctx += '\n';
    }

    ctx += '\n=== \u0410\u041a\u0422\u0418\u0412\u042b ===\n';
    ctx +=
      '\u0424\u043e\u0440\u043c\u0430\u0442: [\u0422\u0418\u041f] \u0422\u0438\u043a\u0435\u0440 (назв) | \u0414\u043e\u043b\u044f% | \u0426\u0435\u043d\u0430 | \u0412\u0445\u043e\u0434 | P&L% | \u041a\u043e\u043b-\u0432\u043e | \u041b\u0438\u043a\u0432 | \u0414\u0435\u0444\u0438\u0446\u0438\u0442 | \u0421\u0442\u0430\u0442\u0443\u0441 | target% | Thesis\n';

    // Жёсткое предупреждение: ИИ НЕ должен пересчитывать P&L
    ctx +=
      '\u26a0\ufe0f \u0412\u0410\u0416\u041d\u041e: P&L \u043f\u043e\u0440\u0442\u0444\u0435\u043b\u044f \u043e\u0442 \u0432\u0445\u043e\u0434\u0430 = ' +
      totalNetProfitPercent.toFixed(2) +
      '%. \u042d\u0422\u041e \u0424\u0410\u041a\u0422. \u041d\u0415 \u043f\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u044b\u0432\u0430\u0439 \u0435\u0433\u043e \u0438\u0437 \u0434\u0430\u043d\u043d\u044b\u0445 \u0430\u043a\u0442\u0438\u0432\u043e\u0432 \u0438\u043b\u0438 \u0431\u0435\u043d\u0447\u043c\u0430\u0440\u043a\u0430.\n';

    for (const a of assetsAnalysis) {
      if (a.currentPercent === 0 && a.targetPercent === 0) continue;

      const type =
        a.assetType === '\u0410' ||
        a.assetType === '\u0410\u043a\u0446\u0438\u044f'
          ? '\u0410\u041a\u0426\u0418\u042f'
          : a.assetType === '\u041e' ||
              a.assetType ===
                '\u041e\u0431\u043b\u0438\u0433\u0430\u0446\u0438\u044f'
            ? '\u041e\u0411\u041b'
            : '\u0424\u041e\u041d\u0414';

      const pnlFromEntry =
        a.balancePrice > 0 && a.currentPrice > 0
          ? (
              ((a.currentPrice - a.balancePrice) / a.balancePrice) *
              100
            ).toFixed(1) + '%'
          : '—';

      const liquidation = (a.currentPrice * a.quantity).toLocaleString('ru-RU');
      const deficitStr =
        a.deficitRub > 0
          ? '+' + a.deficitRub.toLocaleString('ru-RU')
          : a.deficitRub < 0
            ? Math.abs(a.deficitRub).toLocaleString('ru-RU')
            : '—';

      const thesis = thesisResults.get(a.ticker);
      // Сокращённый thesis — только первый символ уровня и первые 40 символов
      const thesisShort = thesis
        ? (thesis.confidence.level[0] || '?') +
          ': ' +
          (thesis.thesis.length > 40
            ? thesis.thesis.substring(0, 40) + '...'
            : thesis.thesis)
        : 'NO_DATA';

      const marketStatus = a.currentPrice <= 0 ? ' BLOCKED' : '';
      const targetPctStr =
        a.targetPercent !== undefined
          ? a.targetPercent === 0
            ? '0%'
            : a.targetPercent.toFixed(1) + '%'
          : '—';

      ctx +=
        type +
        ' ' +
        a.ticker +
        (a.shortName ? ' (' + a.shortName + ')' : '') +
        ' | ' +
        a.currentPercent.toFixed(1) +
        '% | ' +
        a.currentPrice +
        ' | ' +
        a.balancePrice +
        ' | ' +
        pnlFromEntry +
        ' | ' +
        a.quantity +
        ' | ' +
        liquidation +
        ' | ' +
        deficitStr +
        ' | ' +
        a.status +
        marketStatus +
        ' | ' +
        targetPctStr +
        (a.couponRub !== undefined ? ' | Купон: ' + a.couponRub + '₽' : '') +
        ' | ' +
        thesisShort +
        '\n';
    }

    if (orders.md) {
      ctx += '\n=== \u0417\u0410\u042f\u0412\u041a\u0418 ===\n' + orders.md;
    }

    return ctx;
  }

  /**
   * Построение user prompt с учётом новостного фона
   * Усиленная версия: жёсткие инструкции по формату, валидация данных
   */
  private buildUserPrompt(
    context: string,
    rateDisplay: string,
    hasData: boolean,
    rateValue: number,
    newsContext?: string,
    macroPercentages?: { stocks: number; bonds: number },
    _historicalData?: {
      profitC10: number;
      profitC11: number;
      investedNet: number;
    },
  ): string {
    const currentMonth = new Date().toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });

    const stocksPct = macroPercentages?.stocks || 0;
    const bondsPct = macroPercentages?.bonds || 0;

    let prompt = '';
    prompt += 'ДАННЫЕ ПОРТФЕЛЯ:\n';
    prompt += context + '\n\n';

    // Добавляем новостный фон, если есть
    if (newsContext) {
      prompt += 'НОВОСТНОЙ ФОН:\n' + newsContext + '\n\n';
    }

    prompt += '=== ЗАДАЧА ===\n';
    prompt += 'Проанализируй портфель:\n';
    prompt += '- Ставка ЦБ: ' + rateDisplay + '\n';
    prompt +=
      '- Структура: Акции ' + stocksPct + '%, Облигации ' + bondsPct + '%\n';
    prompt += '- Дата: ' + currentMonth + '\n\n';

    prompt += '=== ОТВЕТ ===\n';
    if (hasData) {
      prompt += '1. Макро: соответствие структуры ставке ' + rateValue + '%\n';
    } else {
      prompt += '1. Макро: данные о ставке ЦБ отсутствуют — укажи "нет данных"\n';
    }
    prompt +=
      '2. Каждый актив: статус (BUY/STABLE/REDUCE/EXIT/NO_TARGET) + аргументация\n';
    prompt += '   - targetPercent = 0% → EXIT\n';
    prompt += '   - targetPercent = — → NO_TARGET\n';
    prompt += '3. Ребалансировка: приоритет BUY/REDUCE/EXIT, кэш\n';
    prompt += '4. Выход в плюс: 1-3 мес / 3-12 мес / 1+ лет\n';
    prompt += '5. Мониторинг: котировки, макро\n';
    prompt += '6. Новые инструменты: НЕ добавлять без запроса\n';
    prompt += '7. Резюме: 3-5 действий\n\n';

    prompt += '=== ВАЖНО ===\n';
    prompt += '- Проценты: 47.7%, не 47.739999%\n';
    prompt += '- Нет данных → «нет данных», НЕ выдумывать\n';
    prompt += '- Аргументация: конкретные цифры\n';
    prompt += '- BLOCKED → НЕ рекомендовать BUY/SELL\n';
    prompt += '- Отвечай на русском, развёрнуто\n';

    return prompt;
  }

  /**
   * Запрос к OpenRouter (Claude Sonnet 4 / GPT-4o)
   * Примечание: используется кастомный HTTPS-агент с отключённой проверкой
   * сертификатов — это необходимо на машинах с корпоративными SSL-прокси
   * или антивирусами, которые подменяют TLS-сертификаты.
   */
  private async queryOpenRouter(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    if (!this.openRouterKey) {
      throw new Error('OPENROUTER_API_KEY не настроен');
    }

    // Кастомный HTTPS-агент: отключаем проверку сертификатов
    // Только для OpenRouter — на остальных API это не влияет
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    this.log.info('[OPENROUTER] Sending request to:', modelConfig.baseUrl);
    this.log.info('[OPENROUTER] Model:', modelConfig.modelName);
    this.log.info(
      '[OPENROUTER] Key prefix:',
      this.openRouterKey.substring(0, 15) + '...',
    );

    const response = await axios.post(
      modelConfig.baseUrl,
      {
        model: modelConfig.modelName,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
      },
      {
        headers: {
          Authorization: 'Bearer ' + this.openRouterKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/finance-analyzer',
          'X-Title': 'Finance Analyzer',
        },
        httpsAgent,
        timeout: 120000,
      },
    );

    this.log.info('[OPENROUTER] ✅ Response received, status:', response.status);
    return response.data.choices[0].message.content;
  }

  /**
   * Определение типа ключа GigaChat
   * Authorization Key: используется напрямую как Bearer токен
   * OAuth Key: формат ClientID:ClientSecret (base64)
   */
  private isAuthorizationKey(key: string): boolean {
    // 1. ':' прямо в ключе → OAuth ClientID:Secret (raw или base64)
    if (key.includes(':')) return false;
    // 2. UUID-подобный ключ (Authorization Key от Сбера) — hex с дефисами
    if (/^[0-9a-fA-F-]{20,}$/.test(key)) return true;
    // 3. Иначе пробуем декодировать base64: ':' после декодирования → OAuth
    try {
      const decoded = Buffer.from(key, 'base64').toString();
      return !decoded.includes(':');
    } catch {
      // Если не base64 — это Authorization Key
      return true;
    }
  }

  /**
   * Сериализовать тело HTTP-ошибки для диагностики (безопасно, без throw).
   * Используется во всех запросах GigaChat: OAuth, Authorization Key, chat.
   */
  private formatErrorBody(data: unknown): string {
    try {
      return typeof data === 'string'
        ? data.slice(0, 300)
        : JSON.stringify(data ?? '').slice(0, 300);
    } catch {
      return '<не удалось сериализовать body>';
    }
  }

  /**
   * Запрос к GigaChat с Authorization Key
   * Ключ используется напрямую как Bearer токен
   */
  private async queryGigaChatWithAuthKey(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
    httpsAgent?: https.Agent,
  ): Promise<string> {
    if (!this.gigaChatKey) {
      throw new Error('GIGACHAT_API_KEY не настроен');
    }

    this.log.info('[GigaChat] Использование Authorization Key...');

    try {
      const response = await axios.post(
        'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
        {
          model: 'GigaChat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
          stream: false,
        },
        {
          headers: {
            Authorization: 'Bearer ' + this.gigaChatKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            RqUID: Date.now().toString(),
          },
          httpsAgent,
          timeout: 60000,
        },
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      const err = error as Error & {
        response?: { status?: number; data?: unknown };
      };
      this.log.error(
        '[GigaChat] Authorization Key запрос не удался: ' +
          `status=${err.response?.status ?? '?'} body=${this.formatErrorBody(err.response?.data) || (error instanceof Error ? error.message : String(error))}`,
      );
      throw error;
    }
  }

  /**
   * Получение OAuth токена GigaChat (с кэшированием на 90 секунд)
   * @param httpsAgent — кастомный HTTPS-агент (rejectUnauthorized: false),
   *   обязателен на машинах с корпоративными SSL-прокси/антивирусами,
   *   иначе OAuth-эндпоинт падает с «unable to get local issuer certificate»
   */
  private gigaChatToken: string | null = null;
  private gigaChatTokenExpiry: number = 0;
  /** Promise текущего OAuth-запроса: параллельные вызовы ждут один запрос */
  private gigaChatTokenPromise: Promise<string> | null = null;

  private async getGigaChatToken(httpsAgent?: https.Agent): Promise<string> {
    // Проверяем, есть ли ещё действующий токен (оставляем 10 секунд запаса)
    if (this.gigaChatToken && Date.now() < this.gigaChatTokenExpiry - 10000) {
      return this.gigaChatToken;
    }
    // 3 ревизора стартуют параллельно: один OAuth-запрос, остальные ждут его.
    // Иначе SynGX отвечает 429 Too Many Requests.
    if (this.gigaChatTokenPromise) {
      return this.gigaChatTokenPromise;
    }
    this.gigaChatTokenPromise = this.fetchGigaChatToken(httpsAgent).finally(
      () => {
        this.gigaChatTokenPromise = null;
      },
    );
    return this.gigaChatTokenPromise;
  }

  private async fetchGigaChatToken(httpsAgent?: https.Agent): Promise<string> {
    if (!this.gigaChatKey) {
      throw new Error('GIGACHAT_API_KEY не настроен');
    }

    // Декодируем ключ (формат ClientID:ClientSecret в base64)
    const decodedKey = Buffer.from(this.gigaChatKey, 'base64').toString();
    if (!decodedKey.includes(':')) {
      throw new Error(
        'GIGACHAT_API_KEY не похож на ClientID:Secret (base64). ' +
          'Проверьте формат ключа в кабинете developers.sber.ru',
      );
    }
    const [clientId, clientSecret] = decodedKey.split(':');
    const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');

    this.log.info(
      `[GigaChat] Ключ: OAuth (ClientID:Secret), длина=${this.gigaChatKey.length}, ` +
        `префикс=${this.gigaChatKey.slice(0, 4)}...`,
    );

    // Scope: если задан GIGACHAT_SCOPE — только он; иначе PERS → CORP.
    // Раньше был жёстко зашит GIGACHAT_API_PERS: для продакшен-ключей
    // OAuth возвращал 403 «Access denied».
    const scopes: string[] = process.env.GIGACHAT_SCOPE
      ? [process.env.GIGACHAT_SCOPE]
      : ['GIGACHAT_API_PERS', 'GIGACHAT_API_CORP'];

    let lastError: unknown = null;
    for (let i = 0; i < scopes.length; i++) {
      const scope = scopes[i]!;
      // Пауза между scope-попытками: WAF Сбера (SynGX) отвечает 429
      // при частых запросах подряд.
      if (i > 0) await sleep(1500);
      try {
        this.log.debug(`[GigaChat] Получение OAuth токена (scope=${scope})...`);

        // Официальный OAuth-эндпоинт Сбера. api.giga.chat отдавал 403 от nginx
        // (запрос не доходил до API), gigachat.devices.sber.ru — ENOTFOUND.
        const oauthResponse = await axios.post(
          'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
          `scope=${scope}`,
          {
            headers: {
              Authorization: 'Basic ' + auth,
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              // RqUID обязателен для OAuth GigaChat и должен быть UUID
              // (Date.now() → 400 Bad Request)
              RqUID: randomUUID(),
            },
            httpsAgent,
            timeout: 30000,
          },
        );

        const accessToken = oauthResponse.data.access_token;
        if (!accessToken) {
          throw new Error('Не получен OAuth токен от GigaChat');
        }

        // Кэшируем токен на 90 секунд (токен жив 2 минуты)
        this.gigaChatToken = accessToken;
        this.gigaChatTokenExpiry = Date.now() + 90000;

        this.log.info(
          `[GigaChat] ✅ Токен получен (scope=${scope}, действует 90 сек)`,
        );
        return accessToken;
      } catch (error) {
        lastError = error;
        const err = error as Error & {
          response?: { status?: number; data?: unknown };
        };
        this.log.error(
          `[GigaChat] OAuth scope=${scope} не удался: ` +
            `status=${err.response?.status ?? '?'} body=${this.formatErrorBody(err.response?.data) || (error instanceof Error ? error.message : String(error))}`,
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('OAuth GigaChat не удался (все scope)');
  }

  /**
   * Запрос к GigaChat (Сбер)
   * Endpoint: https://gigachat.devices.sberbank.ru/api/v1/chat/completions
   * OAuth: https://ngw.devices.sberbank.ru:9443/api/v2/oauth
   */
  /** Очередь chat/completions: SynGX (WAF Сбера) отвечает 429 на параллельные запросы */
  private gigaChatChatQueue: Promise<unknown> = Promise.resolve();

  private async queryGigaChat(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    // Кастомный HTTPS-агент для обхода корпоративных SSL-прокси
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    // Определяем тип ключа
    if (this.isAuthorizationKey(this.gigaChatKey)) {
      return this.queryGigaChatWithAuthKey(
        modelConfig,
        systemPrompt,
        userPrompt,
        httpsAgent,
      );
    }

    // Сериализуем chat/completions: 3 ревизора стартуют параллельно, а SynGX
    // отвечает 429 на одновременные запросы (даже с валидным OAuth-токеном).
    // Один запрос за раз — как с OAuth-токеном (gigaChatTokenPromise).
    const run = (): Promise<string> =>
      this.queryGigaChatSerialized(
        modelConfig,
        systemPrompt,
        userPrompt,
        httpsAgent,
      );
    const result = this.gigaChatChatQueue.then(run, run);
    // Цепочка живёт независимо от результата: ошибка одного запроса
    // не должна блокировать следующие.
    this.gigaChatChatQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Один запрос chat/completions с ретраями на 429.
   * Вызывается строго последовательно через gigaChatChatQueue.
   */
  private async queryGigaChatSerialized(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
    httpsAgent: https.Agent,
  ): Promise<string> {
    // Получаем свежий OAuth токен (с тем же HTTPS-агентом, что и основной запрос)
    const accessToken = await this.getGigaChatToken(httpsAgent);

    // Ретраи на 429: даже последовательные запросы могут попасть под лимит
    // частоты SynGX. Задержки растут: 2с → 4с → 8с.
    const retryDelaysMs = [2000, 4000, 8000];
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await axios.post(
          'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
          {
            model: 'GigaChat',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
            stream: false,
          },
          {
            headers: {
              Authorization: 'Bearer ' + accessToken,
              'Content-Type': 'application/json',
              Accept: 'application/json',
              RqUID: Date.now().toString(),
            },
            httpsAgent,
            timeout: 60000,
          },
        );

        return response.data.choices[0].message.content;
      } catch (error) {
        const err = error as Error & {
          response?: { status?: number; data?: unknown };
        };
        const status = err.response?.status;
        const isRateLimit = status === 429;
        if (!isRateLimit || attempt >= retryDelaysMs.length) {
          this.log.error(
            '[GigaChat] chat/completions не удался: ' +
              `status=${status ?? '?'} body=${this.formatErrorBody(err.response?.data) || (error instanceof Error ? error.message : String(error))}`,
          );
          throw error;
        }
        const delayMs = retryDelaysMs[attempt]!;
        this.log.warn(
          `[GigaChat] 429 Too Many Requests — повтор через ${delayMs}мс (попытка ${attempt + 1}/${retryDelaysMs.length})`,
        );
        await sleep(delayMs);
      }
    }
  }

  /**
   * Запрос к YandexGPT (Яндекс Cloud)
   * Endpoint: https://llm.api.cloud.yandex.net/ai/v1/chatCompletions
   * Аутентификация: IAM токен
   */
  private async queryYandexGpt(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const yandexKey = this.yandexGptKey;
    if (!yandexKey) {
      throw new Error('YANDEXGPT_API_KEY не настроен');
    }

    // Получаем IAM токен (если передан Service Account key в формате JSON)
    let iamToken: string;
    try {
      const keyData = JSON.parse(yandexKey);
      if (keyData.service_account_id && keyData.private_key) {
        // Получаем IAM токен через Yandex IAM API
        const iamResponse = await axios.post(
          'https://iam.api.cloud.yandex.net/iam/v1/tokens',
          {
            serviceAccountId: keyData.service_account_id,
            jwt: keyData.jwt || '',
          },
          { timeout: 10000 },
        );
        iamToken = iamResponse.data.token;
      } else if (yandexKey.startsWith('y0_') || yandexKey.length > 50) {
        // Уже IAM токен
        iamToken = yandexKey;
      } else {
        // Пробуем как IAM токен напрямую
        iamToken = yandexKey;
      }
    } catch {
      // Если не JSON — считаем что это IAM токен
      iamToken = yandexKey;
    }

    const response = await axios.post(
      modelConfig.baseUrl,
      {
        modelUri: PortfolioConfig.yandexGpt.modelUri,
        completionOptions: {
          modelCompletionOptions: {
            maxTokens: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
          },
        },
        messages: [
          {
            role: 'system',
            text: systemPrompt,
          },
          {
            role: 'user',
            text: userPrompt,
          },
        ],
      },
      {
        headers: {
          Authorization: 'Bearer ' + iamToken,
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      },
    );

    return response.data.result.completions[0].data.text;
  }

  /**
   * Запрос к локальной модели Ollama с поддержкой кэширования и стриминга
   * Endpoint: http://localhost:11434/api/chat
   * Не требует API-ключа, работает полностью оффлайн
   */
  private async queryOllama(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
    assetTickers?: string[],
    assetsAnalysis?: AssetAnalysis[],
  ): Promise<string> {
    this.log.info('[Ollama] Проверка подключения к localhost:11434...');

    // Проверяем, запущен ли Ollama
    const isRunning = await isOllamaRunning();
    this.log.info('[Ollama] isOllamaRunning:', isRunning);
    if (!isRunning) {
      throw new Error('Ollama не запущен. Запустите Ollama на localhost:11434');
    }

    // Формируем полный промпт для кэширования
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    this.log.info('[Ollama] fullPrompt length:', fullPrompt.length);

    // Пробуем получить из кэша
    this.log.info('[Ollama] calling getCachedResponse...');
    const cachedResult = await getCachedResponse(
      fullPrompt,
      modelConfig.modelName,
      async () => {
        // Если нет в кэше, запрашиваем у модели
        return await this.executeOllamaQuery(
          modelConfig,
          systemPrompt,
          userPrompt,
          assetTickers,
          assetsAnalysis,
        );
      },
    );
    this.log.info('[Ollama] getCachedResponse returned');

    return cachedResult.content;
  }

  /**
   * Выполнение запроса к Ollama (без кэширования)
   * Усиленная версия: валидация рекомендаций против реальных данных
   */
  private async executeOllamaQuery(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
    assetTickers?: string[],
    assetsAnalysis?: AssetAnalysis[],
  ): Promise<string> {
    this.log.info(`[Ollama] Запрос к модели ${modelConfig.modelName}...`);

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      // Пробуем стриминг для лучшего UX
      this.log.info('[Ollama] calling streamChat...');
      let streamResult: StreamResult = await streamChat(
        messages,
        modelConfig.modelName,
        {
          numPredict: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
        },
        {
          timeout: 300000, // 5 минут
          stream: true,
        },
      );

      // Один ретрай на транзиентные сбои (5xx, обрывы соединения):
      // модель могла ещё не загрузиться или сервер был перегружен
      if (!streamResult.success && isTransientOllamaError(streamResult.error)) {
        this.log.warn(
          '[Ollama] ⚠️ Транзиентный сбой стриминга (' +
            (streamResult.error || 'ошибка') +
            '), повтор через 2 сек...',
        );
        await sleep(2000);
        streamResult = await streamChat(
          messages,
          modelConfig.modelName,
          {
            numPredict: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
          },
          {
            timeout: 300000, // 5 минут
            stream: true,
          },
        );
      }

      this.log.info(
        '[Ollama] streamChat returned, success:',
        streamResult.success,
      );

      if (!streamResult.success) {
        throw new Error(streamResult.error || 'Ошибка стриминга');
      }

      // Очищаем ответ от markdown-разметки и артефактов
      this.log.info('[Ollama] calling cleanAiResponse...');
      const cleanedResponse = cleanAiResponse(
        streamResult.content,
        assetTickers,
      );
      this.log.info('[Ollama] cleanAiResponse returned');

      // AI OUTPUT VALIDATION — детерминированная проверка после cleanAiResponse
      this.log.info('[Ollama] calling validateAiOutput...');
      const validatedResponse = validateAiOutput(cleanedResponse);
      this.log.info('[Ollama] validateAiOutput returned');

      // ARITHMETIC CONSISTENCY — проверяем суммы против deterministic
      this.log.info('[Ollama] calling validateArithmeticConsistency...');
      const deterministicAmounts = buildDeterministicAmounts(assetsAnalysis);
      const arithmeticValidatedResponse = validateArithmeticConsistency(
        validatedResponse,
        deterministicAmounts,
      );
      this.log.info('[Ollama] validateArithmeticConsistency returned');

      this.log.debug(
        '[Ollama] about to format stream stats, totalDuration:',
        streamResult.totalDuration,
      );

      this.log.info(
        `[Ollama] ✅ Ответ получен: ${streamResult.content.length} символов, ` +
          `${streamResult.totalTokens} токенов, ` +
          `${((streamResult.totalDuration || 0) / 1_000_000_000).toFixed(2)}с`,
      );

      return arithmeticValidatedResponse;
    } catch (error) {
      // Если стриминг не сработал, пробуем обычный запрос
      this.log.info('[Ollama] ⚠️ Стриминг не удался, пробуем обычный запрос...');

      try {
        const result: StreamResult = await chatWithoutStream(
          messages,
          modelConfig.modelName,
          {
            numPredict: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
          },
        );

        if (!result.success) {
          throw new Error(result.error || 'Ошибка запроса', { cause: error });
        }

        const cleanedResponse = cleanAiResponse(result.content, assetTickers);

        // AI OUTPUT VALIDATION — детерминированная проверка после cleanAiResponse
        const validatedResponse = validateAiOutput(cleanedResponse);

        // ARITHMETIC CONSISTENCY — проверяем суммы против deterministic
        const deterministicAmounts = buildDeterministicAmounts(assetsAnalysis);
        const arithmeticValidatedResponse = validateArithmeticConsistency(
          validatedResponse,
          deterministicAmounts,
        );

        this.log.info(
          `[Ollama] ✅ Ответ получен: ${result.content.length} символов`,
        );

        return arithmeticValidatedResponse;
      } catch (thrown: unknown) {
        if (thrown instanceof Error) {
          throw new Error(`Ollama не отвечает: ${thrown.message}`, {
            cause: thrown,
          });
        }
        // eslint-disable-next-line preserve-caught-error -- thrown is unknown, not Error
        throw new Error(`Ollama не отвечает: ${String(thrown)}`);
      }
    }
  }

  /**
   * Получение информации о моделях Ollama
   */
  public async getOllamaModelInfo(): Promise<string> {
    const isRunning = await isOllamaRunning();
    if (!isRunning) {
      return '⚠️ Ollama не запущен. Запустите Ollama на localhost:11434';
    }

    const models = await listModels();
    return formatModelList(models);
  }

  /**
   * Установка модели Ollama
   */
  public async installOllamaModel(
    modelName: string,
    onProgress?: (status: string, percent: number) => void,
  ): Promise<boolean> {
    this.log.info(`[Ollama] Установка модели ${modelName}...`);

    return pullModel(modelName, (status, completed, total) => {
      if (total > 0 && onProgress) {
        const percent = (completed / total) * 100;
        onProgress(status, percent);
      } else if (onProgress) {
        onProgress(status, 0);
      }
    });
  }

  /**
   * Получение статистики кэша
   */
  public getCacheStats(): string {
    const stats = localCache.getStats();
    return [
      '📊 Статистика кэша локальных моделей:',
      '  • Записей: ' + stats.totalEntries + '/' + stats.maxSize,
      '  • Заполненность: ' + stats.utilization,
      '  • TTL: ' + stats.ttlMinutes + ' мин',
      '  • Статус: ' + (stats.enabled ? '✅ Включен' : '⛔ Выключен'),
    ].join('\n');
  }

  /**
   * Основной метод генерации отчёта с автоматическим fallback
   * @param memoryContext — контекст из двухслойной памяти ИИ (опционально)
   * @param guardrailsContext — контекст защитных правил (опционально)
   */
  public async generateDynamicReport(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
    snapshot: PortfolioSnapshot | null,
    macroData: MacroDataContext,
    thesisResults: Map<string, InvestmentThesisResult>,
    newsContext?: string,
    actualMacroPercentages?: { stocks: number; bonds: number },
    historicalData?: {
      profitC10: number;
      profitC11: number;
      investedNet: number;
      totalPurchases: number;
      totalSales: number;
      commission: number;
      averageMonthlyDeposit?: number;
      anomalousDepositsTotal?: number;
    },
    accountsInfo?: Array<{ name: string; value: number }>,
    memoryContext?: string,
    guardrailsContext?: string,
    investorParams?: {
      horizon: string;
      goal: string;
      riskProfile: string;
      maxDrawdown: number;
    },
  ): Promise<AiResponseResult> {
    // Извлекаем тикеры активов для валидации
    const assetTickers = analysis.assetsAnalysis.map((a) => a.ticker);

    // Формируем отображение ставки ЦБ со статусом
    const { display: rateDisplay, value: rateValue, hasData } = this.formatCbrRate(macroData);

    const context = this.buildPortfolioContext(
      analysis,
      inc,
      validation,
      orders,
      snapshot,
      thesisResults,
      historicalData,
      accountsInfo,
      macroData,
    );
    this.log.info('[AI_CLIENT] buildPortfolioContext OK');

    const systemPrompt = buildSystemPrompt(
      macroData.keyRate,
      newsContext,
      assetTickers,
      macroData,
      memoryContext,
      guardrailsContext,
      investorParams,
    );
    const macroPercentages = actualMacroPercentages || {
      stocks: analysis.macro.stocksPercent,
      bonds: analysis.macro.bondsPercent,
    };
    const roundedMacros = {
      stocks: Math.round(macroPercentages.stocks * 100) / 100,
      bonds: Math.round(macroPercentages.bonds * 100) / 100,
    };

    const userPrompt = this.buildUserPrompt(
      context,
      rateDisplay,
      hasData,
      rateValue,
      newsContext,
      roundedMacros,
      {
        profitC10: historicalData?.profitC10 || 0,
        profitC11: historicalData?.profitC11 || 0,
        investedNet: historicalData?.investedNet || 0,
      },
    );

    // Получаем список доступных моделей
    const availableModels = getAvailableModels();

    if (availableModels.length === 0) {
      this.log.warn(
        '[AI] Нет доступных API-ключей. Используется локальный fallback.',
      );
      return {
        text: buildFallbackReport(
          analysis,
          inc,
          validation,
          orders,
          macroData.keyRate,
        ),
        modelUsed: 'local-fallback',
        success: false,
        error: 'Нет доступных API-ключей',
      };
    }

    this.log.info(
      `[AI] Доступные модели: ${availableModels.map((m) => m.name).join(', ')}`,
    );
    this.log.info(`[AI] Попытка запроса к: ${CURRENT_AI_MODEL.name}...`);

    // Пробуем модели по очереди: circuit breaker + retry + fallback chain.
    // Каждый провайдер защищён собственным CircuitBreaker; после N ошибок
    // подряд цепь размыкается — провайдер пропускается без лишних вызовов.
    const providers = availableModels.map((model) => ({
      id: model.id,
      name: model.name,
      query: async (system: string, user: string): Promise<string> => {
        if (model.envKey === 'OPENROUTER_API_KEY') {
          return this.queryOpenRouter(model, system, user);
        }
        if (model.id === 'ollama') {
          return this.queryOllama(
            model,
            system,
            user,
            assetTickers,
            analysis.assetsAnalysis,
          );
        }
        if (model.id === 'gigachat') {
          return this.queryGigaChat(model, system, user);
        }
        if (model.id === 'yandexgpt') {
          return this.queryYandexGpt(model, system, user);
        }
        throw new Error(`Модель ${model.name} пока не поддерживается`);
      },
    }));

    let aiText: string;
    let usedProviderName: string;
    try {
      const routeResult = await this.aiRouter.execute(
        providers,
        systemPrompt,
        userPrompt,
      );
      aiText = routeResult.text;
      usedProviderName = routeResult.providerName;
      this.log.info(
        `[AI] ✅ Ответ получен от ${usedProviderName} (${aiText.length} символов)`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log.error('[AI] Ошибка всех моделей: ' + msg);
      // Детальная отладка: выводим полный ответ ошибки
      if (error instanceof Error && 'response' in error) {
        const axiosError = error as Error & {
          response?: { data?: unknown; status?: number };
        };
        if (axiosError.response?.data) {
          this.log.error(
            '[AI] Response data:',
            JSON.stringify(axiosError.response.data, null, 2).substring(0, 500),
          );
        }
        this.log.error('[AI] Response status:', axiosError.response?.status);
      }

      // Если все модели не сработали — локальный fallback
      this.log.warn(
        '[AI] ⚠️ Все модели недоступны. Используется локальный fallback.',
      );
      return {
        text: buildFallbackReport(
          analysis,
          inc,
          validation,
          orders,
          macroData.keyRate,
        ),
        modelUsed: 'local-fallback',
        success: false,
        error: 'Все API недоступны',
        structuredJson: null,
        structuredValidation: null,
      };
    }

    // Извлекаем структурированный JSON из AI-ответа
    let structuredJson: RawAIJson | null = null;
    let structuredJsonArray: RawAIJson[] = [];
    let structuredValidation: StructuredValidationResult | null = null;

    try {
      // Сначала пробуем массив JSON (один объект на каждый актив)
      structuredJsonArray = extractJsonArrayFromAiResponse(aiText);

      if (structuredJsonArray.length > 0) {
        // Валидируем каждый элемент массива
        const validResults: RawAIJson[] = [];
        for (const item of structuredJsonArray) {
          const validation = validateStructuredAIJson(item, assetTickers);
          if (validation.valid) {
            validResults.push(item);
          } else {
            this.log.warn(
              `[AI] ⚠️ JSON валидация не пройдена для ${item.ticker}:`,
              validation.errors,
            );
          }
        }
        structuredJsonArray = validResults;
        structuredJson = validResults.length > 0 ? (validResults[0] as RawAIJson) : null;

        this.log.info(
          `[AI] JSON-массив извлечён: ${structuredJsonArray.length} актив(ов) прошло валидацию`,
        );
        for (const item of structuredJsonArray) {
          this.log.info(
            `[AI]   ${item.ticker}: ${item.recommendedAction}, confidence=${item.confidence}`,
          );
        }
      } else {
        // Fallback: одиночный JSON-объект
        structuredJson = extractJsonFromAiResponse(aiText);
        if (structuredJson) {
          // Одиночный JSON — оборачиваем в массив, чтобы ai-agent мог
          // обработать его наравне с другими активами
          structuredJsonArray = [structuredJson as RawAIJson];
          this.log.info(
            `[AI] Одиночный JSON обернут в массив: ticker=${structuredJson.ticker}`,
          );
        }
        if (structuredJson) {
          structuredValidation = validateStructuredAIJson(
            structuredJson,
            assetTickers,
          );
          this.log.info(
            `[AI] JSON извлечён: ticker=${structuredJson.ticker}, ` +
              `action=${structuredJson.recommendedAction}, ` +
              `valid=${structuredValidation?.valid ?? 'N/A'}`,
          );
          if (structuredValidation && !structuredValidation.valid) {
            this.log.warn(
              '[AI] ⚠️ JSON валидация не пройдена:',
              structuredValidation.errors,
            );
          }
        } else {
          this.log.warn('[AI] JSON-блок не найден в ответе');
          // Логгируем начало ответа AI для отладки
          this.log.info('[AI] Начало ответа AI:', aiText.slice(0, 500));
        }
      }
    } catch (err) {
      this.log.error('[AI] Ошибка парсинга JSON:', err);
    }

    return {
      text: aiText.replace(/\n/g, '<br>'),
      modelUsed: usedProviderName,
      success: true,
      structuredJson,
      structuredJsonArray,
      structuredValidation,
    };
  }

  /**
   * Универсальный запрос к провайдеру по id модели.
   * Используется ревизорами (ReviewAgent) и другими потребителями, которым
   * нужен простой текстовый ответ без кэша/валидации полного отчёта.
   *
   * Ollama — короткий ответ (512 токенов) через chatWithoutStream;
   * облачные провайдеры — через штатные query-методы.
   */
  public async queryProvider(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    if (modelConfig.id === 'ollama') {
      const result = await chatWithoutStream(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        modelConfig.modelName,
        { numPredict: 512, temperature: 0.2 },
      );
      if (!result.success) {
        throw new Error(result.error || 'Ollama не отвечает');
      }
      return result.content;
    }
    if (modelConfig.id === 'gigachat') {
      return this.queryGigaChat(modelConfig, systemPrompt, userPrompt);
    }
    if (modelConfig.envKey === 'OPENROUTER_API_KEY') {
      return this.queryOpenRouter(modelConfig, systemPrompt, userPrompt);
    }
    if (modelConfig.id === 'yandexgpt') {
      return this.queryYandexGpt(modelConfig, systemPrompt, userPrompt);
    }
    throw new Error(`Модель ${modelConfig.name} пока не поддерживается`);
  }
}
