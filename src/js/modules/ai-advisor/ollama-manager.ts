/**
 * Модуль управления моделями Ollama
 * Предоставляет функции для работы с локальными AI-моделями
 */

import axios from 'axios';

/** Информация о модели Ollama */
export interface OllamaModelInfo {
  /** Имя модели */
  name: string;
  /** ID модели */
  model: string;
  /** Размер в байтах */
  size: number;
  /** Дайджест модели */
  digest: string;
  /** Параметры модели */
  details?: {
    parentModel: string;
    format: string;
    family: string;
    families: string[];
    parameterSize: string;
    quantizationLevel: string;
  };
}

/** Ответ API Ollama на запрос /api/tags */
export interface OllamaTagsResponse {
  models: OllamaModelInfo[];
}

/** Ответ API Ollama на запрос /api/show */
export type OllamaShowResponse = Record<string, unknown>;

/** Параметры запроса к Ollama */
export interface OllamaChatOptions {
  /** Максимальное количество токенов в ответе */
  numPredict?: number;
  /** Температура генерации (0-1) */
  temperature?: number;
  /** Top-p для выборки */
  topP?: number;
  /** Top-k для выборки */
  topK?: number;
  /** Системный промпт */
  system?: string;
  /** Частота_penalty */
  frequencyPenalty?: number;
  /** Presence penalty */
  presencePenalty?: number;
}

/** Сообщение в чате */
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Базовый URL API Ollama */
export const OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * Проверка доступности Ollama
 */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 3000,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Получение списка установленных моделей
 */
export async function listModels(): Promise<OllamaModelInfo[]> {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, {
      timeout: 5000,
    });
    return response.data.models || [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Ollama] Ошибка получения списка моделей:', errorMessage);
    return [];
  }
}

/**
 * Получение информации о конкретной модели
 */
export async function showModelInfo(modelName: string): Promise<OllamaShowResponse | null> {
  try {
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/show`, {
      model: modelName,
    }, {
      timeout: 5000,
    });
    return response.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Ollama] Ошибка получения информации о модели ${modelName}:`, errorMessage);
    return null;
  }
}

/**
 * Проверка, установлена ли конкретная модель
 */
export async function isModelInstalled(modelName: string): Promise<boolean> {
  const models = await listModels();
  return models.some((m) => m.name.includes(modelName));
}

/**
 * Установка модели Ollama
 */
export async function pullModel(
  modelName: string,
  onProgress?: (status: string, completed: number, total: number) => void,
): Promise<boolean> {
  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/pull`,
      { name: modelName, stream: true },
      {
        timeout: 300000, // 5 минут на скачивание
        responseType: 'stream',
      },
    );

    return new Promise((resolve) => {
      let currentStatus = '';
      let total = 0;
      let completed = 0;

      response.data.on('data', (chunk: Buffer) => {
        try {
          const lines = chunk.toString().split('\n');
          lines.forEach((line) => {
            if (!line.trim()) return;
            
            try {
              const json = JSON.parse(line);
              const newStatus = json.status || '';
              
              // Обновляем прогресс
              if (json.total && json.completed) {
                total = json.total;
                completed = json.completed;
                const percent = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
                
                if (newStatus !== currentStatus) {
                  currentStatus = newStatus;
                  console.log(
                    `[Ollama] ${newStatus} ${modelName}: ${percent}%`,
                  );
                }
                
                if (onProgress) {
                  onProgress(newStatus, completed, total);
                }
              } else if (newStatus && newStatus !== currentStatus) {
                currentStatus = newStatus;
                console.log(`[Ollama] ${newStatus} ${modelName}`);
                
                if (onProgress) {
                  onProgress(newStatus, completed, total);
                }
              }
            } catch {
              // Игнорируем не-JSON данные
            }
          });
        } catch {
          // Игнорируем ошибки парсинга
        }
      });

      response.data.on('end', () => {
        console.log(`[Ollama] ✅ Модель ${modelName} успешно установлена`);
        resolve(true);
      });

      response.data.on('error', (err: Error) => {
        console.error(`[Ollama] ❌ Ошибка установки модели ${modelName}:`, err.message);
        resolve(false);
      });
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Ollama] ❌ Критическая ошибка при установке модели ${modelName}:`, errorMessage);
    return false;
  }
}

/**
 * Удаление модели Ollama
 */
