import {
  PortfolioReportData,
  type AssetAnalysis,
} from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import axios from 'axios';
import https from 'https';
import {
  buildSystemPrompt,
  type MacroDataContext,
} from './prompt-templates.js';
import { buildFallbackReport } from './fallback-report-builder.js';
import { UIOrdersData } from './types.js';
import { PortfolioSnapshot } from '../portfolio-snapshot/portfolio-snapshot.js';
import {
  CURRENT_AI_MODEL,
  getNextModel,
  getAvailableModels,
  type AiModelConfig,
} from './ai-config.js';
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
    try {
      return JSON.parse(match[1].trim()) as RawAIJson;
    } catch {
      // fall through
    }
  }

  // Паттерн 2: ``` { ... } ```
  const blockPattern = /```\s*([\s\S]*?)```/;
  match = text.match(blockPattern);
  if (match) {
    try {
      return JSON.parse(match[1].trim()) as RawAIJson;
    } catch {
      // fall through
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
 * Многомодельный клиент ИИ-советника
 * Поддержка: OpenRouter (Claude/GPT), GigaChat, YandexGPT, локальный fallback
 */
export class AiClient {
  private openRouterKey: string;
  private gigaChatKey: string;
  private yandexGptKey: string;

  constructor() {
    this.openRouterKey = process.env.OPENROUTER_API_KEY || '';
    this.gigaChatKey =
      process.env.PROXYAPI_KEY || process.env.GIGACHAT_API_KEY || '';
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
      if (t === 'Ф' || t === 'ETF' || t === 'FUND')
        etfPct += a.currentPercent;
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
      console.log(
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
    const rateValue = macroData?.keyRate ?? 0;
    const isFresh = macroData?.isFresh ?? false;

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
      ' \u20bd | \u0418\u043d\u0432\u0435\u0441\u0442-\u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442: ' +
      (totalNetProfit >= 0 ? '+' : '') +
      totalNetProfit.toFixed(2) +
      ' \u20bd (' +
      totalNetProfitPercent.toFixed(2) +
      '%)\n';
    ctx +=
      '\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0439 \u043a\u044d\u0448: ' +
      macro.freeCash.toLocaleString('ru-RU') +
      ' \u20bd | \u0421\u0442\u0430\u0432\u043a\u0430 \u0426\u0411: ' +
      rateValue +
      '%\n';
    if (!isFresh)
      ctx +=
        '⚠️ DATA_STATUS=STALE (\u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a: ' +
        (macroData?.source || 'unknown') +
        ')\n';
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
      '%\n\n';
    // КРИТИЧЕСКИЕ ДАННЫЕ — ОБЯЗАТЕЛЬНО используй в ответе
    ctx +=
      '!!! СТРУКТУРА: Акции=' +
      stocksPct +
      '% Облигации=' +
      bondsPct +
      '% Фонды(ETF)=' +
      etfPct +
      '% !!!\n\n';

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

    ctx +=
      '\n=== \u0410\u041a\u0422\u0418\u0412\u042b (\u0442\u0430\u0431\u043b\u0438\u0446\u0430) ===\n';
    ctx +=
      '\u0424\u043e\u0440\u043c\u0430\u0442: [\u0422\u0418\u041f] \u0422\u0438\u043a\u0435\u0440 | \u0418\u043c\u044f | \u0414\u043e\u043b\u044f% | \u0426\u0435\u043d\u0430 | \u0412\u0445\u043e\u0434 | P&L% | \u041a\u043e\u043b-\u0432\u043e | \u041b\u0438\u043a\u0432\u0438\u0434\u0430\u0446\u0438\u044f | \u0414\u0435\u0444\u0438\u0446\u0438\u0442 | \u0421\u0442\u0430\u0442\u0443\u0441 | target% | ThesisConf | Thesis\n';

    for (const a of assetsAnalysis) {
      if (a.currentPercent === 0 && a.targetPercent === 0) continue;

      const type =
        a.assetType === 'А' || a.assetType === 'Акция'
          ? '\u0410\u041a\u0426\u0418\u042F'
          : a.assetType === 'О' || a.assetType === 'Облигация'
            ? '\u041e\u0411\u041b'
            : '\u0424\u041e\u041d\u0414';

      const pnlFromEntry =
        a.balancePrice > 0 && a.currentPrice > 0
          ? (
              ((a.currentPrice - a.balancePrice) / a.balancePrice) *
              100
            ).toFixed(1)
          : '—';

      const liquidation = (a.currentPrice * a.quantity).toLocaleString('ru-RU');
      const deficitStr =
        a.deficitRub > 0
          ? '+' + a.deficitRub.toLocaleString('ru-RU')
          : a.deficitRub < 0
            ? Math.abs(a.deficitRub).toLocaleString('ru-RU')
            : '—';

      const thesis = thesisResults.get(a.ticker);
      const thesisConf = thesis
        ? thesis.confidence.level +
          '(' +
          thesis.confidence.value.toFixed(2) +
          ')'
        : 'NO_RESEARCH';
      const thesisSummary = thesis
        ? thesis.thesis.length > 80
          ? thesis.thesis.substring(0, 80) + '...'
          : thesis.thesis
        : '\u041d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445';

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
        ' | ' +
        a.name +
        ' | ' +
        a.currentPercent.toFixed(1) +
        '% | ' +
        a.currentPrice +
        ' | ' +
        a.balancePrice +
        ' | ' +
        pnlFromEntry +
        '% | ' +
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
        ' | ' +
        thesisConf +
        ' | ' +
        thesisSummary +
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
    cbrRate: number,
    newsContext?: string,
    macroPercentages?: { stocks: number; bonds: number },
    historicalData?: {
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

    prompt += '=== ЗАДАЧА АНАЛИЗА ===\n';
    prompt += 'Проанализируй портфель с учётом:\n';
    prompt += '- Ключевая ставка ЦБ: ' + cbrRate + '%\n';
    prompt +=
      '- Текущая структура: Акции ' +
      stocksPct +
      '%, Облигации ' +
      bondsPct +
      '%\n';
    prompt += '- Дата анализа: ' + currentMonth + '\n\n';

    prompt += '=== ЧТО НУЖНО ДАТЬ В ОТВЕТЕ ===\n';
    prompt +=
      '1. Макроэкономическая оценка: соответствует ли текущая структура (Акции ' +
      stocksPct +
      '% / Облигации ' +
      bondsPct +
      '%) макроэкономической обстановке ' +
      currentMonth.charAt(0).toUpperCase() +
      currentMonth.slice(1) +
      ' года? Почему?\n';
    prompt += '2. РЕКОМЕНДАЦИИ ПО КАЖДОМУ АКТИВУ:\n';
    prompt +=
      '   - Для каждого актива из списка укажи статус PortfolioMath: BUY / STABLE / REDUCE / EXIT / NO_TARGET\n';
    prompt +=
      '   - Объясни каждый статус на основе переданных targetPercent и текущих данных\n';
    prompt += '   - targetPercent = 0% → EXIT / ВЫХОД\n';
    prompt += '   - targetPercent = — (прочерк) → цель не задана в Excel, укажи это\n';
    prompt += '3. ПЛАН РЕБАЛАНСИРОВКИ:\n';
    prompt +=
      '   - Какие BUY / REDUCE / STABLE / EXIT имеют наивысший приоритет\n';
    prompt +=
      '   - Как использовать свободный кэш с учётом фактического ограничения\n';
    prompt += '   - Приоритет операций на основе deficitRub из PortfolioMath\n';
    prompt += '4. ВЫХОД В ЗЕЛЁНУЮ ЗОНУ:\n';
    prompt +=
      '   - Текущий убыток: ' +
      (historicalData?.profitC11 || 0) +
      ' ₽ (' +
      (historicalData?.profitC11
        ? (
            (historicalData.profitC11 / historicalData.investedNet) *
            100
          ).toFixed(2)
        : '0') +
      '% от вложенных)\n';
    prompt +=
      '   - Краткосрочные шаги (1-3 месяца): что продать/купить сейчас\n';
    prompt +=
      '   - Среднесрочные шаги (3-12 месяцев): диверсификация, купоны\n';
    prompt += '   - Долгосрочные шаги (1+ лет): стратегия накопления\n';
    prompt +=
      '   - Ценовые уровни отслеживай только при наличии данных во входном контексте\n';
    prompt += '5. НОВЫЕ ИНСТРУМЕНТЫ:\n';
    prompt +=
      '   - Не добавляй новые инструменты без явного запроса пользователя\n';
    prompt += '   - Не создавай новые targetPercent\n';
    prompt += '6. КРАТКОЕ РЕЗЮМЕ: что делать прямо сейчас (3-5 пунктов).\n\n';

    prompt += '=== СТРОГИЕ ТРЕБОВАНИЯ К ОТВЕТУ ===\n';
    prompt += '- Используй ТОЛЬКО данные из раздела «ДАННЫЕ ПОРТФЕЛЯ»\n';
    prompt += '- НЕ упоминай компании, которых нет в списке активов\n';
    prompt += '- НЕ выдумывай данные о сделках топ-менеджеров\n';
    prompt += '- ВСЕ проценты и рубли должны соответствовать данным портфеля\n';
    prompt += '- Ответь развёрнуто, с аргументацией и конкретными цифрами\n';
    prompt +=
      '- Используй структуру: 7 секций, пронумерованных 1., 2., 3., 4., 5., 6., 7.\n';
    prompt += '- НЕ используй маркеры типа "$1." — только "1.", "2." и т.д.\n';
    prompt +=
      '- ⚠️ ВАЖНО: Данные агрегированы по всем счетам. Анализируй каждый актив как единый, не дублируй рекомендации по счетам.\n';
    prompt +=
      '- ⚠️ КРИТИЧЕСКИ: В секции 2 «РЕКОМЕНДАЦИИ ПО КАЖДОМУ АКТИВУ» ты ОБЯЗАН прокомментировать КАЖДЫЙ актив из таблицы активов. Без исключений. Если актив есть в таблице — о нём должна быть строка в рекомендациях. Никогда не пиши «актив не указан в списке» — это ошибка, если он там есть.\n';

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

    console.log('[OPENROUTER] Sending request to:', modelConfig.baseUrl);
    console.log('[OPENROUTER] Model:', modelConfig.modelName);
    console.log(
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

    console.log('[OPENROUTER] ✅ Response received, status:', response.status);
    return response.data.choices[0].message.content;
  }

  /**
   * Определение типа ключа GigaChat
   * Authorization Key: используется напрямую как Bearer токен
   * OAuth Key: формат ClientID:ClientSecret (base64)
   */
  private isAuthorizationKey(key: string): boolean {
    // Authorization Key от Сбера имеет формат UUID или длинную строку без двоеточия
    // OAuth Key в base64 всегда содержит ':' после декодирования
    try {
      const decoded = Buffer.from(key, 'base64').toString();
      // Если после декодирования есть ':' — это OAuth ClientID:Secret
      return !decoded.includes(':');
    } catch {
      // Если не base64 — это Authorization Key
      return true;
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

    console.log('[GigaChat] Использование Authorization Key...');

    const response = await axios.post(
      'https://gigachat.devices.sber.ru/api/v1/chat/completions',
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
  }

  /**
   * Получение OAuth токена GigaChat (с кэшированием на 90 секунд)
   */
  private gigaChatToken: string | null = null;
  private gigaChatTokenExpiry: number = 0;

  private async getGigaChatToken(): Promise<string> {
    // Проверяем, есть ли ещё действующий токен (оставляем 10 секунд запаса)
    if (this.gigaChatToken && Date.now() < this.gigaChatTokenExpiry - 10000) {
      return this.gigaChatToken;
    }

    if (!this.gigaChatKey) {
      throw new Error('GIGACHAT_API_KEY не настроен');
    }

    // Декодируем ключ (формат ClientID:ClientSecret)
    const decodedKey = Buffer.from(this.gigaChatKey, 'base64').toString();
    const [clientId, clientSecret] = decodedKey.split(':');
    const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');

    console.log('[GigaChat] Получение нового OAuth токена...');

    // Получаем OAuth токен через api.giga.chat
    const oauthResponse = await axios.post(
      'https://api.giga.chat/oauth',
      'scope=GIGACHAT_API_PERS',
      {
        headers: {
          Authorization: 'Basic ' + auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 15000,
      },
    );

    const accessToken = oauthResponse.data.access_token;
    if (!accessToken) {
      throw new Error('Не получен OAuth токен от GigaChat');
    }

    // Кэшируем токен на 90 секунд (токен жив 2 минуты)
    this.gigaChatToken = accessToken;
    this.gigaChatTokenExpiry = Date.now() + 90000;

    console.log('[GigaChat] ✅ Токен получен (действует 90 сек)');
    return accessToken;
  }

  /**
   * Запрос к GigaChat (Сбер)
   * Endpoint: https://api.giga.chat/
   */
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

    // Получаем свежий OAuth токен
    const accessToken = await this.getGigaChatToken();

    // Отправляем запрос к API
    const response = await axios.post(
      'https://api.giga.chat/v1/chat/completions',
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
    console.log('[Ollama] Проверка подключения к localhost:11434...');

    // Проверяем, запущен ли Ollama
    const isRunning = await isOllamaRunning();
    console.log('[Ollama] isOllamaRunning:', isRunning);
    if (!isRunning) {
      throw new Error('Ollama не запущен. Запустите Ollama на localhost:11434');
    }

    // Формируем полный промпт для кэширования
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    console.log('[Ollama] fullPrompt length:', fullPrompt.length);

    // Пробуем получить из кэша
    console.log('[Ollama] calling getCachedResponse...');
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
    console.log('[Ollama] getCachedResponse returned');

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
    console.log(`[Ollama] Запрос к модели ${modelConfig.modelName}...`);

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      // Пробуем стриминг для лучшего UX
      console.log('[Ollama] calling streamChat...');
      const streamResult: StreamResult = await streamChat(
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
      console.log(
        '[Ollama] streamChat returned, success:',
        streamResult.success,
      );

      if (!streamResult.success) {
        throw new Error(streamResult.error || 'Ошибка стриминга');
      }

      // Очищаем ответ от markdown-разметки и артефактов
      console.log('[Ollama] calling cleanAiResponse...');
      const cleanedResponse = cleanAiResponse(
        streamResult.content,
        assetTickers,
      );
      console.log('[Ollama] cleanAiResponse returned');

      // AI OUTPUT VALIDATION — детерминированная проверка после cleanAiResponse
      console.log('[Ollama] calling validateAiOutput...');
      const validatedResponse = validateAiOutput(cleanedResponse);
      console.log('[Ollama] validateAiOutput returned');

      // ARITHMETIC CONSISTENCY — проверяем суммы против deterministic
      console.log('[Ollama] calling validateArithmeticConsistency...');
      const deterministicAmounts: DeterministicAmounts[] = (
        assetsAnalysis ?? []
      )
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
      const arithmeticValidatedResponse = validateArithmeticConsistency(
        validatedResponse,
        deterministicAmounts,
      );
      console.log('[Ollama] validateArithmeticConsistency returned');

      console.log(
        '[Ollama] about to format stream stats, totalDuration:',
        streamResult.totalDuration,
      );

      console.log(
        `[Ollama] ✅ Ответ получен: ${streamResult.content.length} символов, ` +
          `${streamResult.totalTokens} токенов, ` +
          `${((streamResult.totalDuration || 0) / 1_000_000_000).toFixed(2)}с`,
      );

      return arithmeticValidatedResponse;
    } catch (error) {
      // Если стриминг не сработал, пробуем обычный запрос
      console.log('[Ollama] ⚠️ Стриминг не удался, пробуем обычный запрос...');

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
        const deterministicAmounts: DeterministicAmounts[] = (
          assetsAnalysis ?? []
        )
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
        const arithmeticValidatedResponse = validateArithmeticConsistency(
          validatedResponse,
          deterministicAmounts,
        );

        console.log(
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
    console.log(`[Ollama] Установка модели ${modelName}...`);

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
    },
    accountsInfo?: Array<{ name: string; value: number }>,
    memoryContext?: string,
    guardrailsContext?: string,
  ): Promise<AiResponseResult> {
    // Извлекаем тикеры активов для валидации
    const assetTickers = analysis.assetsAnalysis.map((a) => a.ticker);

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
    console.log('[AI_CLIENT] buildPortfolioContext OK');

    const systemPrompt = buildSystemPrompt(
      macroData.keyRate,
      newsContext,
      assetTickers,
      macroData,
      memoryContext,
      guardrailsContext,
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
      macroData.keyRate,
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
      console.warn(
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

    console.log(
      `[AI] Доступные модели: ${availableModels.map((m) => m.name).join(', ')}`,
    );
    console.log(`[AI] Попытка запроса к: ${CURRENT_AI_MODEL.name}...`);

    // Пробуем модели по очереди
    for (const model of availableModels) {
      try {
        let aiText: string;

        if (model.envKey === 'OPENROUTER_API_KEY') {
          aiText = await this.queryOpenRouter(model, systemPrompt, userPrompt);
        } else if (model.id === 'ollama') {
          aiText = await this.queryOllama(
            model,
            systemPrompt,
            userPrompt,
            assetTickers,
            analysis.assetsAnalysis,
          );
        } else if (model.id === 'gigachat') {
          aiText = await this.queryGigaChat(model, systemPrompt, userPrompt);
        } else if (model.id === 'yandexgpt') {
          aiText = await this.queryYandexGpt(model, systemPrompt, userPrompt);
        } else {
          console.warn(`[AI] Модель ${model.name} пока не поддерживается`);
          continue;
        }

        console.log(
          `[AI] ✅ Ответ получен от ${model.name} (${aiText.length} символов)`,
        );

        // Извлекаем структурированный JSON из AI-ответа
        let structuredJson: RawAIJson | null = null;
        let structuredValidation: StructuredValidationResult | null = null;

        try {
          structuredJson = extractJsonFromAiResponse(aiText);
          if (structuredJson) {
            structuredValidation = validateStructuredAIJson(
              structuredJson,
              assetTickers,
            );
            console.log(
              `[AI] JSON извлечён: ticker=${structuredJson.ticker}, ` +
                `action=${structuredJson.recommendedAction}, ` +
                `valid=${structuredValidation?.valid ?? 'N/A'}`,
            );
            if (structuredValidation && !structuredValidation.valid) {
              console.warn(
                '[AI] ⚠️ JSON валидация не пройдена:',
                structuredValidation.errors,
              );
            }
          } else {
            console.warn('[AI] JSON-блок не найден в ответе');
          }
        } catch (err) {
          console.error('[AI] Ошибка парсинга JSON:', err);
        }

        return {
          text: aiText.replace(/\n/g, '<br>'),
          modelUsed: model.name,
          success: true,
          structuredJson,
          structuredValidation,
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('[AI] Ошибка модели ' + model.name + ': ' + msg);
        // Детальная отладка: выводим полный ответ ошибки
        if (error instanceof Error && 'response' in error) {
          const axiosError = error as Error & {
            response?: { data?: unknown; status?: number };
          };
          if (axiosError.response?.data) {
            console.error(
              '[AI] Response data:',
              JSON.stringify(axiosError.response.data, null, 2).substring(
                0,
                500,
              ),
            );
          }
          console.error('[AI] Response status:', axiosError.response?.status);
        }

        const nextModel = getNextModel(model.id);
        if (nextModel) {
          console.log(`[AI] → Переключение на ${nextModel.name}...`);
        }
      }
    }

    // Если все модели не сработали — локальный fallback
    console.warn(
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
}
