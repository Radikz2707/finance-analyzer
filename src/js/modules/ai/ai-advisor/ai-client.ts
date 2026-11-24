import {
  PortfolioReportData,
  type AssetAnalysis,
} from '../../portfolio/portfolio-math/portfolio-math.js';
import { ValidationResult } from '../../portfolio/portfolio-math/portfolio-validator.js';
import { BondReferenceData } from '../../data/xlsx-parser/xlsx-parser.js';
import { fetchSmartLabBondByIsin } from '../../api/smart-lab-api/smart-lab-api.js';
import { getPortfolioFundamentalsOnce } from '../../api/fundamentals-api.js';
import { createNextCouponResolver } from '../../research/bond-analyzer/next-coupon-fallback.js';
import type { OfzSeries } from '../../research/bond-analyzer/bond-yield-calculator.js';
import { formatCalendarDate } from '../../shared/date-utils.js';

/** Привести тип купона из bondData к классификации серии ОФЗ. */
function toOfzSeries(value: unknown): OfzSeries | undefined {
  switch (value) {
    case 'FIXED':
    case 'FLOATER':
    case 'FIXED_AMORTIZING':
    case 'INFLATION_LINKED':
    case 'UNKNOWN':
      return value;
    default:
      return undefined;
  }
}
import { CalculatedIncome } from './income-calculator.js';
import axios from 'axios';
import https from 'https';
import { randomUUID } from 'node:crypto';
import {
  buildJsonOnlySystemPrompt,
  buildSystemPrompt,
  type MacroDataContext,
  type FundamentalMetrics,
  type BehavioralFactors,
  type BondAnalysisResult,
  type PortfolioFundamentalsContext,
} from './prompt-templates.js';
import { buildFallbackReport } from './fallback-report-builder.js';
import { UIOrdersData } from './types.js';
import { PortfolioSnapshot } from '../../portfolio/portfolio-snapshot/portfolio-snapshot.js';
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
import { PortfolioConfig } from '../../../config/portfolio-config.js';
import type { InvestmentThesisResult } from '../../research/types.js';
import {
  validateStructuredAIJson,
  type RawAIJson,
  type ValidationResult as StructuredValidationResult,
} from './structured-ai-recommendation.js';
import {
  analyzeDeepLoss,
  type DeepLossAnalysis,
} from './deep-loss-analyzer.js';
import { getLogger } from '../../shared/logger/index.js';

/** Задержка (мс) */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Дивидендные доходности из уже загруженного фундаментала.
 *
 * Вынесено в чистую функцию, чтобы значение можно было приложить к ЛЮБОМУ
 * результату generateDynamicReport — включая локальный fallback, который
 * возвращается до финального блока метода.
 */
export function buildDividendYieldsFromFundamentals(
  fundamentals: PortfolioFundamentalsContext | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const asset of fundamentals?.assets ?? []) {
    const value = asset.dividendYield?.value;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      result[asset.ticker.toUpperCase()] = value;
    }
  }
  return result;
}

/**
 * Типы ошибок, которые можно повторить (retryable).
 * - TRANSIENT: сетевые ошибки, таймауты — стоит повторить
 * - INVALID_JSON: AI вернул невалидный JSON — стоит повторить с упрощённым промптом
 * - EMPTY_RESPONSE: AI вернул пустой ответ — стоит повторить
 * - MISSING_FIELDS: AI вернул JSON без обязательных полей — стоит повторить
 */
export type AiRetryableError =
  'TRANSIENT' | 'INVALID_JSON' | 'EMPTY_RESPONSE' | 'MISSING_FIELDS';

/**
 * Проверяет, является ли ошибка retryable.
 */
export function isAiRetryableError(error: unknown): error is AiRetryableError {
  return (
    error === 'TRANSIENT' ||
    error === 'INVALID_JSON' ||
    error === 'EMPTY_RESPONSE' ||
    error === 'MISSING_FIELDS'
  );
}

/**
 * Retry-обёртка для AI-запросов с exponential backoff.
 *
 * Повторяет запрос при:
 * - Сетевых ошибках (через circuit-breaker withRetry)
 * - Невалидном JSON от AI
 * - Пустом ответе от AI
 * - Ответе без обязательных полей
 *
 * @param fn — функция запроса к AI
 * @param maxRetries — макс. число повторов (по умолчанию 2)
 * @param baseDelayMs — базовая задержка (по умолчанию 1000 мс)
 * @param onRetry — колбэк при повторе
 */
export async function withAiRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (
      error: AiRetryableError,
      attempt: number,
      delayMs: number,
    ) => void;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const onRetry = options.onRetry;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      // Если это не retryable ошибка — бросаем сразу
      if (!isAiRetryableError(error)) {
        throw error;
      }

      // Если исчерпали попытки — бросаем последнюю ошибку
      if (attempt >= maxRetries) {
        throw error;
      }

      // Exponential backoff с jitter
      const exponential = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * exponential * 0.5;
      const delayMs = Math.min(exponential + jitter, 10000); // cap at 10s

      onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
      attempt++;
    }
  }
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
  /**
   * Дивидендные доходности акций, уже загруженные при построении контекста.
   * Передаются в StrategistAgent для расчёта купонно-дивидендного якоря.
   * Новых сетевых вызовов не создаёт.
   */
  fundamentalsDividendYields?: Record<string, number>;
  /**
   * Структурированный анализ облигаций (тип купона, кредитный статус).
   * Нужен карточкам, чтобы показывать купон/кредит без участия модели.
   */
  bondAnalyses?: BondAnalysisResult[];
  /**
   * Тот же fundamentals-контекст, что использовался для промпта карточек.
   * Нужен стратегу и валидатору Д/К, чтобы не читать данные из другого места.
   */
  portfolioFundamentals?: PortfolioFundamentalsContext;
  /** Структурированный JSON от AI (может быть null если не извлечён) */
  structuredJson?: RawAIJson | null;
  /** Массив структурированных JSON-объектов от AI (по одному на каждый актив) */
  structuredJsonArray?: RawAIJson[];
  /** Общий анализ портфеля из JSON-схемы */
  portfolioSummary?: string;
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
 * Результат ответа модели: portfolioSummary + recommendations.
 * Схема: { portfolioSummary: string, recommendations: RawAIJson[] }
 */
export interface PortfolioSummaryResponse {
  portfolioSummary: string;
  recommendations: RawAIJson[];
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