export async function deleteModel(modelName: string): Promise<boolean> {
  try {
    await axios.delete(`${OLLAMA_BASE_URL}/api/delete`, {
      data: { model: modelName },
      timeout: 5000,
    });
    console.log(`[Ollama] ✅ Модель ${modelName} удалена`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Ollama] ❌ Ошибка удаления модели ${modelName}:`, errorMessage);
    return false;
  }
}

/**
 * Создание копии модели
 */
export async function copyModel(
  sourceName: string,
  destinationName: string,
): Promise<boolean> {
  try {
    await axios.post(`${OLLAMA_BASE_URL}/api/copy`, {
      source: sourceName,
      destination: destinationName,
    }, {
      timeout: 10000,
    });
    console.log(`[Ollama] ✅ Модель ${sourceName} скопирована в ${destinationName}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      '[Ollama] ❌ Ошибка копирования модели:',
      errorMessage,
    );
    return false;
  }
}

/**
 * Генерация чистого текста из сообщения (без markdown-форматирования)
 * Усиленная версия: удаление артефактов, валидация структуры
 */
export function cleanAiResponse(text: string, assetTickers?: string[]): string {
  let cleaned = text;

  // Удаляем артефакты типа "$1.", "$2." и т.д. — в начале строки или после переноса
  cleaned = cleaned.replace(/\$[\d]+\. /g, '');
  cleaned = cleaned.replace(/\$[\d]+.\n/g, '\n');
  cleaned = cleaned.replace(/\$\d+\./g, '');

  // Удаляем markdown заголовки
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Удаляем markdown жирный текст, оставляем текст
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');

  // Удаляем markdown курсив
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1');

  // Удаляем markdown код
  cleaned = cleaned.replace(/`(.*?)`/g, '$1');

  // Удаляем markdown ссылки, оставляем текст
  cleaned = cleaned.replace(/\[(.*?)\]\(.*?\)/g, '$1');

  // Удаляем markdown цитаты
  cleaned = cleaned.replace(/^>\s*/gm, '');

  // Удаляем markdown списки
  cleaned = cleaned.replace(/^[\s]*[-*+]\s/gm, '• ');
  cleaned = cleaned.replace(/^[\s]*\d+\.\s/gm, (match) => {
    // Сохраняем нумерацию для секций
    return match;
  });

  // Удаляем подозрительные артефакты в тексте
  cleaned = cleaned.replace(/\$\d+/g, '');

  // Удаляем лишние пустые строки
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  cleaned = cleaned.trim();

  // Валидация: проверяем что модель не упоминает неизвестные тикеры
  if (assetTickers && assetTickers.length > 0) {
    cleaned = validateAssetReferences(cleaned, assetTickers);
  }

  return cleaned;
}

/**
 * Запрещённые формулировки в AI-ответах
 * Эти фразы запрещены без соответствующего evidence из ResearchData
 *
 * RegExp ловят ВСЕ словоформы и регистры через .* между ключевыми морфемами.
 */
const FORBIDDEN_PHRASES: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /гарантированн.* доходн[оы]ст[иь]/gi,
    replacement: 'потенциальная доходность (требует проверки)',
  },
  {
    pattern: /гарантированн.* доход/gi,
    replacement: 'ожидаемый доход (требует проверки)',
  },
  {
    pattern: /гарантированн.* защит[аыу]/gi,
    replacement: 'меры по снижению рисков',
  },
  {
    pattern: /надёжн.* защит.* капитала/gi,
    replacement: 'меры по снижению рисков',
  },
  {
    pattern: /безрисков.*[ый|ого|ой|им|их]/gi,
    replacement: 'низкорисковый',
  },
  {
    pattern: /100\s*%\s+гаранти[ая|ю|и|и]/gi,
    replacement: 'высокая степень уверенности (требует проверки)',
  },
  {
    pattern: /безотказн.* стратег[ия|ии|ию|ией]/gi,
    replacement: 'стратегия со сниженными рисками',
  },
  {
    pattern: /абсолютно\s+безопасн[ый|ого|ой|ым|ы]/gi,
    replacement: 'инструмент со сниженными рисками',
  },
  {
    pattern: /стопроцентн[ая|ого|ой|ы|ым]\s+гаранти[я|и|ю]/gi,
    replacement: 'высокая степень уверенности (требует проверки)',
  },
  {
    pattern: /непременн[ый|ого|ой|ым|ы]\s+прибыль/gi,
    replacement: 'потенциальная прибыль',
  },
  {
    pattern: /точно\s+выраст[ет|ёт|ли|ла|ли]/gi,
    replacement: 'может вырасти (требует проверки)',
  },
  {
    pattern: /навсегда\s+закрепит[ся|ь]/gi,
    replacement: 'может закрепить (требует проверки)',
  },
  {
    pattern: /гарантированн.* прибыл[ь|и]/gi,
    replacement: 'потенциальная прибыль (требует проверки)',
  },
  {
    pattern: /надёжн.* защит[а|ы|е|у|ой]/gi,
    replacement: 'меры по снижению рисков',
  },
];

