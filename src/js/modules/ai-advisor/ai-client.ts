import { PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import axios from 'axios';
import { buildSystemPrompt } from './prompt-templates.js';
import { buildFallbackReport } from './fallback-report-builder.js';
import { UIOrdersData } from './types.js';
import {
  CURRENT_AI_MODEL,
  getNextModel,
  getAvailableModels,
  type AiModelConfig,
} from './ai-config.js';
import { localCache, getCachedResponse } from './ollama-cache.js';
import { streamChat, chatWithoutStream, type StreamResult } from './ollama-stream.js';
import {
  isOllamaRunning,
  listModels,
  pullModel,
  formatModelList,
  cleanAiResponse,
  type OllamaMessage,
} from './ollama-manager.js';

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
  private buildPortfolioContext(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
    historicalData?: {
      profitC10: number;
      profitC11: number;
      investedNet: number;
      totalPurchases: number;
      totalSales: number;
      commission: number;
    },
    accountsInfo?: Array<{ name: string; value: number }>,
    cbrRate?: number,
  ): string {
    const { assetsAnalysis, macro } = analysis;
    const totalVal = macro.totalBalance;
    const investedNet =
      macro.totalBalance -
      macro.freeCash -
      (macro.stocksDeficitRub + macro.bondsDeficitRub);
    const totalNetProfit = totalVal - investedNet;
    const totalNetProfitPercent =
      investedNet > 0 ? (totalNetProfit / investedNet) * 100 : 0;

    const stockAssets = assetsAnalysis.filter(
      (a) => a.assetType === 'А' || a.assetType === 'Акция',
    );
    const bondAssets = assetsAnalysis.filter(
      (a) => a.assetType === 'О' || a.assetType === 'Облигация',
    );

    let currentStocksPct = 0;
    let currentBondsPct = 0;

    stockAssets.forEach((a) => {
      currentStocksPct += a.currentPercent;
    });
    bondAssets.forEach((a) => {
      currentBondsPct += a.currentPercent;
    });

    const currentDate = new Date().toLocaleDateString('ru-RU');

    let ctx = '';
    ctx += '╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  ДАННЫЕ ПОРТФЕЛЯ ДЛЯ АНАЛИЗА — ТОЛЬКО ЭТИ ДАННЫЕ  ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    ctx += `Дата анализа: ${currentDate}\n`;
    ctx += `Общая стоимость портфеля: ${totalVal.toLocaleString('ru-RU')} ₽\n`;
    ctx += `Лично вложено средств: ${investedNet.toLocaleString('ru-RU')} ₽\n`;
    ctx += `Инвест-результат: ${totalNetProfit >= 0 ? '+' : ''}${totalNetProfit.toFixed(2)} ₽ (${totalNetProfitPercent.toFixed(2)}%)\n`;
    ctx += `Свободный кэш: ${macro.freeCash.toLocaleString('ru-RU')} ₽\n`;
    ctx += `Ключевая ставка ЦБ: ${cbrRate ?? 0}%\n\n`;

    // Информация о счетах (динамически из Excel)
    if (accountsInfo && accountsInfo.length > 0) {
      ctx += '╔══════════════════════════════════════════════════════════╗\n';
      ctx += '║  СЧЕТА В ПОРТФЕЛЕ                                      ║\n';
      ctx += '╚══════════════════════════════════════════════════════════╝\n';
      accountsInfo.forEach((a) => {
        ctx += '• Счет ' + a.name + ': ' + a.value.toLocaleString('ru-RU') + ' ₽\n';
      });
      ctx += '\nВсе данные агрегированы по всем счетам. Анализируй каждый актив как единый.\n\n';
    }

    ctx += '╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  СПИСОК ВСЕХ АКТИВОВ ПОРТФЕЛЯ (АНАЛИЗИРУЙ ТОЛЬКО ИХ)   ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    ctx += '⚠️ ВАЖНО: Один актив может быть на нескольких счетах (брокерский, ИИС). Данные агрегированы.\n\n';
    ctx += 'АКЦИИ:\n';
    stockAssets.forEach((a) => {
      ctx += `  • [АКЦИЯ] ${a.ticker} | ${a.name}\n`;
      ctx += `    Текущая доля: ${a.currentPercent.toFixed(1)}% | Целевая доля: ${a.targetPercent.toFixed(1)}%\n`;
      ctx += `    Дефицит/профицит: ${a.deficitRub >= 0 ? '+' : ''}${a.deficitRub.toLocaleString('ru-RU')} ₽ | Статус: ${a.status}\n`;
      ctx += `    Динамика: ${a.dynamicsPercent >= 0 ? '+' : ''}${a.dynamicsPercent.toFixed(2)}% | Цена входа: ${a.balancePrice.toLocaleString('ru-RU')} ₽ → Текущая: ${a.currentPrice.toLocaleString('ru-RU')} ₽\n`;
    });

    ctx += '\nОБЛИГАЦИИ:\n';
    bondAssets.forEach((a) => {
      ctx += `  • [ОБЛ] ${a.ticker} | ${a.name}\n`;
      ctx += `    Текущая доля: ${a.currentPercent.toFixed(1)}% | Целевая доля: ${a.targetPercent.toFixed(1)}%\n`;
      ctx += `    Дефицит/профицит: ${a.deficitRub >= 0 ? '+' : ''}${a.deficitRub.toLocaleString('ru-RU')} ₽ | Статус: ${a.status}\n`;
      ctx += `    НКД: ${a.nkdRub.toLocaleString('ru-RU')} ₽ | Динамика: ${a.dynamicsPercent >= 0 ? '+' : ''}${a.dynamicsPercent.toFixed(2)}%\n`;
    });

    ctx += '\n╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  СТРУКТУРА ПОРТФЕЛЯ: ЦЕЛЬ vs ФАКТ                       ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    ctx += `Акции:  цель ${macro.stocksPercent}% | факт ${currentStocksPct.toFixed(1)}% | разница ${(currentStocksPct - macro.stocksPercent).toFixed(1)}% | дефицит/профицит: ${macro.stocksDeficitRub >= 0 ? '+' : ''}${macro.stocksDeficitRub.toLocaleString('ru-RU')} ₽\n`;
    ctx += `Облигации:  цель ${macro.bondsPercent}% | факт ${currentBondsPct.toFixed(1)}% | разница ${(currentBondsPct - macro.bondsPercent).toFixed(1)}% | дефицит/профицит: ${macro.bondsDeficitRub >= 0 ? '+' : ''}${macro.bondsDeficitRub.toLocaleString('ru-RU')} ₽\n`;
    ctx += `Кэш: ${macro.freeCash.toLocaleString('ru-RU')} ₽\n\n`;

    // Исторический результат (если передан)
    if (historicalData) {
      ctx += '╔══════════════════════════════════════════════════════════╗\n';
      ctx += '║  ИСТОРИЧЕСКИЙ РЕЗУЛЬТАТ (С НАЧАЛА УЧЕТА)               ║\n';
      ctx += '╚══════════════════════════════════════════════════════════╝\n';
      ctx += `📉 Текущая прибыль (C10): ${historicalData.profitC10 >= 0 ? '+' : ''}${historicalData.profitC10.toLocaleString('ru-RU')} ₽\n`;
      ctx += `🌟 Инвест-результат (C11): ${historicalData.profitC11 >= 0 ? '+' : ''}${historicalData.profitC11.toLocaleString('ru-RU')} ₽\n`;
      const profitPercent = historicalData.investedNet > 0
        ? (historicalData.profitC11 / historicalData.investedNet) * 100
        : 0;
      ctx += `📊 Доходность: ${profitPercent.toFixed(2)}%\n`;
      ctx += `💰 Вложено средств (C12): ${historicalData.investedNet.toLocaleString('ru-RU')} ₽\n`;
      ctx += `🛒 Общий объём покупок: ${historicalData.totalPurchases.toLocaleString('ru-RU')} ₽\n`;
      ctx += `💰 Общий объём продаж: ${historicalData.totalSales.toLocaleString('ru-RU')} ₽\n`;
      ctx += `▪️ Комиссии брокеру: ${historicalData.commission.toLocaleString('ru-RU')} ₽\n\n`;
    }

    ctx += '╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  ДИВИДЕНДЫ И КУПОНЫ (LTM)                               ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    ctx += `Ожидаемый чистый поток (после НДФЛ 13%): ${inc.totalDivsNet.toLocaleString('ru-RU')} ₽\n`;
    ctx += `Накопленный НКД по облигациям: ${inc.totalNkd.toLocaleString('ru-RU')} ₽\n`;
    inc.stocks.forEach((s) => {
      ctx += `  • ${s.name} (${s.ticker}): ${s.quantity} шт. × ${s.rate} ₽ = ${s.grossIncome.toLocaleString('ru-RU')} ₽ грязными → ${s.netIncome.toLocaleString('ru-RU')} ₽ чистыми\n`;
    });

    // Рекомендации по каждому активу (из анализа портфеля)
    ctx += '\n╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  РЕКОМЕНДАЦИИ ПО АКТИВАМ (АВТО-АНАЛИЗ)                  ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    assetsAnalysis.forEach((a) => {
      if (a.currentPercent === 0 && a.targetPercent === 0) return;
      const action = a.status === 'BUY' ? '🟢 ПОКУПАТЬ' : a.status === 'REDUCE' ? '🔴 ПРОДАВАТЬ' : a.status === 'HOLD' ? '🟡 ДЕРЖАТЬ' : '⚪ НОВЫЙ';
      ctx += `• ${a.ticker} (${a.name}):\n`;
      ctx += `    ${action} | Текущая: ${a.currentPercent.toFixed(1)}% | Цель: ${a.targetPercent.toFixed(1)}%\n`;
      ctx += `    Дефицит: ${a.deficitRub >= 0 ? '+' : ''}${a.deficitRub.toLocaleString('ru-RU')} ₽ | Динамика: ${a.dynamicsPercent >= 0 ? '+' : ''}${a.dynamicsPercent.toFixed(2)}%\n`;
      if (a.balancePrice > 0 && a.currentPrice > 0) {
        const pnlFromEntry = ((a.currentPrice - a.balancePrice) / a.balancePrice * 100).toFixed(1);
        ctx += `    P&L от входа: ${pnlFromEntry}% (${a.balancePrice.toLocaleString('ru-RU')} → ${a.currentPrice.toLocaleString('ru-RU')} ₽)\n`;
      }
    });

    ctx += '\n╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  РИСК-МЕНЕДЖМЕНТ                                        ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    if (!validation.isValid) {
      ctx += '⚠️ НАРУШЕНИЯ:\n';
      validation.errors.forEach((err) => {
        ctx += `  ⚠️ ${err}\n`;
      });
    } else {
      ctx += '✅ Все лимиты соблюдены.\n';
    }

    ctx += '\n╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  АКТИВНЫЕ ЗАЯВКИ                                        ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    ctx += orders.md || 'Нет активных заявок.\n';

    ctx += '\n╔══════════════════════════════════════════════════════════╗\n';
    ctx += '║  ⚠️ ВАЖНОЕ ПРЕДУПРЕЖДЕНИЕ ДЛЯ МОДЕЛИ                   ║\n';
    ctx += '╚══════════════════════════════════════════════════════════╝\n';
    ctx += '• Анализируй ТОЛЬКО активы, перечисленные выше в разделе «СПИСОК ВСЕХ АКТИВОВ»\n';
    ctx += '• НЕ упоминай компании, которых нет в этом списке\n';
    ctx += '• НЕ выдумывай данные о сделках топ-менеджеров, финансовых отчётах компаний\n';
    ctx += '• ВСЕ проценты и рубли должны соответствовать данным из раздела «СТРУКТУРА ПОРТФЕЛЯ»\n';
    ctx += '• Если актив имеет статус NEW — его целевая доля не установлена, предложи на основе макроэкономики\n';

    return ctx;
  }

  /**
    * Построение user prompt с учётом новостного фона
    * Усиленная версия: жёсткие инструкции по формату, валидация данных
    */
  private buildUserPrompt(
    context: string,
    cbrRate: number,
    newAssetsForAi?: string,
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
    prompt += '- Текущая структура: Акции ' + stocksPct + '%, Облигации ' + bondsPct + '%\n';
    prompt += '- Дата анализа: ' + currentMonth + '\n\n';

    prompt += '=== ЧТО НУЖНО ДАТЬ В ОТВЕТЕ ===\n';
    prompt += '1. Макроэкономическая оценка: соответствует ли текущая структура (Акции ' + stocksPct + '% / Облигации ' + bondsPct + '%) макроэкономической обстановке ' + currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1) + ' года? Почему?\n';
    prompt += '2. РЕКОМЕНДАЦИИ ПО КАЖДОМУ АКТИВУ:\n';
    prompt += '   - Для каждого актива из списка укажи: ПОКУПАТЬ / ДЕРЖАТЬ / ПРОДАВАТЬ\n';
    prompt += '   - Укажи КОНКРЕТНУЮ целевую долю в процентах (например: Сбербанк — держать 8%, купить ещё на 2%)\n';
    prompt += '   - Укажи КОНКРЕТНУЮ сумму покупки/продажи в рублях\n';
    prompt += '3. ПЛАН РЕБАЛАНСИРОВКИ:\n';
    prompt += '   - Какие акции продать (название, количество, сумма)\n';
    prompt += '   - Какие облигации купить (название, количество, сумма)\n';
    prompt += '   - Итоговая желаемая структура портфеля в % и рублях\n';
    prompt += '4. ВЫХОД В ЗЕЛЁНУЮ ЗОНУ:\n';
    prompt += '   - Текущий убыток: ' + (historicalData?.profitC11 || 0) + ' ₽ (' + (historicalData?.profitC11 ? (historicalData.profitC11 / historicalData.investedNet * 100).toFixed(2) : '0') + '% от вложенных)\n';
    prompt += '   - Краткосрочные шаги (1-3 месяца): что продать/купить сейчас\n';
    prompt += '   - Среднесрочные шаги (3-12 месяцев): диверсификация, купоны\n';
    prompt += '   - Долгосрочные шаги (1+ лет): стратегия накопления\n';
    prompt += '   - Какие уровни отслеживать (цены, доходности, ключевая ставка)\n';
    prompt += '5. НОВЫЕ ИНСТРУМЕНТЫ:\n';
    prompt += '   - Какие облигации добавить (корпоративные/офис)\n';
    prompt += '   - Какие акции добавить (сектора, тикеры)\n';
    prompt += '   - Какие фонды рассмотреть (ETF, БПИФ)\n';
    prompt += '6. КРАТКОЕ РЕЗЮМЕ: что делать прямо сейчас (3-5 пунктов).\n\n';

    prompt += '=== СТРОГИЕ ТРЕБОВАНИЯ К ОТВЕТУ ===\n';
    prompt += '- Используй ТОЛЬКО данные из раздела «ДАННЫЕ ПОРТФЕЛЯ»\n';
    prompt += '- НЕ упоминай компании, которых нет в списке активов\n';
    prompt += '- НЕ выдумывай данные о сделках топ-менеджеров\n';
    prompt += '- ВСЕ проценты и рубли должны соответствовать данным портфеля\n';
    prompt += '- Ответь развёрнуто, с аргументацией и конкретными цифрами\n';
    prompt += '- Используй структуру: 7 секций, пронумерованных 1., 2., 3., 4., 5., 6., 7.\n';
    prompt += '- НЕ используй маркеры типа "$1." — только "1.", "2." и т.д.\n';
    prompt += '- ⚠️ ВАЖНО: Данные агрегированы по всем счетам. Анализируй каждый актив как единый, не дублируй рекомендации по счетам.\n';

    // Добавляем информацию о новых активах
    if (newAssetsForAi) {
      prompt += '\n=== НОВЫЕ АКТИВЫ ===\n' + newAssetsForAi + '\n';
      prompt += '⚡ ВНИМАНИЕ: Для новых активов указаны автоматические рекомендации по целевым долям. Проанализируй их и подтверди/скорректируй с учётом макроэкономической ситуации.\n';
    }

    return prompt;
  }

  /**
   * Запрос к OpenRouter (Claude Sonnet 4 / GPT-4o)
   */
  private async queryOpenRouter(
    modelConfig: AiModelConfig,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    if (!this.openRouterKey) {
      throw new Error('OPENROUTER_API_KEY не настроен');
    }

    const response = await axios.post(modelConfig.baseUrl, {
      model: modelConfig.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    }, {
      headers: {
        'Authorization': 'Bearer ' + this.openRouterKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/finance-analyzer',
        'X-Title': 'Finance Analyzer',
      },
    });

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
          'Authorization': 'Bearer ' + this.gigaChatKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'RqUID': Date.now().toString(),
        },
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
          'Authorization': 'Basic ' + auth,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
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
    // Определяем тип ключа
    if (this.isAuthorizationKey(this.gigaChatKey)) {
      return this.queryGigaChatWithAuthKey(modelConfig, systemPrompt, userPrompt);
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
          'Authorization': 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'RqUID': Date.now().toString(),
        },
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
        modelUri: 'gpt://d4ece1grc8m9rnbpj0l8/yandexgpt-lite',
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
          'Authorization': 'Bearer ' + iamToken,
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
  ): Promise<string> {
    console.log('[Ollama] Проверка подключения к localhost:11434...');

    // Проверяем, запущен ли Ollama
    const isRunning = await isOllamaRunning();
    if (!isRunning) {
      throw new Error('Ollama не запущен. Запустите Ollama на localhost:11434');
    }

    // Формируем полный промпт для кэширования
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    
    // Пробуем получить из кэша
    const cachedResult = await getCachedResponse(
      fullPrompt,
      modelConfig.modelName,
      async () => {
        // Если нет в кэше, запрашиваем у модели
        return await this.executeOllamaQuery(modelConfig, systemPrompt, userPrompt, assetTickers);
      },
    );

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
  ): Promise<string> {
    console.log(`[Ollama] Запрос к модели ${modelConfig.modelName}...`);

    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      // Пробуем стриминг для лучшего UX
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

      if (!streamResult.success) {
        throw new Error(streamResult.error || 'Ошибка стриминга');
      }

      // Очищаем ответ от markdown-разметки и артефактов
      const cleanedResponse = cleanAiResponse(streamResult.content, assetTickers);
      
      console.log(
        `[Ollama] ✅ Ответ получен: ${streamResult.content.length} символов, ` +
        `${streamResult.totalTokens} токенов, ` +
        `${(streamResult.totalDuration / 1_000_000_000).toFixed(2)}с`,
      );

      return cleanedResponse;
    } catch {
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
          throw new Error(result.error || 'Ошибка запроса');
        }

        const cleanedResponse = cleanAiResponse(result.content, assetTickers);
        
        console.log(
          `[Ollama] ✅ Ответ получен: ${result.content.length} символов`,
        );

        return cleanedResponse;
      } catch (thrown: unknown) {
        if (thrown instanceof Error) {
          throw new Error(`Ollama не отвечает: ${thrown.message}`, { cause: thrown });
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

    return pullModel(
      modelName,
      (status, completed, total) => {
        if (total > 0 && onProgress) {
          const percent = (completed / total) * 100;
          onProgress(status, percent);
        } else if (onProgress) {
          onProgress(status, 0);
        }
      },
    );
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
    */
  public async generateDynamicReport(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
    cbrRate: number,
    newAssetsForAi?: string,
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
  ): Promise<AiResponseResult> {
    // Извлекаем тикеры активов для валидации
    const assetTickers = analysis.assetsAnalysis.map((a) => a.ticker);

    const context = this.buildPortfolioContext(
      analysis,
      inc,
      validation,
      orders,
      historicalData,
      accountsInfo,
      cbrRate,
    );
    const systemPrompt = buildSystemPrompt(cbrRate, newsContext, assetTickers);
    const macroPercentages = actualMacroPercentages || {
      stocks: analysis.macro.stocksPercent,
      bonds: analysis.macro.bondsPercent,
    };
    const userPrompt = this.buildUserPrompt(
      context,
      cbrRate,
      newAssetsForAi,
      newsContext,
      macroPercentages,
      {
        profitC10: historicalData?.profitC10 || 0,
        profitC11: historicalData?.profitC11 || 0,
        investedNet: historicalData?.investedNet || 0,
      },
    );

    // Получаем список доступных моделей
    const availableModels = getAvailableModels();

    if (availableModels.length === 0) {
      console.warn('[AI] Нет доступных API-ключей. Используется локальный fallback.');
      return {
        text: buildFallbackReport(
          analysis,
          inc,
          validation,
          orders,
          cbrRate,
          newAssetsForAi,
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
          aiText = await this.queryOllama(model, systemPrompt, userPrompt, assetTickers);
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

        return {
          text: aiText.replace(/\n/g, '<br>'),
          modelUsed: model.name,
          success: true,
        };
      } catch (error: unknown) {
        console.error(
          '[Ollama] Ошибка подключения: ' + error,
        );

        const nextModel = getNextModel(model.id);
        if (nextModel) {
          console.log(`[AI] → Переключение на ${nextModel.name}...`);
        }
      }
    }

    // Если все модели не сработали — локальный fallback
    console.warn('[AI] ⚠️ Все модели недоступны. Используется локальный fallback.');
    return {
      text: buildFallbackReport(
        analysis,
        inc,
        validation,
        orders,
        cbrRate,
        newAssetsForAi,
      ),
      modelUsed: 'local-fallback',
      success: false,
      error: 'Все API недоступны',
    };
  }
}