  // Паттерн 3: голый JSON-массив без ``` (модель не обернула в fence).
  // Ищем первый '[{' с полем ticker и сканируем до балансирующей ']',
  // корректно пропуская строки и экранирование.
  const arrayStart = text.search(/\[\s*\{\s*"ticker"\s*:/);
  if (arrayStart >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let endIdx = -1;
    for (let i = arrayStart; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '[') {
        depth++;
      } else if (char === ']') {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx > arrayStart) {
      try {
        const parsed = JSON.parse(text.substring(arrayStart, endIdx));
        if (Array.isArray(parsed)) {
          return parsed as RawAIJson[];
        }
      } catch {
        // Обрыв (нет закрывающей скобки) — массив не восстановить
      }
    }
  }

  return [];
}

/**
 * Извлекает ответ модели: { portfolioSummary, recommendations }.
 * Схема: { portfolioSummary: string, recommendations: RawAIJson[] }
 * Используется когда схема требует объект с двумя полями.
 */
export function extractPortfolioSummaryResponse(text: string): PortfolioSummaryResponse | null {
  if (!text) return null;

  // Паттерн 1: ```json { ... } ```
  const jsonBlockPattern = /```json\s*([\s\S]*?)```/;
  let match = text.match(jsonBlockPattern);
  if (match) {
    const jsonText = match[1];
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText.trim());
        if (parsed && typeof parsed === 'object' && 'recommendations' in parsed) {
          return parsed as PortfolioSummaryResponse;
        }
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
        const parsed = JSON.parse(jsonText.trim());
        if (parsed && typeof parsed === 'object' && 'recommendations' in parsed) {
          return parsed as PortfolioSummaryResponse;
        }
      } catch {
        // fall through
      }
    }
  }

  // Паттерн 3: голый JSON объект с recommendations
  const objPattern = /\{\s*"portfolioSummary"\s*:/;
  const idx = text.search(objPattern);
  if (idx >= 0) {
    let braceCount = 0;
    let endIdx = -1;
    for (let i = idx; i < text.length; i++) {
      if (text[i] === '{') braceCount++;
      if (text[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
    if (endIdx > idx) {
      try {
        const jsonSlice = text.substring(idx, endIdx);
        const parsed = JSON.parse(jsonSlice);
        if (parsed && typeof parsed === 'object' && 'recommendations' in parsed) {
          console.log('[extractPortfolioSummaryResponse] ✅ Pattern 3 matched, portfolioSummary length:', parsed.portfolioSummary?.length);
          return parsed as PortfolioSummaryResponse;
        }
      } catch (e) {
        console.log('[extractPortfolioSummaryResponse] ❌ JSON.parse failed:', e instanceof Error ? e.message : String(e));
        console.log('[extractPortfolioSummaryResponse] JSON slice preview:', text.substring(idx, Math.min(idx + 200, endIdx)));
        // fall through
      }
    }
  }

  return null;
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
      ? rateValue +
        '%' +
        (!isFresh
          ? ' (\u26a0\ufe0f \u0434\u0430\u043d\u043d\u044b\u0435 \u0443\u0441\u0442\u0430\u0440\u0435\u043b\u0438, \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a: ' +
            (macroData.source || 'unknown') +
            ')'
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
    const totalVal = macro.totalLiquidationValue;

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
      // Сокращённый thesis — только уровень доверия и первые 40 символов
      const thesisShort = thesis
        ? (typeof thesis.confidence === 'number'
            ? thesis.confidence >= 0.8
              ? 'H'
              : thesis.confidence >= 0.5
                ? 'M'
                : 'L'
            : 'L') +
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
    _anomalyData?: Array<{
      ticker: string;
      rsi: number | null;
      sma20: number | null;
      sma50: number | null;
      /** Периоды SMA из PortfolioConfig.moexQuotes.smaPeriods. */
      smaPeriods?: number[];
      /** Значения SMA по периодам. */
      smaValues?: Record<string, number | null>;
      /** 52-недельный максимум по истории MOEX ISS. */
      high52w?: number | null;
      /** 52-недельный минимум по истории MOEX ISS. */
      low52w?: number | null;
      /** Дата последнего бара истории (ISO). */
      technicalAsOf?: string | null;
      trend: 'up' | 'down' | 'flat' | null;
      volatilityAnnual: number | null;
      riskLevel: 'low' | 'medium' | 'high' | null;
      zScoreLast: number | null;
      isLastAnomaly: boolean;
    }>,
    _financialReconciliation?: {
      totalMarketValue: number;
      totalUnrealizedPnL: number;
      realizedPnL: number;
      totalCoupons: number;
      totalDividends: number;
      totalCommissions: number;
      totalTaxes: number;
      totalDeposits: number;
      totalWithdrawals: number;
      netInvestedCapital: number;
      formula: string;
    },
    _allocationBaseValue?: number,
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

    // Добавляем новостной фон, если есть
    if (newsContext) {
      prompt += 'НОВОСТНОЙ ФОН:\n' + newsContext + '\n\n';
    }

    // ─── P0-2: Чёткие метрики с ОПРЕДЕЛЕНИЯМИ ───
    if (_historicalData) {
      const resultMarket = _historicalData.profitC10;
      const netResult = _historicalData.profitC11;
      const invested = _historicalData.investedNet;
      prompt += '=== ФИНАНСОВЫЕ ПОКАЗАТЕЛИ ===\n';
      prompt +=
        '• Результат рынка (' +
        this.fmtRubWithSign(resultMarket) +
        '): активы по цене покупки минус нетто-траты. НЕ является реализованным убытком.\n';
      prompt +=
        '• Нереализованный результат (' +
        this.fmtRubWithSign(resultMarket - netResult) +
        '): рыночная − балансовая.\n';
      prompt +=
        '• Чистый итог (' +
        this.fmtRubWithSign(netResult) +
        '): рыночная − внесённые средства.\n';
      prompt +=
        '• Вложенный капитал (' +
        this.fmtRubWithSign(invested) +
        '): все взносы − все выводы.\n';
      prompt +=
        '⚠️ Важно: «Результат рынка» — это нереализованный P&L по текущим ценам. НЕ интерпретируй как «потери на реализованных сделках». Нереализованный результат = рыночная − балансовая. Чистый итог = рыночная − внесено. Не интерпретируй иначе.\n\n';
    }

    // ─── Исторические данные и технические индикаторы ───
    if (_anomalyData && _anomalyData.length > 0) {
      prompt += '=== ИСТОРИЧЕСКИЕ ДАННЫЕ И ТЕХНИЧЕСКИЙ АНАЛИЗ ===\n';
      prompt +=
        'Для каждого актива рассчитаны технические индикаторы на основе дневной истории MOEX ISS:\n\n';

      for (const a of _anomalyData) {
        prompt += `• ${a.ticker}:\n`;
        prompt += `  - RSI(14): ${a.rsi !== null ? a.rsi.toFixed(1) : 'нет данных'}`;
        if (a.rsi !== null) {
          if (a.rsi < 30) prompt += ' (перепроданность, возможен отскок вверх)';
          else if (a.rsi > 70)
            prompt += ' (перекупленность, возможен отскок вниз)';
        }
        prompt += '\n';

        const smaPeriods = a.smaPeriods ?? [];
        const smaValues = a.smaValues ?? {};
        if (smaPeriods.length > 0) {
          for (const period of smaPeriods) {
            const value = smaValues[String(period)] ?? null;
            prompt += `  - SMA${period}: ${
              value !== null ? value.toFixed(2) : 'недоступно'
            }\n`;
          }
        } else {
          prompt += `  - SMA20: ${a.sma20 !== null ? a.sma20.toFixed(2) : 'недоступно'}\n`;
          prompt += `  - SMA50: ${a.sma50 !== null ? a.sma50.toFixed(2) : 'недоступно'}\n`;
        }

        if (a.high52w != null && a.low52w != null) {
          prompt += `  - 52-недельный диапазон: ${a.low52w.toFixed(2)}–${a.high52w.toFixed(2)}`;
          if (a.technicalAsOf) prompt += ` (MOEX ISS, ${a.technicalAsOf})`;
          prompt += '\n';
        } else {
          prompt += '  - 52-недельный диапазон: недоступно\n';
        }
        prompt += `  - Тренд: ${a.trend !== null ? (a.trend === 'up' ? 'восходящий' : a.trend === 'down' ? 'нисходящий' : 'боковик') : 'нет данных'}\n`;
        prompt += `  - Волатильность (годовая): ${a.volatilityAnnual !== null ? (a.volatilityAnnual * 100).toFixed(1) + '%' : 'нет данных'}\n`;
        prompt += `  - Риск: ${a.riskLevel !== null ? (a.riskLevel === 'low' ? 'низкий' : a.riskLevel === 'medium' ? 'средний' : 'высокий') : 'нет данных'}\n`;
        prompt += `  - Z-score: ${a.zScoreLast !== null ? a.zScoreLast.toFixed(2) : 'нет данных'}`;
        if (a.zScoreLast !== null) {
          if (Math.abs(a.zScoreLast) > 2) prompt += ' (аномалия)';
        }
        prompt += '\n';

        if (a.isLastAnomaly) {
          prompt += `  ⚠️ ${a.ticker}: обнаружена аномалия на последнем баре!\n`;
        }
        prompt += '\n';
      }

      prompt +=
        'ИСПОЛЬЗУЙ эти данные для рекомендации оптимальных точек входа/выхода:\n';
      prompt +=
        '- RSI < 30 + цена ниже короткой/длинной SMA → потенциальная точка покупки (перепроданность)\n';
      prompt +=
        '- RSI > 70 + цена выше короткой/длинной SMA → потенциальная точка продажи (перекупленность)\n';
      prompt +=
        '- Восходящий тренд + низкая волатильность → благоприятная среда для покупки\n';
      prompt +=
        '- Нисходящий тренд + высокая волатильность → осторожность с покупками\n';
      prompt +=
        '- Z-score > 2 или < -2 → аномальное движение, требует внимания\n\n';
    }

    // ─── P4: Мост финансовой сверки и P5: allocationBaseValue ───
    if (_financialReconciliation) {
      const fr = _financialReconciliation;
      prompt += '=== ФИНАНСОВАЯ СВЕРКА ===\n';
      prompt +=
        'Текущая стоимость портфеля: ' +
        fr.totalMarketValue.toLocaleString('ru-RU') +
        ' ₽\n';
      prompt +=
        'Чистый вложенный капитал: ' +
        fr.netInvestedCapital.toLocaleString('ru-RU') +
        ' ₽\n';
      prompt +=
        'Нереализованный P&L: ' +
        fr.totalUnrealizedPnL.toLocaleString('ru-RU') +
        ' ₽\n';
      prompt +=
        'Реализованный P&L: ' + fr.realizedPnL.toLocaleString('ru-RU') + ' ₽\n';
      prompt += 'Купоны: ' + fr.totalCoupons.toLocaleString('ru-RU') + ' ₽\n';
      prompt +=
        'Дивиденды: ' + fr.totalDividends.toLocaleString('ru-RU') + ' ₽\n';
      prompt +=
        'Комиссии: ' + fr.totalCommissions.toLocaleString('ru-RU') + ' ₽\n';
      prompt += 'Налоги: ' + fr.totalTaxes.toLocaleString('ru-RU') + ' ₽\n';
      prompt += 'Взносы: ' + fr.totalDeposits.toLocaleString('ru-RU') + ' ₽\n';
      prompt +=
        'Выводы: ' + fr.totalWithdrawals.toLocaleString('ru-RU') + ' ₽\n';
      prompt += 'Формула: ' + fr.formula + '\n';
      prompt += '\n';
      prompt +=
        'ИСПОЛЬЗУЙ эти данные для проверки согласованности рекомендаций:\n';
      prompt += '- Чистый итог = totalMarketValue − netInvestedCapital\n';
      prompt += '- Доходность = чистыйИтог / netInvestedCapital × 100%\n';
      prompt +=
        '- Если totalMarketValue ≠ netInvestedCapital + unrealizedPnL + realizedPnL + coupons + dividends − commissions − taxes → проверь данные\n\n';
    }

    if (_allocationBaseValue) {
      prompt += '=== РАСЧЁТНАЯ БАЗА (allocationBaseValue) ===\n';
      prompt += 'Проценты и рублёвые отклонения рассчитываются относительно:\n';
      prompt +=
        'allocationBaseValue = ' +
        _allocationBaseValue.toLocaleString('ru-RU') +
        ' ₽\n';
      prompt +=
        'Это стоимость портфеля (liquidation value), которую использует PortfolioMath для расчёта:\n';
      prompt +=
        '- currentPercent = (assetValue / allocationBaseValue) × 100%\n';
      prompt +=
        '- deficitRub = round(deviationPct / 100 × allocationBaseValue)\n';
      prompt += '- targetRub = targetPercent / 100 × allocationBaseValue\n';
      prompt += '\n';
      prompt +=
        'ЕСЛИ часть активов исключена из базы (holdOnly, excludeFromStockPool) — это может привести к расхождению между суммой assetValues и allocationBaseValue.\n';
      prompt +=
        'Проверь calculationBaseBreakdown в отчёте для детализации.\n\n';
    }

    prompt += '=== ЗАДАЧА ===\n';
    prompt += 'Проанализируй портфель:\n';
    prompt += '- Ставка ЦБ: ' + rateDisplay + '\n';
    prompt +=
      '- Структура: Акции ' + stocksPct + '%, Облигации ' + bondsPct + '%\n';
    prompt += '- Дата: ' + currentMonth + '\n\n';

    // ─── ПОЛНЫЙ АНАЛИЗ ПОРТФЕЛЯ (portfolioSummary) ───
    prompt += '=== ПОЛНЫЙ АНАЛИЗ ПОРТФЕЛЯ (portfolioSummary) ===\n';
    prompt += 'Верни JSON-объект с полем portfolioSummary — ПОЛНЫЙ АНАЛИЗ 5-8 РАЗДЕЛЬНЫХ АБЗАЦЕВ.\n';
    prompt += 'РАЗДЕЛЯЙ каждый абзац символом \n\n (двойной перенос строки).\n';
    prompt += 'Каждый абзац должен содержать 3-5 РАЗВЁРНУТЫХ предложений с конкретными цифрами и фактами.\n';
    prompt += 'Каждый абзац — минимум 60 слов.\n\n';

    prompt += 'СТРУКТУРА КАЖДОГО АБЗАЦА:\n';
    prompt += '1) СТРУКТУРА ПОРТФЕЛЯ:\n';
    prompt += '   Начни с: "Портфель на [дата] оценивается в [сумма] ₽"\n';
    prompt += '   Укажи: доли акций/облигаций/ETF в процентах и рублях.\n';
    prompt += '   Сравни с целевой структурой: "Акции составляют X% против целевых Y% — дефицит Z п.п."\n';
    prompt += '   Пример: "Портфель на 23.11.2026 оценивается в 613 771,95 ₽ с долей акций 31,17% (191 342 ₽) и облигаций 68,83% (422 430 ₽). Доля акций ниже целевой на 8,6 п.п."\n\n';

    prompt += '2) P&L (ПРИБЫЛЬ/УБЫТОК):\n';
    prompt += '   Укажи: вложенный капитал, текущий результат в рублях и процентах.\n';
    prompt += '   Интерпретируй: "в плюсе" или "в минусе", относительно допустимой просадки 20%.\n';
    prompt += '   Укажи: торговый результат по цене покупки.\n';
    prompt += '   Пример: "Вложенный капитал составляет 830 690 ₽, что формирует нереализованный убыток в размере -69 838 ₽, или -8,41% от вложений. Текущая просадка находится в пределах допустимого лимита в 20%."\n\n';

    prompt += '3) ЛИКВИДНОСТЬ:\n';
    prompt += '   Укажи: свободный кэш (руб), средний ежемесячный взнос (руб).\n';
    prompt += '   Оцени: способность совершать покупки — "минимальный кэш, но ежемесячный приток позволяет..."\n';
    prompt += '   Пример: "Свободный кэш минимален (146,07 ₽), но ежемесячный денежный поток в 14 671 ₽ обеспечивает возможность постепенного закрытия дефицита позиций без необходимости дополнительных вложений."\n\n';

    prompt += '4) КЛЮЧЕВЫЕ РИСКИ:\n';
    prompt += '   Перечисли: глубокие просадки отдельных активов (тикер + %), концентрация (макс. доля одного актива).\n';
    prompt += '   Укажи: блокировки (no-sell, BLOCKED), профицит/дефицит.\n';
    prompt += '   Пример: "Ключевой риск — глубокая просадка позиции PLZL (Полюс) на -57,6% с максимума 2409,8 ₽. Максимальная концентрация — PLZL 16,8% портфеля, что близко к лимиту 20%. Позиция заблокирована политикой no-sell."\n\n';

    prompt += '5) МАКРО-КОНТЕКСТ:\n';
    prompt += '   Укажи: ставку ЦБ (значение, источник, свежесть данных).\n';
    prompt += '   Оцени: инфляцию если есть, неопределённость (высокая/умеренная).\n';
    prompt += '   Пример: "Ключевая ставка ЦБ составляет 14% (от 08.09.2026, данные устарели). Высокая ставка поддерживает привлекательность облигаций, но оказывает давление на акции роста."\n\n';

    prompt += '6) СТРАТЕГИЧЕСКИЕ ВЫВОДЫ:\n';
    prompt += '   Оцени: соответствует ли структура портфеля макро-контексту.\n';
    prompt += '   Баланс: риск/доходность, главная рекомендация по позиции.\n';
    prompt += '   Пример: "Текущая структура с долей облигаций 68,83% оптимальна при ставке 14%. Портфель сбалансирован, но требует ребалансировки акций при накоплении средств."\n\n';

    prompt += '7) ПЕРСПЕКТИВЫ И РЕКОМЕНДАЦИИ (ОПЦИОНАЛЬНО, 7-8 абзац):\n';
    prompt += '   Оцени: горизонт 1-3 мес, 3-12 мес, 1+ лет.\n';
    prompt += '   Укажи: что мониторить (котировки, макро, новости).\n';
    prompt += '   3-5 конкретных действий в приоритетном порядке.\n\n';

    prompt += 'ВСЕ числа и факты — ТОЛЬКО из переданного контекста, с указанием источника и даты. Не более одного предложения на отдельный актив.\n';
    prompt += '⚠️ ВАЖНО: portfolioSummary ДОЛЖЕН содержать минимум 5 абзацев, разделённых \n\n. Не объединяй всё в один абзац. Каждый абзац — 3-5 предложений.\n\n';

    prompt += '=== ОТВЕТ ===\n';
    if (hasData) {
      prompt += '1. Макро: соответствие структуры ставке ' + rateValue + '%\n';
    } else {
      prompt +=
        '1. Макро: данные о ставке ЦБ отсутствуют — укажи "нет данных"\n';
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
        seed: modelConfig.seed,
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

    this.log.info(
      '[OPENROUTER] ✅ Response received, status:',
      response.status,
    );
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
          seed: modelConfig.seed,
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
            seed: modelConfig.seed,
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
        modelUri: PortfolioConfig.yandexgpt.modelUri,
        completionOptions: {
          modelCompletionOptions: {
            maxTokens: modelConfig.maxTokens,
            temperature: modelConfig.temperature,
            seed: modelConfig.seed,
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

    let streamResult: StreamResult = {
      content: '',
      model: modelConfig.modelName,
      totalTokens: 0,
      totalDuration: 0,
      loadDuration: 0,
      success: false,
    };
    try {
      // Пробуем стриминг для лучшего UX
      this.log.info('[Ollama] calling streamChat...');
      streamResult = await streamChat(
        messages,
        modelConfig.modelName,
        {
          numPredict: 8192,
          numCtx: 20480,
          temperature: modelConfig.temperature,
          seed: modelConfig.seed,
          jsonSchema: {
            type: 'object',
            properties: {
              portfolioSummary: {
                type: 'string',
                  description: 'ПОЛНЫЙ АНАЛИЗ ПОРТФЕЛЯ. ОБЯЗАТЕЛЬНО: 6 разделов — 1) Структура (стоимость, доли А/О/ETF) 2) P&L (вложено, результат руб/%, интерпретация) 3) Ликвидность (кэш, взносы, способность к покупкам) 4) Риски (просадки, концентрация, no-sell) 5) Макро (ставка ЦБ, свежесть, неопределённость) 6) Выводы (соответствие структуры макро, баланс риск/доходность). 5-8 РАЗВЁРНУТЫХ абзацев, каждый 3-5 предложений, разделённых \n\n. Все числа — из контекста с источником.',
              },
              recommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    ticker: { type: 'string' },
                    recommendedTargetPercent: { type: ['number', 'null'] },
                    recommendedAction: {
                      enum: [
                        'BUY',
                        'SELL',
                        'HOLD',
                        'REDUCE',
                        'EXIT',
                        'AVOID',
                        'AVERAGE',
                      ],
                    },
                    confidence: { type: 'number' },
                    rationale: { type: 'string' },
                    targetReason: { type: 'string' },
                    keyRisks: { type: ['array', 'null'], items: { type: 'string' } },
                    keyCatalysts: { type: ['array', 'null'], items: { type: 'string' } },
                    agreementWithPortfolioMath: {
                      enum: ['AGREE', 'DISAGREE', 'UNCERTAIN'],
                    },
                    fundamentalAnalysis: { type: ['string', 'null'] },
                    technicalTiming: { type: ['string', 'null'] },
                    entryStrategy: { type: ['string', 'null'] },
                    issuerContext: { type: ['string', 'null'] },
                    dataSources: { type: ['array', 'null'], items: { type: 'string' } },
                  },
                  required: [
                    'ticker',
                    'recommendedAction',
                    'confidence',
                    'rationale',
                    'agreementWithPortfolioMath',
                    'recommendedTargetPercent',
                  ],
                },
              },
            },
            required: ['portfolioSummary', 'recommendations'],
          } as Record<string, unknown>,
          keepAlive: '60m', // модель остаётся в памяти 60 минут
        },
        {
          timeout: 1200000, // 20 минут — полный отчёт может генерироваться долго
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
            numPredict: 8192,
            numCtx: 20480,
            temperature: modelConfig.temperature,
            seed: modelConfig.seed,
            jsonSchema: {
              type: 'object',
              properties: {
                portfolioSummary: {
                  type: 'string',
                description: 'ПОЛНЫЙ АНАЛИЗ ПОРТФЕЛЯ. ОБЯЗАТЕЛЬНО: 6 разделов — 1) Структура (стоимость, доли А/О/ETF) 2) P&L (вложено, результат руб/%, интерпретация) 3) Ликвидность (кэш, взносы, способность к покупкам) 4) Риски (просадки, концентрация, no-sell) 5) Макро (ставка ЦБ, свежесть, неопределённость) 6) Выводы (соответствие структуры макро, баланс риск/доходность). 5-8 РАЗВЁРНУТЫХ абзацев, каждый 3-5 предложений, разделённых \n\n. Все числа — из контекста с источником.',
                },
                recommendations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      ticker: { type: 'string' },
                      recommendedTargetPercent: { type: ['number', 'null'] },
                      recommendedAction: {
                        enum: [
                          'BUY',
                          'SELL',
                          'HOLD',
                          'REDUCE',
                          'EXIT',
                          'AVOID',
                          'AVERAGE',
                        ],
                      },
                      confidence: { type: 'number' },
                      rationale: { type: 'string' },
                      targetReason: { type: 'string' },
                      keyRisks: { type: ['array', 'null'], items: { type: 'string' } },
                      keyCatalysts: { type: ['array', 'null'], items: { type: 'string' } },
                      agreementWithPortfolioMath: {
                        enum: ['AGREE', 'DISAGREE', 'UNCERTAIN'],
                      },
                      fundamentalAnalysis: { type: ['string', 'null'] },
                      technicalTiming: { type: ['string', 'null'] },
                      entryStrategy: { type: ['string', 'null'] },
                      issuerContext: { type: ['string', 'null'] },
                      dataSources: { type: ['array', 'null'], items: { type: 'string' } },
                    },
                    required: [
                      'ticker',
                      'recommendedAction',
                      'confidence',
                      'rationale',
                      'agreementWithPortfolioMath',
                      'recommendedTargetPercent',
                    ],
                  },
                },
              },
              required: ['portfolioSummary', 'recommendations'],
            } as Record<string, unknown>,
            keepAlive: '60m',
          },
          {
            timeout: 1200000, // 20 минут
            stream: true,
          },
        );
      }

      this.log.info(
        '[Ollama] streamChat returned, success:',
        streamResult.success,
      );
      this.log.info(
        `[Ollama] prompt_tokens=${streamResult.promptTokens ?? 'n/a'}, ` +
          `output_tokens=${streamResult.totalTokens}, ` +
          `duration=${streamResult.totalDuration}ms, load=${streamResult.loadDuration}ms`,
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
      this.log.info(
        '[Ollama] ⚠️ Стриминг не удался, пробуем обычный запрос...',
      );

      // При таймауте стрима НЕ запускаем fallback на chatWithoutStream —
      // повторный прогон промпта с нуля гарантированно приведёт к ещё одному
      // 30-минутному зависанию. Сразу возвращаем ошибку.
      if (streamResult.error?.includes('timeout')) {
        this.log.error(
          '[Ollama] ⛔ Пропуск fallback: таймаут стрима — повторный прогон ' +
            'промпта с нуля приведёт к повторному зависанию',
        );
        throw new Error(streamResult.error, { cause: error });
      }

      try {
        const result: StreamResult = await chatWithoutStream(
          messages,
          modelConfig.modelName,
          {
            numPredict: Math.max(modelConfig.maxTokens, 8192),
            temperature: modelConfig.temperature,
            seed: modelConfig.seed,
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
    bondMarketData?: Map<string, Record<string, unknown>>,
    anomalyData?: Array<{
      ticker: string;
      rsi: number | null;
      sma20: number | null;
      sma50: number | null;
      /** Периоды SMA из PortfolioConfig.moexQuotes.smaPeriods. */
      smaPeriods?: number[];
      /** Значения SMA по периодам. */
      smaValues?: Record<string, number | null>;
      /** 52-недельный максимум по истории MOEX ISS. */
      high52w?: number | null;
      /** 52-недельный минимум по истории MOEX ISS. */
      low52w?: number | null;
      /** Дата последнего бара истории (ISO). */
      technicalAsOf?: string | null;
      trend: 'up' | 'down' | 'flat' | null;
      volatilityAnnual: number | null;
      riskLevel: 'low' | 'medium' | 'high' | null;
      zScoreLast: number | null;
      isLastAnomaly: boolean;
    }>,
    liquidityAnalysis?: import('./liquidity-analyzer.js').LiquidityAnalysis,
  ): Promise<AiResponseResult> {
    // Извлекаем тикеры активов для валидации
    const assetTickers = analysis.assetsAnalysis.map((a) => a.ticker);

    // Формируем отображение ставки ЦБ со статусом
    const {
      display: rateDisplay,
      value: rateValue,
      hasData,
    } = this.formatCbrRate(macroData);

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

    // ─── Deep Loss Analysis — анализ глубокого падения активов ───
    // Находим активы с просадкой > -20% и анализируем причины
    const deepLossThreshold = -20;
    let deepLossContext: DeepLossAnalysis | undefined;
    let fundamentalMetrics: FundamentalMetrics | undefined;
    let behavioralFactors: BehavioralFactors | undefined;

    for (const asset of analysis.assetsAnalysis) {
      const balancePrice = asset.balancePrice ?? 0;
      const currentPrice = asset.currentPrice ?? 0;
      const drawdownPercent =
        balancePrice > 0
          ? ((currentPrice - balancePrice) / balancePrice) * 100
          : 0;

      if (drawdownPercent <= deepLossThreshold) {
        // Рассчитываем рыночную и секторную просадки
        const marketDrawdown = this.calculateMarketDrawdown(analysis);
        const sectorDrawdown = this.calculateSectorDrawdown(asset, analysis);

        // Извлекаем макро-данные
        const keyRateChange =
          macroData.keyRate > 0 ? macroData.keyRate - 15 : 0;
        const currencyChange = macroData.currency ?? 0;
        const oilChange = macroData.oil ?? 0;

        // Проверяем фундаментал (упрощённо)
        const hasPositiveFundamentals = this.checkPositiveFundamentals(asset);

        deepLossContext = analyzeDeepLoss({
          asset,
          marketDrawdown,
          sectorDrawdown,
          keyRateChange,
          keyRate: macroData.keyRate,
          currencyChange,
          oilChange,
          hasPositiveFundamentals,
        });
        const metrics = this.calculateFundamentalMetrics(asset);
        if (metrics) fundamentalMetrics = metrics;
        const factors = this.calculateBehavioralFactors(asset);
        if (factors) behavioralFactors = factors;
        this.log.info(
          `[AI] Глубокое падение: ${asset.ticker} (${asset.name}) ${drawdownPercent.toFixed(1)}% — ${deepLossContext.primaryReason}`,
        );
        if (fundamentalMetrics) {
          this.log.info(
            `[AI] Фундаментальные метрики: ${asset.ticker} — ${fundamentalMetrics.fundamentalHealth}`,
          );
        }
        if (behavioralFactors) {
          this.log.info(
            `[AI] Поведенческие факторы: ${asset.ticker} — ${behavioralFactors.lossAversion}`,
          );
        }
        break; // Анализируем первый актив с глубоким падением
      }
    }

    // ─── Bond Analysis — структурированный анализ ВСЕХ облигаций портфеля ───
    interface BondAnalysisResult {
      isin: string;
      name: string;
      issuer: string;
      quantity: number;
      currentPrice: number | null;
      balanceValue: number;
      /** Статус анализа: SUCCESS / INSUFFICIENT_DATA / ERROR */
      analysisStatus: 'SUCCESS' | 'INSUFFICIENT_DATA' | 'ERROR';
      yieldAnalysis: {
        currentYield: number | null;
        ytm: number | null;
        effectiveYield: number | null;
        annualCouponIncome: number | null;
        couponType: string;
        /** Причина UNKNOWN-классификации купона (конфликт/пробел источника). */
        couponTypeReason?:
          'excel_conflict' | 'ofz_no_coupon' | 'type_unconfirmed' | null;
        /** «Excel FIXED, ISS FLOATER (ОФЗ-ПК)» — для карточки. */
        couponTypeReasonDetail?: string | null;
        /** Источник подтверждения типа: ISS / SERIES / EXCEL. */
        couponTypeSource?: string | null;
        /** Источник доходности: EXCEL_COLUMN / EXCEL_COMPUTED / SMART_LAB_PROBE. */
        yieldSource?: 'EXCEL_COLUMN' | 'EXCEL_COMPUTED' | 'SMART_LAB_PROBE' | null;
        /** Методика YTM: QUIK / расчёт / флоатер при неизменной ставке. */
        ytmMethod?: string | null;
        dataQuality: string;
        nextCouponDate?: string | null;
        /** Источник даты: EXCEL (дата файла) / MOEX_ISS / SMART_LAB. */
        nextCouponDateSource?: 'EXCEL' | 'MOEX_ISS' | 'SMART_LAB' | null;
      };
      durationAnalysis: {
        duration: number | null;
        durationType: string;
        dv01: number | null;
        originalDv01?: { value: number; unit: string; scope: string };
        scenarios: Array<{
          yieldChangePct: number;
          priceImpactPct: number;
          priceImpactRub: number;
        }>;
        dataQuality: string;
        derivedDataQuality: string;
      };
      creditAssessment: {
        quality: string;
        source: string;
        asOfDate?: string | null;
        rating?: { agency: string; rating: string; outlook: string } | null;
        summary: string;
      };
      recommendation: string;
      rationale: string;
      moexData: {
        couponType?: string;
        icbrrRating?: string;
        sector?: string;
        floatSpreadPct?: number;
        floatIndex?: string;
        hasOption?: boolean;
        /** Объём оборота (млн руб.) из Smart-Lab probe, если пуст в Excel. */
        turnoverFromSmartLab?: number | null;
      };
      /** Недостающие данные для анализа */
      missingData: string[];
      /** Согласованность с PortfolioMath: AGREE / DISAGREE */
      mathAgreement: string;
      /** Влияние на структуру портфеля */
      portfolioImpact: string;
    }

    const bondAnalyses: BondAnalysisResult[] = [];

    /**
     * Создаёт BondAnalysisResult с INSUFFICIENT_DATA для облигации без рыночных данных.
     * P0-4: Все облигации портфеля остаются в отчёте с явным статусом недостаточности данных.
     */
    function createInsufficientDataBondResult(
      asset: AssetAnalysis,
    ): BondAnalysisResult {
      return {
        isin: asset.ticker.trim().toUpperCase(),
        name: asset.name || '',
        issuer: '',
        quantity: asset.quantity || 0,
        currentPrice: null,
        balanceValue: asset.balancePrice * (asset.quantity || 0),
        analysisStatus: 'INSUFFICIENT_DATA',
        yieldAnalysis: {
          currentYield: null,
          ytm: null,
          effectiveYield: null,
          annualCouponIncome: null,
          couponType: 'UNKNOWN',
          dataQuality: 'MISSING',
        },
        durationAnalysis: {
          duration: null,
          durationType: 'UNKNOWN',
          dv01: null,
          originalDv01: undefined,
          scenarios: [],
          dataQuality: 'MISSING',
          derivedDataQuality: 'MISSING',
        },
        creditAssessment: {
          quality: 'INSUFFICIENT_DATA',
          source: 'NONE',
          summary: 'Отсутствуют рыночные данные для анализа',
        },
        recommendation: 'INSUFFICIENT_DATA',
        rationale: 'Отсутствуют рыночные данные для анализа облигации',
        moexData: {},
        missingData: [
          'Отсутствуют рыночные данные для анализа',
          'Доходность из листа «Облигации» не найдена',
          'Кредитное качество не подтверждено',
        ],
        mathAgreement: 'INSUFFICIENT_DATA',
        portfolioImpact:
          'Невозможно оценить влияние на структуру портфеля без данных',
      };
    }

    // Находим ВСЕ облигации в портфеле
    const bondAssets = analysis.assetsAnalysis.filter(
      (a) =>
        a.assetType.toUpperCase() === 'BOND' ||
        a.assetType === 'О' ||
        a.assetType === 'Облигация',
    );

    this.log.info(
      `[BondAnalysis] Найдено ${bondAssets.length} облигаций в портфеле`,
    );

    // ─── Обработка случая: bondMarketData отсутствует или пуст ───
    if (!bondMarketData || bondMarketData.size === 0) {
      this.log.warn(
        '[BondAnalysis] ⚠️ bondMarketData отсутствует или пуст — все облигации получают INSUFFICIENT_DATA',
      );
      for (const bondAsset of bondAssets) {
        bondAnalyses.push(createInsufficientDataBondResult(bondAsset));
      }
    } else {
      // Загружаем bond-анализаторы лениво
      const { analyzeYield } =
        await import('../../research/bond-analyzer/bond-yield-calculator.js');
      const { analyzeDuration } =
        await import('../../research/bond-analyzer/bond-duration-calculator.js');
      const { analyzeCredit } =
        await import('../../research/bond-analyzer/bond-credit-analyzer.js');
      const { buildBondFinalAssessment } =
        await import('../../research/bond-analyzer/bond-analyst-summary.js');

      // Фолбэк даты купона: кэш по ISIN + лимит запросов за прогон.
      const nextCouponResolver = createNextCouponResolver({
        fetchSmartLab: (isin) => fetchSmartLabBondByIsin(isin),
        logger: {
          info: (message) => this.log.info(message),
          warn: (message) => this.log.warn(message),
        },
      });

      for (const bondAsset of bondAssets) {
        // P0-5: Нормализация ISIN — только trim и uppercase
        const normalizedIsin = bondAsset.ticker.trim().toUpperCase();

        // P0-5: Валидация ISIN — некорректный ISIN не участвует в автоматическом сопоставлении
        // Но пробуем fallback-поиск по имени, если ISIN не прошёл валидацию
        let bondData = bondMarketData.get(normalizedIsin);

        // P1: диагностика матчинга — видно, нашлась ли запись в bondsMap
        console.log(
          `[BondAnalysis] isin=${normalizedIsin} ` +
            `bondData=${bondData ? 'FOUND' : 'MISSING'} ` +
            `bondMarketDataSize=${bondMarketData.size}`,
        );

        if (!bondData) {
          // Fallback: поиск по instrumentName, если ISIN невалиден или не найден
          const bondDataByName = this.findBondByName(
            bondAsset,
            bondMarketData as unknown as Map<string, BondReferenceData>,
            normalizedIsin,
          );
          if (bondDataByName) {
            bondData = bondDataByName as unknown as Record<string, unknown>;
            this.log.info(
              `[BondAnalysis] ✅ Найдено по имени: ${bondAsset.name} → ${bondDataByName.instrumentName}`,
            );
          } else if (!this.isValidIsin(normalizedIsin)) {
            this.log.warn(
              `[BondAnalysis] ⚠️ Некорректный ISIN ${normalizedIsin} для ${bondAsset.name}`,
            );
          } else {
            this.log.warn(
              `[BondAnalysis] ⚠️ Нет справочных данных для ISIN ${normalizedIsin}`,
            );
          }
        }

        // Если bondData так и не найден — пробуем Smart-Lab
        if (!bondData) {
          const smartlabBond = await fetchSmartLabBondByIsin(normalizedIsin);
          if (smartlabBond) {
            this.log.info(
              `[BondAnalysis] ✅ Данные загружены с Smart-Lab: ${smartlabBond.ticker} (доходность: ${smartlabBond.yield}%, цена: ${smartlabBond.price}%)`,
            );
            // Создаём временный bondData из Smart-Lab
            bondData = {
              isin: smartlabBond.isin,
              instrumentName: smartlabBond.ticker,
              nominal: smartlabBond.nominal || 1000,
              bondType: smartlabBond.bondType || 'FIXED',
              couponType: 'FIXED',
              couponYield: smartlabBond.couponRate,
              currentYield: smartlabBond.yield,
              yield: smartlabBond.yield, // ← для yield analysis
              maturityDate: smartlabBond.maturityDate,
              price: smartlabBond.price,
              duration: smartlabBond.durationDays,
              nkd: smartlabBond.nkd,
              // Дата ближайшей выплаты из Smart-Lab: без неё карточка
              // показывает «дата не указана» при доступном источнике.
              nextCouponDate: smartlabBond.nextCouponDate,
              rating: smartlabBond.rating,
              source: 'smart-lab',
            } as unknown as Record<string, unknown>;
          } else {
            this.log.warn(
              `[BondAnalysis] ❌ Нет данных для ${bondAsset.name} (${normalizedIsin}) в Smart-Lab`,
            );
          }
        }

        // Если bondData есть, но нет rating — пробуем Smart-Lab как fallback
        // Отслеживаем, был ли yield заполнен из Smart-Lab probe
        let yieldFromSmartLab = false;

        if (bondData && !bondData.rating) {
          try {
            this.log.info(
              `[BondAnalysis] 🔍 ${bondAsset.ticker}: нет rating в Excel, запрашиваем Smart-Lab`,
            );
            const smartlabBond = await fetchSmartLabBondByIsin(normalizedIsin);
            if (smartlabBond && smartlabBond.rating) {
              this.log.info(
                `[BondAnalysis] ✅ Рейтинг загружен с Smart-Lab: ${smartlabBond.rating} для ${bondAsset.name}`,
              );
              bondData.rating = smartlabBond.rating;
            } else {
              this.log.warn(
                `[BondAnalysis] ⚠️ Smart-Lab не вернул rating для ${bondAsset.name}`,
              );
            }
            // P3: если yield пустой — догружаем с Smart-Lab (для ВИС и подобных)
            if (
              smartlabBond &&
              smartlabBond.yield != null &&
              smartlabBond.yield > 0
            ) {
              const hadExcelYield = bondData.yield != null && Number(bondData.yield) > 0;
              if (!hadExcelYield) {
                yieldFromSmartLab = true;
              }
              bondData.yield = smartlabBond.yield;
              this.log.info(
                `[BondAnalysis] ✅ Yield загружен с Smart-Lab: ${smartlabBond.yield}% для ${bondAsset.name}`,
              );
            }
            // P3: если turnover пустой — догружаем volume из Smart-Lab (для ВИС и подобных)
            if (
              smartlabBond &&
              smartlabBond.volume != null &&
              smartlabBond.volume > 0 &&
              (bondData.turnover == null || Number(bondData.turnover) === 0)
            ) {
              bondData.turnover = smartlabBond.volume * 1e6; // млн руб → руб
              this.log.info(
                `[BondAnalysis] ✅ Volume загружен с Smart-Lab: ${smartlabBond.volume} млн руб для ${bondAsset.name}`,
              );
            }
          } catch (err) {
            this.log.warn(
              `[BondAnalysis] ⚠️ Smart-Lab fallback для рейтинга не удался: ${err}`,
            );
          }
        }

        // P3: Отдельный fallback для turnover — если в Excel 0, пробуем MOEX ISS
        if (bondData && (bondData.turnover == null || Number(bondData.turnover) === 0)) {
          try {
            const moexTurnover = await this.fetchBondTurnoverFromMoex(normalizedIsin);
            if (moexTurnover != null && moexTurnover > 0) {
              bondData.turnover = moexTurnover;
              this.log.info(
                `[BondAnalysis] ✅ Turnover загружен с MOEX: ${moexTurnover.toLocaleString('ru-RU')} руб для ${bondAsset.name}`,
              );
            }
          } catch {
            // MOEX недоступен — оставляем 0
          }
        }

        // Если bondData так и не найден — создаём INSUFFICIENT_DATA запись
        if (!bondData) {
          bondAnalyses.push(createInsufficientDataBondResult(bondAsset));
          continue;
        }

        // Нормализованная цена в рублях из bondAsset (уже конвертирована в xlsx-parser)
        const marketPriceInRub: number | null = this.validateCurrentPriceRub(
          bondAsset.currentPrice,
          bondAsset.priceUnit,
          bondAsset.priceNormalized,
        );

        try {
          // Дата ближайшего купона: Excel → ISS → smart-lab (эталон для
          // 29027 — 11.12.2026). Фолбэк ограничен кэшем и лимитом и не
          // тратится, если дата уже есть в Excel/ISS.
          const rawNextCouponDate = bondData.nextCouponDate as
            Date | string | null | undefined;
          const parsedNextCouponDate =
            rawNextCouponDate instanceof Date
              ? rawNextCouponDate
              : rawNextCouponDate
                ? new Date(rawNextCouponDate)
                : null;
          const dataNextCouponDate =
            parsedNextCouponDate &&
            !Number.isNaN(parsedNextCouponDate.getTime())
              ? parsedNextCouponDate
              : null;
          const dataSource =
            (bondData.nextCouponDateSource as
              'EXCEL' | 'MOEX_ISS' | 'SMART_LAB' | undefined) ??
            (bondData.source === 'smart-lab' ? 'SMART_LAB' : 'EXCEL');
          const nextCouponFallback = dataNextCouponDate
            ? null
            : await nextCouponResolver(normalizedIsin);
          const nextCouponDate = dataNextCouponDate ?? nextCouponFallback;
          const nextCouponDateSource = dataNextCouponDate
            ? dataSource
            : nextCouponFallback
              ? 'SMART_LAB'
              : undefined;
          console.log(
            `[BOND_CARD] isin=${normalizedIsin} nextCouponDate=${
              formatCalendarDate(nextCouponDate) ?? 'not_in_excel'
            } source=${nextCouponDateSource ?? 'none'}`,
          );

          // 1. Анализ доходности
          const yieldAnalysis = analyzeYield({
            quikYield:
              bondData.yield != null ? Number(bondData.yield) : undefined,
            // Идентификатор нужен для классификации серии ОФЗ:
            // 24/29 — ПК, 25/26 — ПД, 46 — АД, 52 — ИН.
            identifier: bondAsset.ticker,
            couponAmount: Number(bondData.couponAmount) || 0,
            couponPeriodDays: Number(bondData.couponPeriodDays) || 0,
            marketPrice: marketPriceInRub ?? 0,
            nominal: Number(bondData.nominal) || 1000,
            quantity: bondAsset.quantity || 0,
            nextCouponDate,
            maturityDate: bondData.maturityDate as Date | null | undefined,
            hasFloatingTerms: bondData.couponType === 'FLOATER',
            // Основной путь: тип из description ISS. Если тип не подтверждён
            // (source != MOEX_DESCRIPTION), классификация — по серии/Excel.
            issCouponType:
              bondData.couponTypeSource === 'MOEX_DESCRIPTION'
                ? toOfzSeries(bondData.couponType)
                : undefined,
            issCouponTypeRaw:
              typeof bondData.couponTypeRaw === 'string'
                ? bondData.couponTypeRaw
                : null,
          });

          // 2. Анализ процентного риска
          // Дюрация в Excel-листе «Облигации» указана в днях — конвертируем в годы.
          const durationDays = Number(bondData.duration) || 0;
          const durationYears = durationDays > 0 ? durationDays / 365.25 : 0;
          const durationAnalysis = analyzeDuration({
            duration: durationYears,
            durationType: 'UNKNOWN', // тип дюрации не подтверждён
            currentYield: yieldAnalysis.currentYield || 0,
            currentPrice: marketPriceInRub ?? 0,
            quantity: bondAsset.quantity || 0,
            bondType: bondData.couponType as
              | 'FIXED'
              | 'FLOATER'
              | 'ZERO_COUPON'
              | 'AMORTIZING'
              | 'UNKNOWN'
              | undefined,
          });

          // 3. Ликвидность
          const turnoverNum =
            bondData.turnover != null ? Number(bondData.turnover) : 0;
          const liquidityAssessment: import('../../research/bond-analyzer/bond-analyzer-types.js').LiquidityAssessment =
            {
              status: turnoverNum > 0 ? 'AVAILABLE' : 'PARTIAL',
              turnover: turnoverNum > 0 ? turnoverNum : null,
              turnoverUnit: 'RUB',
              spread: null,
              depth: null,
              summary:
                turnoverNum > 1e6
                  ? `Оборот: ${turnoverNum.toLocaleString('ru-RU')} руб./день — ликвидность достаточна`
                  : turnoverNum > 0
                    ? `Оборот: ${turnoverNum.toLocaleString('ru-RU')} руб./день — ликвидность умеренная`
                    : 'Оборот отсутствует — ликвидность низкая',
            };

          // 4. Кредитный анализ
          this.log.info(
            `[BondAnalysis] 📊 ${bondAsset.ticker}: icbrrRating=${bondData.icbrrRating ?? 'null'}, rating=${bondData.rating ?? 'null'}, source=${bondData.source ?? 'null'}`,
          );
          const creditAssessment = analyzeCredit({
            maturityDate: bondData.maturityDate as Date | null | undefined,
            turnover:
              bondData.turnover != null ? Number(bondData.turnover) : null,
            quantity: bondAsset.quantity || 0,
            currentPrice: marketPriceInRub ?? 0,
            dataSource: 'MOEX_EXCEL',
            icbrrRating:
              bondData.icbrrRating != null
                ? String(bondData.icbrrRating)
                : undefined,
            rating:
              bondData.rating != null
                ? {
                    agency: 'Smart-Lab',
                    rating: String(bondData.rating),
                    outlook: 'STABLE',
                    asOfDate: new Date().toISOString().split('T')[0] as string,
                  }
                : undefined,
          });

          // 5. Итоговая оценка
          const finalAssessment = buildBondFinalAssessment({
            yieldAnalysis,
            durationAnalysis,
            creditAssessment,
            liquidityAssessment,
            portfolioMathStatus: 'STABLE',
            currentPercent: bondAsset.currentPercent || 0,
            targetPercent: bondAsset.targetPercent || null,
            positionValue: bondAsset.balancePrice * (bondAsset.quantity || 0),
            isin: bondAsset.ticker,
            instrumentName: bondAsset.name || '',
            holdOnly: bondAsset.holdOnly || false,
          });

          // 5. Собираем результат
          bondAnalyses.push({
            isin: bondAsset.ticker,
            name: bondAsset.name || '',
            issuer: bondData.issuer != null ? String(bondData.issuer) : '',
            quantity: bondAsset.quantity || 0,
            currentPrice: marketPriceInRub ?? 0,
            balanceValue: bondAsset.balancePrice * (bondAsset.quantity || 0),
            analysisStatus: 'SUCCESS',
            yieldAnalysis: {
              currentYield: yieldAnalysis.currentYield,
              ytm: yieldAnalysis.ytm,
              effectiveYield: yieldAnalysis.effectiveYield,
              annualCouponIncome: yieldAnalysis.annualCouponIncome,
              couponType: yieldAnalysis.couponType,
              couponTypeReason: yieldAnalysis.couponTypeReason,
              dataQuality: yieldAnalysis.dataQuality,
              // Раньше здесь был жёсткий null: дата из Excel/Smart-Lab
              // терялась, и ВСЕ облигации показывали «дата не указана».
              nextCouponDate: yieldAnalysis.nextCouponDate,
              nextCouponDateSource: nextCouponDateSource ?? null,
              yieldSource: yieldFromSmartLab
                ? 'SMART_LAB_PROBE'
                : bondData.yield != null && Number(bondData.yield) > 0
                  ? 'EXCEL_COLUMN'
                  : null,
            },
            durationAnalysis: {
              duration: durationAnalysis.duration,
              durationType: durationAnalysis.durationType,
              dv01: durationAnalysis.dv01,
              originalDv01: durationAnalysis.originalDv01,
              scenarios: durationAnalysis.scenarios,
              dataQuality: durationAnalysis.dataQuality,
              derivedDataQuality: durationAnalysis.derivedDataQuality,
            },
            creditAssessment: {
              quality: creditAssessment.quality,
              source: creditAssessment.source,
              asOfDate: creditAssessment.asOfDate,
              rating: creditAssessment.rating ?? null,
              summary: creditAssessment.summary,
            },
            recommendation: finalAssessment.recommendation,
            rationale: finalAssessment.rationale,
            moexData: {
              couponType: bondData.couponType as string | undefined,
              icbrrRating:
                bondData.icbrrRating != null
                  ? String(bondData.icbrrRating)
                  : bondData.rating != null
                    ? String(bondData.rating)
                    : undefined,
              sector:
                bondData.sector != null ? String(bondData.sector) : undefined,
              floatSpreadPct:
                bondData.floatSpreadPct != null
                  ? Number(bondData.floatSpreadPct)
                  : undefined,
              floatIndex:
                bondData.floatIndex != null
                  ? String(bondData.floatIndex)
                  : undefined,
              hasOption:
                bondData.hasOption != null
                  ? Boolean(bondData.hasOption)
                  : undefined,
              turnoverFromSmartLab:
                bondData.turnover != null
                  ? Number(bondData.turnover) / 1e6 // руб → млн
                  : null,
            },
            missingData: finalAssessment.missingData,
            mathAgreement: finalAssessment.mathAgreement,
            portfolioImpact: finalAssessment.portfolioImpact,
          });

          this.log.info(
            `[BondAnalysis] ✅ ${bondAsset.ticker}: yield=${yieldAnalysis.ytm?.toFixed(2) || 'N/A'}%, ` +
              `duration=${durationAnalysis.duration != null ? durationAnalysis.duration.toFixed(2) : 'N/A'}, ` +
              `credit=${creditAssessment.quality}, ` +
              `rec=${finalAssessment.recommendation}`,
          );
        } catch (error) {
          this.log.error(
            `[BondAnalysis] ❌ Ошибка анализа ${bondAsset.ticker}:`,
            error,
          );
          // P0-4: При ошибке анализатора — запись ERROR, позиция не теряется
          bondAnalyses.push({
            isin: bondAsset.ticker.trim().toUpperCase(),
            name: bondAsset.name || '',
            issuer: '',
            quantity: bondAsset.quantity || 0,
            currentPrice: marketPriceInRub,
            balanceValue: bondAsset.balancePrice * (bondAsset.quantity || 0),
            analysisStatus: 'ERROR',
            yieldAnalysis: {
              currentYield: null,
              ytm: null,
              effectiveYield: null,
              annualCouponIncome: null,
              couponType: 'UNKNOWN',
              dataQuality: 'MISSING',
            },
            durationAnalysis: {
              duration: null,
              durationType: 'UNKNOWN',
              dv01: null,
              originalDv01: undefined,
              scenarios: [],
              dataQuality: 'MISSING',
              derivedDataQuality: 'MISSING',
            },
            creditAssessment: {
              quality: 'INSUFFICIENT_DATA',
              source: 'ANALYSIS_ERROR',
              summary: `Ошибка анализа: ${error instanceof Error ? error.message : 'unknown'}`,
            },
            recommendation: 'INSUFFICIENT_DATA',
            rationale: `Техническая ошибка анализа: ${error instanceof Error ? error.message : 'unknown'}`,
            moexData: {},
            missingData: [
              `Ошибка анализа: ${error instanceof Error ? error.message : 'unknown'}`,
            ],
            mathAgreement: 'INSUFFICIENT_DATA',
            portfolioImpact:
              'Невозможно оценить влияние на структуру портфеля из-за ошибки анализа',
          });
        }
      }

      this.log.info(
        `[BondAnalysis] ✅ Проанализировано ${bondAnalyses.length} облигаций`,
      );
    }

    // Преобразуем anomalyData в TechnicalIndicators для системного промпта
    const technicalIndicators: Array<{
      ticker: string;
      rsi: number | null;
      sma20: number | null;
      sma50: number | null;
      smaPeriods?: number[];
      smaValues?: Record<string, number | null>;
      high52w?: number | null;
      low52w?: number | null;
      technicalAsOf?: string | null;
      trend: 'up' | 'down' | 'flat' | null;
      volatilityAnnual: number | null;
      riskLevel: 'low' | 'medium' | 'high' | null;
      zScoreLast: number | null;
      isLastAnomaly: boolean;
    }> = anomalyData || [];

    // Формируем точные суммы для ребалансировки
    const buyListLines: string[] = [];
    const reduceListLines: string[] = [];
    let totalBuyRub = 0;
    let totalReduceRub = 0;

    for (const asset of analysis.assetsAnalysis) {
      if (asset.deficitRub > 0) {
        buyListLines.push(
          `• ${asset.ticker} (${asset.name}): +${asset.deficitRub.toLocaleString('ru-RU')} руб. (целевая ${asset.targetPercent?.toFixed(1)}%, текущая ${asset.currentPercent.toFixed(1)}%)`,
        );
        totalBuyRub += asset.deficitRub;
      } else if (asset.deficitRub < 0 && asset.status === 'REDUCE') {
        reduceListLines.push(
          `• ${asset.ticker} (${asset.name}): -${Math.abs(asset.deficitRub).toLocaleString('ru-RU')} руб. (профицит ${Math.abs(asset.deficitRub).toLocaleString('ru-RU')} руб.)`,
        );
        totalReduceRub += Math.abs(asset.deficitRub);
      }
    }

    const rebalanceData = {
      freeCash: analysis.macro.freeCash ?? 0,
      buyList:
        buyListLines.length > 0
          ? buyListLines.join('\n')
          : 'нет активов с дефицитом',
      reduceList:
        reduceListLines.length > 0
          ? reduceListLines.join('\n')
          : 'нет активов с профицитом',
      totalBuyRub,
      totalReduceRub,
    };

    // ─── Фундаментальные данные по акциям портфеля (MOEX ISS) ───
    let portfolioFundamentals: PortfolioFundamentalsContext | undefined;
    try {
      const stockAssets = analysis.assetsAnalysis.filter((asset) => {
        const type = (asset.assetType || '').toUpperCase();
        return type === 'А' || type === 'АКЦИЯ' || type === 'STOCK';
      });
      const stockTickers = Array.from(
        new Set(
          stockAssets
            .map((asset) => (asset.ticker || '').trim().toUpperCase())
            .filter(
              (ticker) => ticker.length > 0 && !ticker.startsWith('RU00'),
            ),
        ),
      );
      if (stockTickers.length > 0) {
        const names: Record<string, string> = {};
        for (const asset of stockAssets) {
          const ticker = (asset.ticker || '').trim().toUpperCase();
          if (ticker) {
            names[ticker] = asset.shortName || asset.name || ticker;
          }
        }
        portfolioFundamentals = await getPortfolioFundamentalsOnce(
          stockTickers,
          names,
        );
        this.log.info(
          `[AI_CLIENT] Фундаментальные данные загружены: ${portfolioFundamentals.assets.length} акций`,
        );

        // Legacy-блок фундаментала (для актива с глубокой просадкой) раньше
        // содержал жёсткие null. Подставляем реальные значения из общего
        // контекста, чтобы в промпте не было противоречий «нет данных».
        if (fundamentalMetrics) {
          const detailed = portfolioFundamentals.assets.find(
            (asset) =>
              asset.ticker.toUpperCase() ===
              fundamentalMetrics?.ticker.toUpperCase(),
          );
          if (detailed) {
            fundamentalMetrics = {
              ...fundamentalMetrics,
              pe: detailed.pe.value,
              ps: detailed.ps.value,
              pb: detailed.pb.value,
              roe: detailed.roe.value,
              debtToEquity: detailed.debtToEquity.value,
              dividendYield: detailed.dividendYield.value,
              fundamentalHealth: detailed.fundamentalHealth,
              summary: detailed.summary,
            };
          }
        }
      }
    } catch (error) {
      this.log.error(
        '[AI_CLIENT] Ошибка загрузки фундаментальных данных:',
        error,
      );
    }

    // Дивидендные доходности нужны StrategistAgent для якоря даже тогда,
    // когда AI-провайдер недоступен и метод уходит в локальный fallback.
    // Поэтому считаем их ДО любых ранних return.
    const fundamentalsDividendYields = buildDividendYieldsFromFundamentals(
      portfolioFundamentals,
    );
    for (const asset of portfolioFundamentals?.assets ?? []) {
      this.log.info(
        `[DIVIDEND_YIELDS] ticker=${asset.ticker} ` +
          `value=${asset.dividendYield.value ?? 'null'} ` +
          `source=${asset.dividendYield.source ?? 'none'} ` +
          `status=${asset.dividendYield.status}`,
      );
    }
    this.log.info(
      `[DIVIDEND_YIELDS] source=fundamentals count=${Object.keys(fundamentalsDividendYields).length} ` +
        `tickers=${Object.keys(fundamentalsDividendYields).join(',') || 'none'}`,
    );

    const systemPrompt = buildSystemPrompt(
      macroData.keyRate,
      newsContext,
      assetTickers,
      macroData,
      memoryContext,
      guardrailsContext,
      investorParams,
      undefined, // bondContext — устарело, используем bondAnalyses
      bondAnalyses.length > 0 ? bondAnalyses : undefined, // ← передаём структурированный анализ облигаций
      deepLossContext
        ? {
            ticker: deepLossContext.ticker,
            name: deepLossContext.name,
            drawdownPercent: deepLossContext.drawdownPercent,
            lossLevel: deepLossContext.lossLevel,
            primaryReason: deepLossContext.primaryReason,
            vsMarket: deepLossContext.vsMarket,
            realizationRisk: deepLossContext.realizationRisk,
            summary: deepLossContext.summary,
          }
        : undefined,
      fundamentalMetrics,
      portfolioFundamentals, // ← фундаментальные данные по всем акциям
      behavioralFactors,
      technicalIndicators.length > 0 ? technicalIndicators : undefined, // ← технические индикаторы
      liquidityAnalysis
        ? this.toLiquidityContext(liquidityAnalysis)
        : undefined, // ← анализ ликвидности
      rebalanceData, // ← точные суммы для ребалансировки
    );
    const macroPercentages = actualMacroPercentages || {
      stocks: analysis.macro.stocksPercent,
      bonds: analysis.macro.bondsPercent,
    };
    const roundedMacros = {
      stocks: Math.round(macroPercentages.stocks * 100) / 100,
      bonds: Math.round(macroPercentages.bonds * 100) / 100,
    };

    // ─── P4: Заполнение financialReconciliation реалистичными данными ───
    if (analysis.financialReconciliation && historicalData) {
      const fr = analysis.financialReconciliation;
      fr.realizedPnL = historicalData.profitC10 || 0; // C10 = реализованный P&L
      fr.totalDeposits = historicalData.totalPurchases || 0;
      fr.totalWithdrawals = historicalData.totalSales || 0;
      fr.netInvestedCapital = historicalData.investedNet || 0;
      fr.totalCommissions = historicalData.commission || 0;
      fr.totalCoupons = inc.totalNkd || 0;
      fr.totalDividends = inc.totalDivsNet || 0;
    }

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
      anomalyData,
      analysis.financialReconciliation,
      analysis.allocationBaseValue,
    );

    // ─── Расчёт статуса финансирования (аналог scenario-agent.checkFunding) ───
    let fundingBuyRub = 0;
    let fundingSellRub = 0;
    for (const a of analysis.assetsAnalysis) {
      if (a.deficitRub > 0) fundingBuyRub += a.deficitRub;
      if (a.deficitRub < 0 && a.status === 'REDUCE')
        fundingSellRub += Math.abs(a.deficitRub);
    }
    const freeCash = analysis.macro.freeCash ?? 0;
    const fundingAvailableCash = freeCash + fundingSellRub;
    let fundingStatus: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' = 'SUFFICIENT';
    if (fundingBuyRub > 0) {
      if (fundingAvailableCash >= fundingBuyRub) {
        fundingStatus = 'SUFFICIENT';
      } else if (fundingSellRub > 0 && fundingAvailableCash > 0) {
        fundingStatus = 'PARTIAL';
      } else {
        fundingStatus = 'INSUFFICIENT';
      }
      this.log.info(
        `[FUNDING] status=${fundingStatus} freeCash=${freeCash} ` +
          `buy=${fundingBuyRub} sell=${fundingSellRub} available=${fundingAvailableCash}`,
      );
    }

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
          undefined,
          fundingStatus,
        ),
        modelUsed: 'local-fallback',
        success: false,
        error: 'Нет доступных API-ключей',
        fundamentalsDividendYields,
        portfolioFundamentals,
      };
    }

    this.log.info(
      `[AI] Доступные модели: ${availableModels.map((m) => m.name).join(', ')}`,
    );
    this.log.info(`[AI] Попытка запроса к: ${CURRENT_AI_MODEL.name}...`);

    // ─── DEBUG: измеряем длину промптов ───
    this.log.info(
      `[AI DEBUG] System prompt length: ${systemPrompt.length} chars`,
    );
    this.log.info(`[AI DEBUG] User prompt length: ${userPrompt.length} chars`);
    this.log.info(
      `[AI DEBUG] Total prompt size: ${systemPrompt.length + userPrompt.length} chars`,
    );
    this.log.info(`[AI DEBUG] Assets count: ${assetTickers.length}`);
    this.log.info(
      `[AI DEBUG] DeepLossContext: ${deepLossContext ? 'YES' : 'NO'}`,
    );
    this.log.info(
      `[AI DEBUG] FundamentalMetrics: ${fundamentalMetrics ? 'YES' : 'NO'}`,
    );
    this.log.info(
      `[AI DEBUG] BehavioralFactors: ${behavioralFactors ? 'YES' : 'NO'}`,
    );

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

    let aiText: string | undefined;
    let usedProviderName: string | undefined;
    let lastError: unknown = null;
    const maxAiRetries = 2; // Макс. повторов при невалидном ответе AI

    // Retry-обёртка для случаев, когда AI вернул невалидный ответ
    for (let attempt = 0; attempt <= maxAiRetries; attempt++) {
      try {
        const routeResult = await this.aiRouter.execute(
          providers,
          systemPrompt,
          userPrompt,
        );
        aiText = routeResult.text;
        usedProviderName = routeResult.providerName;

        // Проверяем качество ответа
        if (!aiText || aiText.trim().length < 50) {
          // Пустой или слишком короткий ответ — retry
          this.log.warn(
            `[AI] ⚠️ Пустой/короткий ответ (${aiText?.length ?? 0} символов). ` +
              `Попытка ${attempt + 1}/${maxAiRetries + 1}...`,
          );
          lastError = 'EMPTY_RESPONSE';
          if (attempt < maxAiRetries) {
            const delayMs = 1000 * Math.pow(2, attempt);
            await sleep(delayMs);
            continue;
          }
        }

        // Если ответ нормальный — выходим
        if (aiText && usedProviderName) {
          this.log.info(
            `[AI] ✅ Ответ получен от ${usedProviderName} (${aiText.length} символов)`,
          );
          this.log.info(
            `[AI DEBUG] Response length=${aiText.length}, ` +
              `endsWithFence=${aiText.trimEnd().endsWith('```')}, ` +
              `jsonBlocks=${(aiText.match(/```json/g) ?? []).length}, ` +
              `tail=${JSON.stringify(aiText.slice(-160))}`,
          );
          this.log.info(
            `[AI DEBUG] First 500 chars: ${aiText.substring(0, 500)}`,
          );
          lastError = null;
          break;
        } else {
          this.log.warn(
            `[AI] ⚠️ Пустой ответ. Попытка ${attempt + 1}/${maxAiRetries + 1}...`,
          );
          lastError = 'EMPTY_RESPONSE';
          if (attempt < maxAiRetries) {
            const delayMs = 1000 * Math.pow(2, attempt);
            await sleep(delayMs);
            continue;
          }
        }
      } catch (error: unknown) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);

        // Если это транзиентная ошибка — retry
        if (isTransientOllamaError(msg) || attempt < maxAiRetries) {
          this.log.warn(
            `[AI] ⚠️ Транзиентная ошибка: ${msg}. ` +
              `Попытка ${attempt + 1}/${maxAiRetries + 1}...`,
          );
          if (attempt < maxAiRetries) {
            const delayMs = 1000 * Math.pow(2, attempt);
            await sleep(delayMs);
            continue;
          }
        }

        // Если это не транзиентная ошибка — бросаем
        throw error;
      }
    }

    // Если все попытки исчерпаны — локальный fallback
    if (lastError || !aiText || !usedProviderName) {
      this.log.error('[AI] Ошибка всех моделей: ' + String(lastError));
      // Детальная отладка: выводим полный ответ ошибки
      if (lastError instanceof Error && 'response' in lastError) {
        const axiosError = lastError as Error & {
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
          undefined,
          fundingStatus,
        ),
        modelUsed: 'local-fallback',
        success: false,
        error: 'Все API недоступны',
        structuredJson: null,
        structuredValidation: null,
        fundamentalsDividendYields,
        portfolioFundamentals,
      };
    }

    // Извлекаем структурированный JSON из AI-ответа с retry-логикой
    let structuredJson: RawAIJson | null = null;
    let structuredJsonArray: RawAIJson[] = [];
    let structuredValidation: StructuredValidationResult | null = null;
    let extractedPortfolioSummary: string | undefined;

    // Если aiText не определён — используем пустую строку
    const safeAiText = aiText ?? '';

    // Retry-логика для случаев, когда AI вернул невалидный JSON
    const maxJsonRetries = 1; // Макс. повторов при невалидном JSON
    let jsonExtractSuccess = false;

    for (let jsonAttempt = 0; jsonAttempt <= maxJsonRetries; jsonAttempt++) {
      try {
        // Сначала пробуем ответ со schema: { portfolioSummary, recommendations }
        this.log.info(`[AI DEBUG] JSON extraction attempt ${jsonAttempt + 1}`);
        this.log.info(
          `[AI DEBUG] Text contains \`\`\`json: ${safeAiText.includes('```json')}`,
        );
        this.log.info(
          `[AI DEBUG] Text contains \`\`\`: ${safeAiText.includes('```')}`,
        );

        const portfolioResp = extractPortfolioSummaryResponse(safeAiText);
        extractedPortfolioSummary = portfolioResp?.portfolioSummary;

        if (portfolioResp && Array.isArray(portfolioResp.recommendations)) {
          structuredJsonArray = portfolioResp.recommendations;

          // Валидируем каждый элемент массива
          const validResults: RawAIJson[] = [];
          for (const item of structuredJsonArray) {
            const validation = validateStructuredAIJson(item, assetTickers, macroData);
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
          structuredJson =
            validResults.length > 0 ? (validResults[0] as RawAIJson) : null;

          this.log.info(
            `[AI] JSON извлечён: ${structuredJsonArray.length} актив(ов) прошло валидацию, portfolioSummary=${!!portfolioResp.portfolioSummary}`,
          );
          for (const item of structuredJsonArray) {
            this.log.info(
              `[AI]   ${item.ticker}: ${item.recommendedAction}, confidence=${item.confidence}`,
            );
          }
          jsonExtractSuccess = true;
          break; // Успех — выходим из retry-цикла
        } else {
          // Fallback: одиночный JSON-объект
          structuredJson = extractJsonFromAiResponse(safeAiText);
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
              macroData,
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
              // Если JSON не прошёл валидацию — retry
              if (jsonAttempt < maxJsonRetries) {
                this.log.warn(
                  `[AI] ⚠️ Невалидный JSON. Попытка ${jsonAttempt + 1}/${maxJsonRetries + 1}...`,
                );
                const delayMs = 1000 * Math.pow(2, jsonAttempt);
                await sleep(delayMs);
                continue; // Retry
              }
            } else {
              jsonExtractSuccess = true;
              break; // Успех — выходим из retry-цикла
            }
          } else {
            this.log.warn('[AI] JSON-блок не найден в ответе');
            // Логгируем начало ответа AI для отладки
            this.log.info('[AI] Начало ответа AI:', safeAiText.slice(0, 500));
            // Если JSON не найден — retry
            if (jsonAttempt < maxJsonRetries) {
              this.log.warn(
                `[AI] ⚠️ JSON не найден. Попытка ${jsonAttempt + 1}/${maxJsonRetries + 1}...`,
              );
              const delayMs = 1000 * Math.pow(2, jsonAttempt);
              await sleep(delayMs);
              continue; // Retry
            }
          }
        }
      } catch (err) {
        this.log.error('[AI] Ошибка парсинга JSON:', err);
        // Если ошибка парсинга — retry
        if (jsonAttempt < maxJsonRetries) {
          this.log.warn(
            `[AI] ⚠️ Ошибка парсинга JSON. Попытка ${jsonAttempt + 1}/${maxJsonRetries + 1}...`,
          );
          const delayMs = 1000 * Math.pow(2, jsonAttempt);
          await sleep(delayMs);
          continue; // Retry
        }
      }
    }

    // ─── Реальный повторный запрос за недостающими JSON-объектами ───
    // Прежний «retry» лишь повторно парсил тот же текст. Теперь, если после
    // разбора не хватает активов (или массив пуст), делаем ОДИН
    // дополнительный запрос с компактным JSON-only промптом: меньше
    // контекста, строгий контракт, только JSON.
    const coveredTickers = new Set(
      structuredJsonArray
        .map((item) => (item.ticker ?? '').toUpperCase())
        .filter((ticker) => ticker.length > 0),
    );
    const missingTickers = assetTickers.filter(
      (ticker) => !coveredTickers.has(ticker.toUpperCase()),
    );

    if (missingTickers.length > 0 && usedProviderName) {
      const usedProvider = providers.find(
        (provider) => provider.name === usedProviderName,
      );
      if (usedProvider) {
        try {
          const missingSet = new Set(
            missingTickers.map((ticker) => ticker.toUpperCase()),
          );
          const missingFundamentals = portfolioFundamentals
            ? {
                ...portfolioFundamentals,
                assets: portfolioFundamentals.assets.filter((asset) =>
                  missingSet.has(asset.ticker.toUpperCase()),
                ),
              }
            : undefined;
          // Технические индикаторы — только по недостающим тикерам, чтобы
          // повторный ответ не терял 52w/SMA и не писал «недоступно» при
          // наличии истории MOEX ISS.
          const missingTechnical = technicalIndicators.filter((indicator) =>
            missingSet.has(indicator.ticker.trim().toUpperCase()),
          );
          const jsonSystemPrompt = buildJsonOnlySystemPrompt(
            missingTickers,
            missingFundamentals,
            missingTechnical.length > 0 ? missingTechnical : undefined,
          );
          const jsonUserPrompt = `ДАННЫЕ ПОРТФЕЛЯ:\n${context}`;
          this.log.warn(
            `[AI] JSON неполный (${coveredTickers.size}/${assetTickers.length}). ` +
              `Повторный запрос только за JSON для: ${missingTickers.join(', ')} ` +
              `(${jsonSystemPrompt.length + jsonUserPrompt.length} chars) через ${usedProviderName}`,
          );
          const jsonRetryText = await usedProvider.query(
            jsonSystemPrompt,
            jsonUserPrompt,
          );
          this.log.info(
            `[AI] JSON-retry ответ: ${jsonRetryText.length} символов, ` +
              `endsWithFence=${jsonRetryText.trimEnd().endsWith('```')}`,
          );

          const retryResp = extractPortfolioSummaryResponse(jsonRetryText);
          const retryItems = retryResp?.recommendations ?? [];
          
          // Сохраняем portfolioSummary из retry-ответа, если он есть
          if (retryResp?.portfolioSummary && !extractedPortfolioSummary) {
            extractedPortfolioSummary = retryResp.portfolioSummary;
          }
          
          const retryValid: RawAIJson[] = [];
          for (const item of retryItems) {
            const ticker = (item.ticker ?? '').toUpperCase();
            if (!missingSet.has(ticker)) continue;
            const validation = validateStructuredAIJson(item, assetTickers, macroData);
            if (validation.valid) {
              retryValid.push(item);
            } else {
              this.log.warn(
                `[AI] ⚠️ JSON-retry валидация не пройдена для ${item.ticker}:`,
                validation.errors,
              );
            }
          }

          if (retryValid.length > 0) {
            structuredJsonArray = [...structuredJsonArray, ...retryValid];
            structuredJson = (structuredJson ?? retryValid[0]) as RawAIJson;
            jsonExtractSuccess = true;
            this.log.info(
              `[AI] JSON-retry успешен: +${retryValid.length} актив(ов), ` +
                `итого ${structuredJsonArray.length}`,
            );
          } else {
            this.log.warn('[AI] JSON-retry не дал валидных объектов');
          }
        } catch (retryError) {
          this.log.warn(
            '[AI] JSON-retry завершился ошибкой:',
            retryError instanceof Error
              ? retryError.message
              : String(retryError),
          );
        }
      }
    }

    if (!jsonExtractSuccess) {
      this.log.warn(
        '[AI] ⚠️ JSON не извлечён после всех попыток. Используется fallback.',
      );
    }

    // ─── DEBUG: проверяем возвращаемые данные ───
    this.log.info(
      `[AI DEBUG] Returning structuredJsonArray: ${structuredJsonArray.length} items`,
    );
    this.log.info(
      `[AI DEBUG] Returning structuredJson: ${structuredJson ? 'exists' : 'null'}`,
    );

    // Извлекаем portfolioSummary из корневого объекта (не из массива!)
    let portfolioSummary: string | undefined;
    if (extractedPortfolioSummary) {
      portfolioSummary = extractedPortfolioSummary;
    }

    return {
      text: aiText.replace(/\n/g, '<br>'),
      modelUsed: usedProviderName,
      success: true,
      structuredJson,
      structuredJsonArray,
      portfolioSummary,
      structuredValidation,
      fundamentalsDividendYields,
      portfolioFundamentals,
      bondAnalyses,
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

  // ─── P0-2: Вспомогательные методы ───

  /** Форматирование рубля со знаком для финансовых показателей */
  private fmtRubWithSign(value: number): string {
    const formatted = new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(value));
    return value >= 0
      ? '+' + formatted + ' ₽'
      : '−' + formatted.replace('-', '') + ' ₽';
  }

  /**
   * Проверяет уже нормализованную цену в рублях.
   * Не выполняет конвертацию — цена уже должна быть в рублях.
   * Возвращает цену или null при некорректных значениях.
   *
   * Требует явного подтверждения нормализации: priceNormalized === true.
   * priceUnit !== 'UNKNOWN' сам по себе недостаточен — нужен явный статус.
   */
  private validateCurrentPriceRub(
    price: number,
    priceUnit: 'RUB' | 'PERCENT_OF_NOMINAL' | 'UNKNOWN' | undefined,
    priceNormalized: boolean | undefined,
  ): number | null {
    // Явное подтверждение нормализации — обязательное условие
    if (priceNormalized !== true) {
      return null;
    }
    if (priceUnit === 'UNKNOWN') {
      return null;
    }
    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }
    return price;
  }

  /**
   * Получает дневной оборот облигации из MOEX ISS.
   * Endpoint: /engines/stock/markets/bonds/quotes_board.json
   * Возвращает оборот в рублях или null.
   */
  private async fetchBondTurnoverFromMoex(
    isin: string,
  ): Promise<number | null> {
    try {
      const url = 'https://iss.moex.com/iss/engines/stock/markets/bonds/quotes_board.json?market_id=1&iss.meta=off&iss.only=board&board=TQOB&select=SECID,TURN_OVER';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const json = await response.json() as Record<string, unknown>;
      const boards = json?.boards as Record<string, unknown> | undefined;
      if (!boards) return null;

      // Ищем TQOB board
      const tqob = boards['TQOB'] as Record<string, unknown> | undefined;
      if (!tqob) return null;

      const datasets = tqob?.datasets as Record<string, unknown[]> | undefined;
      if (!datasets) return null;

      // Ищем dataset с TURN_OVER
      for (const _key of Object.keys(datasets)) {
        const dataset = datasets[_key];
        if (!Array.isArray(dataset) || dataset.length === 0) continue;

        const firstItem = dataset[0] as Record<string, unknown> | undefined;
        if (!firstItem) continue;

        const columns = firstItem.columns as string[] | undefined;
        const rows = firstItem.rows as string[][] | undefined;
        if (!columns || !rows) continue;

        const secidIdx = columns.indexOf('SECID');
        const turnIdx = columns.indexOf('TURN_OVER');
        if (secidIdx < 0 || turnIdx < 0) continue;

        for (const row of rows) {
          if (row[secidIdx] === isin) {
            const val = row[turnIdx] ?? '0';
            const turnover = parseFloat(String(val));
            if (!isNaN(turnover) && turnover > 0) {
              return turnover;
            }
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Ищет облигацию в bondMarketData по имени, если ISIN невалиден или не найден.
   * Сравнивает bondAsset.name / shortName с bondRef.instrumentName.
   */
  private findBondByName(
    bondAsset: AssetAnalysis,
    bondMarketData: Map<string, BondReferenceData>,
    normalizedIsin: string,
  ): BondReferenceData | null {
    const searchNames = [bondAsset.name];
    if (bondAsset.shortName) {
      searchNames.push(bondAsset.shortName);
    }

    for (const searchName of searchNames) {
      if (!searchName) continue;
      const normalizedSearch = searchName.trim().toLowerCase();
      if (normalizedSearch.length < 3) continue;

      for (const [isin, bondRef] of bondMarketData) {
        const refName = bondRef.instrumentName?.trim().toLowerCase();
        if (!refName) continue;

        // Прямое совпадение или вхождение
        const isExactMatch = refName === normalizedSearch;
        const isIncluded =
          refName.includes(normalizedSearch) ||
          normalizedSearch.includes(refName);
        if (isExactMatch || isIncluded) {
          // Для точного совпадения по имени префикс не нужен — это надёжный
          // матч. Для частичного совпадения проверяем префикс ISIN, чтобы
          // избежать ложных срабатываний (например, «Сбер» и «Сбербанк»).
          if (isExactMatch) {
            return bondRef;
          }
          const tickerPrefix = normalizedIsin.substring(0, 8);
          const isinPrefix = isin.substring(0, 8);
          if (tickerPrefix === isinPrefix) {
            return bondRef;
          }
        }
      }
    }
    return null;
  }

  /**
   * Валидация ISIN по стандарту ISO 6166.
   * - Ровно 12 символов
   * - Две латинские буквы в начале
   * - Десять буквенно-цифровых символов
   * - Контрольная цифра
   */
  private isValidIsin(isin: string): boolean {
    const s = isin.trim().toUpperCase();
    if (s.length !== 12) return false;
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;

    // Разбиваем буквы на две цифры для корректного расчёта контрольной суммы
    // Например: A → "10", Z → "35"
    let expanded = '';
    for (let i = 0; i < 11; i++) {
      const c = s.charAt(i);
      const code = c.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        expanded += (code - 55).toString(); // A=10, B=11, ..., Z=35
      } else {
        expanded += c;
      }
    }

    // Контрольная цифра (Luhn-like для ISIN)
    let sum = 0;
    for (let i = 0; i < expanded.length; i++) {
      let digit = parseInt(expanded.charAt(i), 10);
      // Каждая вторая цифра удваивается (позиции считаем с 0, удваиваем нечётные)
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit === parseInt(s.charAt(11), 10);
  }

  /**
   * Рассчитывает фундаментальные метрики актива.
   * Использует данные из AssetAnalysis и доступные финансовые показатели.
   */
  private calculateFundamentalMetrics(
    asset: AssetAnalysis,
  ): FundamentalMetrics | null {
    // Упрощённая оценка фундаментала на основе доступных данных
    const isPositive = this.checkPositiveFundamentals(asset);
    const hasDrawdown = asset.balancePrice > 0 && asset.currentPrice > 0;
    const drawdownPercent = hasDrawdown
      ? ((asset.currentPrice - asset.balancePrice) / asset.balancePrice) * 100
      : 0;

    // Оценка фундаментала
    let fundamentalHealth: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
    let summary: string;

    if (isPositive && drawdownPercent > -10) {
      fundamentalHealth = 'POSITIVE';
      summary = `Фундаментал в норме: статус ${asset.status}, просадка умеренная (${drawdownPercent.toFixed(1)}%).`;
    } else if (isPositive && drawdownPercent <= -10) {
      fundamentalHealth = 'NEUTRAL';
      summary = `Фундаментал умеренный: статус ${asset.status}, но просадка глубокая (${drawdownPercent.toFixed(1)}%).`;
    } else {
      fundamentalHealth = 'NEGATIVE';
      summary = `Фундаментал под вопросом: статус ${asset.status}, просадка ${drawdownPercent.toFixed(1)}%, актив сконцентрирован.`;
    }

    return {
      ticker: asset.ticker,
      name: asset.name,
      pe: null, // Нет данных
      ps: null, // Нет данных
      pb: null, // Нет данных
      dividendYield: null, // Нет данных
      roe: null, // Нет данных
      debtToEquity: null, // Нет данных
      profitMargin: null, // Нет данных
      revenueGrowth: null, // Нет данных
      earningsGrowth: null, // Нет данных
      fundamentalHealth,
      summary,
    };
  }

  /**
   * Рассчитывает поведенческие факторы актива.
   * Учитывает глубину просадки, статус и концентрацию.
   */
  private calculateBehavioralFactors(
    asset: AssetAnalysis,
  ): BehavioralFactors | null {
    const hasDrawdown = asset.balancePrice > 0 && asset.currentPrice > 0;
    const drawdownPercent = hasDrawdown
      ? ((asset.currentPrice - asset.balancePrice) / asset.balancePrice) * 100
      : 0;

    // Оценка психологического барьера убытка
    let lossAversion: 'HIGH' | 'MEDIUM' | 'LOW';
    if (drawdownPercent <= -30) {
      lossAversion = 'HIGH';
    } else if (drawdownPercent <= -15) {
      lossAversion = 'MEDIUM';
    } else {
      lossAversion = 'LOW';
    }

    // Оценка склонности к усреднению
    let averagingTendency: 'HIGH' | 'MEDIUM' | 'LOW';
    if (asset.status === 'BUY' && drawdownPercent <= -20) {
      averagingTendency = 'HIGH';
    } else if (asset.status === 'BUY') {
      averagingTendency = 'MEDIUM';
    } else {
      averagingTendency = 'LOW';
    }

    // Оценка склонности к панике
    let panicTendency: 'HIGH' | 'MEDIUM' | 'LOW';
    if (drawdownPercent <= -40 && asset.isConcentrated) {
      panicTendency = 'HIGH';
    } else if (drawdownPercent <= -25) {
      panicTendency = 'MEDIUM';
    } else {
      panicTendency = 'LOW';
    }

    // Рекомендация по поведению
    let behavioralAdvice: string;
    if (lossAversion === 'HIGH' && panicTendency === 'HIGH') {
      behavioralAdvice =
        '⚠️ Критический уровень: избегайте эмоциональных решений. Рассмотрите частичную продажу или хеджирование.';
    } else if (lossAversion === 'HIGH') {
      behavioralAdvice =
        '⚠️ Высокий риск фиксации убытка: оцените фундаментал перед принятием решения.';
    } else if (averagingTendency === 'HIGH') {
      behavioralAdvice =
        '💡 Усреднение возможно, но только при положительном фундаментале и наличии кэша.';
    } else {
      behavioralAdvice =
        '✅ Психологический баланс в норме: принимайте решения на основе данных.';
    }

    // Резюме
    let summary = 'Поведенческий профиль: ';
    if (lossAversion === 'HIGH') summary += 'высокая_aversion к убытку, ';
    if (panicTendency === 'HIGH') summary += 'высокая склонность к панике, ';
    if (averagingTendency === 'HIGH') summary += 'склонность к усреднению. ';
    if (summary === 'Поведенческий профиль: ') summary += 'баланс в норме. ';

    return {
      ticker: asset.ticker,
      name: asset.name,
      lossAversion,
      averagingTendency,
      panicTendency,
      behavioralAdvice,
      summary,
    };
  }

  /**
   * Рассчитывает средневзвешенную просадку рынка по всем акциям в портфеле.
   * Используется как бенчмарк для сравнения с конкретным активом.
   */
  private calculateMarketDrawdown(analysis: PortfolioReportData): number {
    const stocks = analysis.assetsAnalysis.filter(
      (a) => a.assetType.toUpperCase() === 'STOCK',
    );
    if (stocks.length === 0) return 0;

    const totalDrawdown = stocks.reduce((sum, asset) => {
      const balancePrice = asset.balancePrice ?? 0;
      const currentPrice = asset.currentPrice ?? 0;
      const drawdownPercent =
        balancePrice > 0
          ? ((currentPrice - balancePrice) / balancePrice) * 100
          : 0;
      return sum + drawdownPercent * asset.currentPercent;
    }, 0);

    const totalPercent = stocks.reduce((sum, a) => sum + a.currentPercent, 0);
    return totalPercent > 0 ? totalDrawdown / totalPercent : 0;
  }

  /**
   * Рассчитывает средневзвешенную просадку сектора для данного актива.
   * Сектор определяется по типу актива (STOCK/BOND).
   */
  private calculateSectorDrawdown(
    asset: AssetAnalysis,
    analysis: PortfolioReportData,
  ): number {
    const assetType = asset.assetType.toUpperCase();

    // Для акций используем все остальные акции как сектор
    // Для облигаций используем все остальные облигации
    const sectorAssets = analysis.assetsAnalysis.filter(
      (a) =>
        a.assetType.toUpperCase() === assetType && a.ticker !== asset.ticker,
    );

    if (sectorAssets.length === 0) return 0;

    const totalDrawdown = sectorAssets.reduce((sum, a) => {
      const balancePrice = a.balancePrice ?? 0;
      const currentPrice = a.currentPrice ?? 0;
      const drawdownPercent =
        balancePrice > 0
          ? ((currentPrice - balancePrice) / balancePrice) * 100
          : 0;
      return sum + drawdownPercent * a.currentPercent;
    }, 0);

    const totalPercent = sectorAssets.reduce(
      (sum, a) => sum + a.currentPercent,
      0,
    );
    return totalPercent > 0 ? totalDrawdown / totalPercent : 0;
  }

  /**
   * Проверяет, есть ли у актива положительные фундаментальные признаки.
   * Упрощённая проверка: статус BUY/STABLE, отсутствие признаков концентрации риска.
   */
  private checkPositiveFundamentals(asset: AssetAnalysis): boolean {
    // Если актив в статусе BUY или STABLE — это положительный сигнал
    if (asset.status === 'BUY' || asset.status === 'STABLE') {
      return true;
    }

    // Если актив не является сконцентрированным — это положительный сигнал
    if (!asset.isConcentrated) {
      return true;
    }

    // По умолчанию — неопределённо
    return false;
  }

  /**
   * Преобразует LiquidityAnalysis из DataAgent в LiquidityContext для промпта.
   */
  private toLiquidityContext(
    liquidity: import('./liquidity-analyzer.js').LiquidityAnalysis,
  ): import('./prompt-templates.js').LiquidityContext {
    return {
      summary: liquidity.summary,
      assets: liquidity.assets.map((a) => ({
        ticker: a.ticker,
        name: a.name,
        marketValue: a.marketValue,
        dailyTurnover: a.dailyTurnover,
        liquidityLevel: a.liquidityLevel,
        turnoverToValueRatio: a.turnoverToValueRatio,
        liquidationDays: a.liquidationDays,
        warning: a.warning,
        advice: a.advice,
      })),
      warnings: liquidity.warnings,
      recommendations: liquidity.recommendations,
    };
  }
}