/**
 * Детерминированная валидация AI-ответа после cleanAiResponse
 *
 * Проверяет ответ на наличие запрещённых формулировок.
 * Если найдены — заменяет на нейтральную формулировку.
 * Prompt не считается достаточным механизмом защиты.
 *
 * @param text — очищенный AI-ответ
 * @returns валидированный ответ
 */
export function validateAiOutput(text: string): string {
  let validated = text;
  let hasReplacements = false;

  for (const { pattern, replacement } of FORBIDDEN_PHRASES) {
    if (pattern.test(validated)) {
      validated = validated.replace(pattern, replacement);
      hasReplacements = true;
    }
  }

  if (hasReplacements) {
    console.warn(
      '[AI_OUTPUT_VALIDATION] ⚠️ Запрещённые формулировки заменены на нейтральные',
    );
  }

  return validated;
}

/**
 * Детерминированные значения для валидации арифметики AI-ответа
 */
export interface DeterministicAmounts {
  ticker: string;
  buyAmount?: number; // > 0 если BUY
  sellAmount?: number; // > 0 если SELL (EXIT/REDUCE)
  liquidationValue?: number;
  currentQuantity?: number;
}

/**
 * Результат валидации арифметики
 */
export interface ArithmeticValidationResult {
  valid: boolean;
  discrepancies: Array<{
    ticker: string;
    field: 'buyAmount' | 'sellAmount' | 'liquidationValue';
    expected: number;
    found?: number;
  }>;
}

/**
 * Валидация арифметики AI-ответа против детерминированных значений
 *
 * Для MVP: только ПРОВЕРЯЕТ, НЕ заменяет.
 * Проверяет только структурированные поля с deterministic marker:
 *   BUY_AMOUNT_DETERMINISTIC: X ₽
 *   SELL_AMOUNT_DETERMINISTIC: X ₽
 *   LIQUIDATION_VALUE: X ₽
 *
 * НЕ делает глобальных regex-replacement в свободном AI-тексте.
 *
 * @param text — AI-ответ
 * @param deterministicAmounts — массив детерминированных значений по тикерам
 * @returns валидированный ответ (без изменений)
 */
export function validateArithmeticConsistency(
  text: string,
  deterministicAmounts: DeterministicAmounts[],
): string {
  if (deterministicAmounts.length === 0) return text;

  const result = checkArithmeticAgainstDeterministic(text, deterministicAmounts);

  if (!result.valid) {
    console.warn(
      '[ARITHMETIC_VALIDATION] ⚠️ Обнаружены расхождения с deterministic значениями:',
    );
    for (const d of result.discrepancies) {
      console.warn(
        `  ${d.ticker} ${d.field}: expected=${d.expected}, found=${d.found ?? 'N/A'}`,
      );
    }
  }

  // MVP: возвращаем текст БЕЗ изменений, только логируем
  return text;
}

/**
 * Проверяет структурированные поля с deterministic marker'ом
 * НЕ трогает свободный текст
 */
function checkArithmeticAgainstDeterministic(
  text: string,
  deterministicAmounts: DeterministicAmounts[],
): ArithmeticValidationResult {
  const discrepancies: ArithmeticValidationResult['discrepancies'] = [];

  for (const det of deterministicAmounts) {
    const tickerUpper = det.ticker.toUpperCase();

    // Ищем структурированное поле BUY_AMOUNT_DETERMINISTIC
    if (det.buyAmount !== undefined && det.buyAmount > 0) {
      const found = parseDeterministicField(text, tickerUpper, 'BUY_AMOUNT_DETERMINISTIC');
      if (found !== null && Math.abs(found - det.buyAmount) > 0.01) {
        discrepancies.push({
          ticker: det.ticker,
          field: 'buyAmount',
          expected: det.buyAmount,
          found,
        });
      }
    }

    // Ищем структурированное поле SELL_AMOUNT_DETERMINISTIC
    if (det.sellAmount !== undefined && det.sellAmount > 0) {
      const found = parseDeterministicField(text, tickerUpper, 'SELL_AMOUNT_DETERMINISTIC');
      if (found !== null && Math.abs(found - det.sellAmount) > 0.01) {
        discrepancies.push({
          ticker: det.ticker,
          field: 'sellAmount',
          expected: det.sellAmount,
          found,
        });
      }
    }

    // Ищем структурированное поле LIQUIDATION_VALUE
    if (det.liquidationValue !== undefined && det.liquidationValue > 0) {
      const found = parseDeterministicField(text, tickerUpper, 'LIQUIDATION_VALUE');
      if (found !== null && Math.abs(found - det.liquidationValue) > 0.01) {
        discrepancies.push({
          ticker: det.ticker,
          field: 'liquidationValue',
          expected: det.liquidationValue,
          found,
        });
      }
    }
  }

  return { valid: discrepancies.length === 0, discrepancies };
}

/**
 * Парсит число из структурированного поля с deterministic marker'ом
 * Формат: FIELD_NAME: ЧИСЛО ₽ или FIELD_NAME = ЧИСЛО ₽
 *
 * @param text — AI-ответ
 * @param tickerUpper — тикер в верхнем регистре для контекста
 * @param fieldName — имя поля (BUY_AMOUNT_DETERMINISTIC и т.д.)
 * @returns числовое значение или null если поле не найдено
 */
function parseDeterministicField(
  text: string,
  tickerUpper: string,
  fieldName: string,
): number | null {
  // Ищем тикер в тексте
  const tickerIndex = text.search(new RegExp(tickerUpper, 'i'));
  if (tickerIndex === -1) return null;

  // Берём контекст ±500 символов от тикера
  const start = Math.max(0, tickerIndex - 500);
  const end = Math.min(text.length, tickerIndex + 500);
  const context = text.substring(start, end);

  // Ищем структуру: FIELD_NAME: ЧИСЛО ₽ или FIELD_NAME = ЧИСЛО ₽
  // Число может быть с разделителями тысяч (пробел, неразрывный пробел)
  const pattern = new RegExp(
    fieldName + '\\s*[:=]\\s*([\\d\\s,]+?)\\s*₽',
    'i',
  );
  const match = context.match(pattern);
  if (!match) return null;

  // Парсим число из строки с разделителями
  const raw = match[1].replace(/[\s,]/g, '');
  const num = parseFloat(raw);
  return isNaN(num) ? null : num;
}

/**
 * Валидация: проверяем что модель не упоминает компании извне портфеля
 * Удаляем или помечаем рекомендации по неизвестным тикерам
 */
function validateAssetReferences(
  text: string,
  knownTickers: string[],
): string {
  const lines = text.split('\n');
  const validatedLines: string[] = [];

  for (const line of lines) {
    // Проверяем строки с тикерами в таблицах
    const tickerMatch = line.match(/\|\s*([A-Z]{2,6})\s*\|/);
    if (tickerMatch) {
      const ticker = tickerMatch[1];
      const isKnown = knownTickers.some(
        (kt) => kt.toUpperCase() === ticker.toUpperCase(),
      );
      if (!isKnown) {
        // Помечаем строку как подозрительную
        validatedLines.push(`⚠️ [НЕ ПОДТВЕРЖДЕНО] ${line}`);
        continue;
      }
    }
    validatedLines.push(line);
  }

  return validatedLines.join('\n');
}

/**
 * Санитизация AI-нарратива: удаляет предложения с AI-generated transaction amounts
 * и portfolio KPI.
 *
 * Правила:
 * - AI НЕ должен генерировать собственные суммы сделок ("продать SBRB на 95 295 ₽")
 * - AI НЕ должен рассчитывать собственную доходность портфеля ("Убыток: -32.24%")
 * - AI НЕ должен выводить ticker + amount ("PLZL: 44 266 ₽")
 * - Все числовые значения в отчёте должны приходить из deterministic source
 *
 * Не трогает deterministic числа в таблицах и карточках — только свободный текст AI.
 *
 * Используем string-based matching вместо regex для надёжности в разных средах.
 */
export function sanitizeAiNarrative(text: string): string {
  if (!text || text.length === 0) return text;

  // Разбиваем на предложения по разделителям: . ! ?
  const sentences = text.split(/(?<=[.!?])\s+/);

  // Нормализуем: все варианты рублей → "RUB", убираем неразрывные пробелы
  const normalize = (s: string): string =>
    s
      .replace(/₽|\u20BD/g, 'RUB')
      .replace(/\bруб\.?\b/gi, 'RUB')
      .replace(/\u00A0/g, ' ');

  const hasTickerAmount = (norm: string): boolean => {
    // Ищем: тикер (2-8 заглавных) → опциональные ключевые слова → : → число → RUB
    const tickerMatch = norm.match(/\b([A-Z]{2,8})\b/);
    if (!tickerMatch) return false;
    const afterTicker = norm.slice(tickerMatch.index! + tickerMatch[0].length);
    // Проверяем: есть ли : и число + RUB после тикера
    return /:\s*(?:~?\s*)?\d[\d\s,.]*RUB/i.test(afterTicker);
  };

  const hasKpi = (norm: string): boolean => {
    // Ключевое слово → : → число%
    return /\b(убыток|прибыль|доходность|результат|итог|доход)\b[\s\S]*?:\s*[-+]?\d[\d,.]*\s*%/i.test(norm);
  };

  const hasAggregate = (norm: string): boolean => {
    // Итого/всего → : → число + RUB
    return /\b(итого|всего|общая?\s+сумма)\b[\s\S]*?:\s*[-+]?\d[\d\s,.]*RUB/i.test(norm);
  };

  const hasTransactionVerb = (norm: string): boolean => {
    // Глагол → на → число + RUB
    return /\b(продать|купить|закрыть|открыть|сделать|выкупить|погасить)\b[\s\S]*?на\s+[\d\s]+RUB/i.test(norm);
  };

  const filtered = sentences.filter((s) => {
    const norm = normalize(s.trim());
    if (norm.length === 0) return true;
    if (hasTransactionVerb(norm)) return false;
    if (hasKpi(norm)) return false;
    if (hasAggregate(norm)) return false;
    if (hasTickerAmount(norm)) return false;
    return true;
  });

  const sanitized = filtered.join(' ');

  // Safety: если санитизация удалила >70% текста — возвращаем оригинал
  if (sanitized.length < text.length * 0.3) {
    console.warn(
      '[AI_NARRATIVE_SANITIZATION] ⚠️ Санитизация удалила слишком много текста (>70%), возвращаем оригинал',
    );
    return text;
  }

  return sanitized.trim();
}

/**
 * Проверка финального AI display text на наличие структурированного JSON.
 *
 * Вызывается непосредственно перед вставкой в HTML/PDF.
 * Если structured JSON дошёл до этого уровня — это баг pipeline.
 *
 * @param text — очищенный AI-текст, который собирается показывать пользователю
 * @throws Error если обнаружен raw structured JSON
 */
export function assertFinalAiDisplaySafe(text: string): void {
  if (!text) return;

  const forbidden = [
    '"recommendedTargetPercent"',
    '"recommendedAction"',
    '"agreementWithPortfolioMath"',
    '```json',
    '{"ticker"',
  ];

  for (const pattern of forbidden) {
    if (text.includes(pattern)) {
      throw new Error(
        `[AI-REPORT] Unsanitized structured JSON reached final display layer: found "${pattern}"`,
      );
    }
  }
}

/**
 * Проверка финального report payload (HTML-строка) на наличие:
 * - raw structured JSON (recommendedTargetPercent, recommendedAction и т.д.)
 * - ```json блоков
 * - <environment_details>
 * - сырого JSON ticker object
 *
 * Вызывается непосредственно перед fs.writeFileSync(report.html).
 * Если payload содержит forbidden patterns — сборка падает.
 * Нельзя silently sanitizing malformed final report.
 *
 * @param html — итоговая HTML-строка report.html
 * @throws Error если обнаружены forbidden patterns в AI-блоке
 */
export function assertFinalReportSafe(html: string): void {
  if (!html) return;

  const forbidden = [
    'recommendedTargetPercent',
    'recommendedAction',
    'agreementWithPortfolioMath',
    '```json',
    '<environment_details>',
  ];

  // Проверяем сырой JSON-объект с ticker: {"ticker" : ...}
  const hasRawTickerJson = /\{\s*"ticker"\s*:/i.test(html);

  for (const pattern of forbidden) {
    if (html.includes(pattern)) {
      throw new Error(
        `[AI-REPORT] Forbidden pattern "${pattern}" found in final report payload`,
      );
    }
  }

  if (hasRawTickerJson) {
    throw new Error(
      '[AI-REPORT] Raw JSON ticker object found in final report payload',
    );
  }
}

/**
 * Форматирование размера в читаемом виде
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Форматирование информации о моделях для вывода
 */
export function formatModelList(models: OllamaModelInfo[]): string {
  if (models.length === 0) {
    return 'Установлено 0 моделей Ollama';
  }

  const lines = [`Установлено моделей Ollama: ${models.length}`];
  lines.push('─'.repeat(60));

  models.forEach((model, index) => {
    const sizeStr = formatFileSize(model.size);
    const params = model.details?.parameterSize || 'N/A';
    const quant = model.details?.quantizationLevel || 'N/A';
    
    lines.push(
      `${index + 1}. ${model.name} (${sizeStr}, ${params}, ${quant})`,
    );
  });

  return lines.join('\n');
}
