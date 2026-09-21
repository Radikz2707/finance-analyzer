/**
 * Модуль пост-обработки и валидации AI-текста.
 *
 * Выполняет финальные проверки перед показом AI-ответа пользователю:
 *  1. Валидация направлений (BUY vs REDUCE/EXIT) против PortfolioMath status
 *  2. Удаление галлюцинированных цен/количеств из AI-текста
 *  3. Проверка на упоминание исключённых активов (Рубль, Итого)
 *  4. Общая очистка от детерминированных данных
 *
 * Все функции работают как pure transformers — не мутируют входные данные.
 */

import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';

// ============================================================================
// Типы
// ============================================================================

/** Результат валидации направлений */
export interface DirectionValidationResult {
  /** Общий статус валидации */
  valid: boolean;
  /** Список обнаруженных несоответствий */
  discrepancies: Array<{
    ticker: string;
    portfolioMathStatus: string;
    aiSuggestedDirection?: string;
    severity: 'high' | 'medium' | 'low';
  }>;
}

/** Результат удаления галлюцинированных данных */
export interface HallucinationRemovalResult {
  /** Очищенный текст */
  cleanedText: string;
  /** Список удалённых галлюцинаций */
  removedHallucinations: Array<{
    type: 'price' | 'quantity' | 'amount';
    ticker?: string;
    raw: string;
  }>;
}

/** Результат проверки исключённых активов */
export interface ExcludedAssetsCheckResult {
  /** Общий статус валидации */
  valid: boolean;
  /** Найденные упоминания исключённых активов */
  foundMentions: Array<{
    assetName: string;
    context: string;
  }>;
}

/** Результат полной пост-обработки AI-текста */
export interface PostProcessResult {
  /** Очищенный AI-текст */
  cleanedText: string;
  /** Результаты валидации направлений */
  directionValidation: DirectionValidationResult;
  /** Результаты удаления галлюцинаций */
  hallucinationRemoval: HallucinationRemovalResult;
  /** Результаты проверки исключённых активов */
  excludedAssetsCheck: ExcludedAssetsCheckResult;
  /** Общие предупреждения */
  warnings: string[];
}

// ============================================================================
// Константы
// ============================================================================

/**
 * Исключённые активы — агрегатные строки, которые не должны
 * упоминаться в AI-тексте как инвестиционные инструменты.
 */
const EXCLUDED_ASSET_PATTERNS: RegExp[] = [
  /рубль\w*/gi,
  /руб\.(?:\s|$)/gi,
  /итого\w*/gi,
  /баланс\w*/gi,
  /всего\w*/gi,
  /общая?\s+сумма/gi,
  /сумма\s+портфеля/gi,
  /общая?\s+стоимость/gi,
];

/**
 * Паттерны галлюцинированных цен — AI может генерировать собственные
 * цены, которые не совпадают с реальными данными из Excel.
 */
const HALLUCINATED_PRICE_PATTERNS: RegExp[] = [
  // "Цена [ТИКЕР]: 123.45 ₽" или "Цена SBRB: 280 руб"
  /(?:цена|price)\s+(?:[A-Z]{2,8})\s*[:=]\s*[\d\s,.]+₽/gi,
  // "[ТИКЕР] по текущей цене [число]"
  /([A-Z]{2,8})\s+по\s+текущ[а-яё]+\s+цен[а-яё]+\s+([\d\s,.]+)\s*₽/gi,
  // "[ТИКЕР] по цене [число]"
  /([A-Z]{2,8})\s+по\s+цене\s+([\d\s,.]+)\s*₽/gi,
  // "стоимость [ТИКЕР]: [число]"
  /(?:стоимость|value)\s+(?:[A-Z]{2,8})\s*[:=]\s*[\d\s,.]+₽/gi,
  // "текущая цена [ТИКЕР] = [число]"
  /(?:текущ[а-яё]+|current)\s+цен[а-яё]+\s+(?:[A-Z]{2,8})\s*[:=]\s*[\d\s,.]+₽/gi,
  // "рекомендуется [докупка|продажа] по цене/текущей цене [число] ₽"
  /(?:рекомендуется\s+(?:докупк[а-яё]+|продаж[а-яё]+|полн[а-яё]+\s+продаж[а-яё]+))\s+по\s+(?:текущ[а-яё]+\s+)?цен[а-яё]+\s+([\d\s,.]+)\s*₽/gi,
  // "по текущей цене [число] ₽" (без тикера — в контексте рекомендации)
  /по\s+текущ[а-яё]+\s+цен[а-яё]+\s+([\d\s,.]+)\s*₽/gi,
];

/**
 * Паттерны галлюцинированных количеств — AI может генерировать
 * собственные количества активов.
 */
const HALLUCINATED_QUANTITY_PATTERNS: RegExp[] = [
  // "[ТИКЕР]: [число] шт" или "[ТИКЕР] — 100 шт"
  /([A-Z]{2,8})\s*[:\u2014]\s*([\d\s]+)\s*шт/gi,
  // "количество [ТИКЕР]: [число]"
  /(?:количество|qty|quantity)\s+(?:[A-Z]{2,8})\s*[:=]\s*[\d\s]+/gi,
  // "[число] бумаг [ТИКЕР]"
  /([\d\s]+)\s+бумаг(?:и|\.|\s)(?:[A-Z]{2,8})/gi,
];

/**
 * Паттерны галлюцинированных сумм — AI может генерировать
 * собственные суммы сделок.
 */
const HALLUCINATED_AMOUNT_PATTERNS: RegExp[] = [
  // "[ТИКЕР]: [число] ₽" (сумма в рублях без контекста)
  /([A-Z]{2,8})\s*[:\u2014]\s*([\d\s,.]+)\s*₽(?!\s*(?:шт|руб\.))/gi,
  // "сумма [ТИКЕР]: [число] ₽"
  /(?:сумма|amount)\s+(?:[A-Z]{2,8})\s*[:=]\s*[\d\s,.]+₽/gi,
  // "на сумму [число] ₽" (AI генерирует суммы сделок)
  /на\s+сумм[а-яё]+\s+([\d\s,.]+)\s*₽/gi,
];

/**
 * Направления, которые конфликтуют с PortfolioMath status.
 * BUY конфликтует с REDUCE/EXIT, REDUCE/EXIT конфликтует с BUY.
 */
const CONFLICTING_DIRECTIONS: Record<string, string[]> = {
  BUY: ['REDUCE', 'EXIT', 'sell', 'продаж', 'закрыт', 'выйти'],
  REDUCE: ['BUY', 'куп', 'докуп', 'увелич'],
  EXIT: ['BUY', 'куп', 'докуп', 'увелич'],
  NEW: ['BUY', 'куп', 'докуп'],
};

// ============================================================================
// 1. Валидация направлений
// ============================================================================

/**
 * Проверяет, что AI не рекомендует направление, конфликтующее
 * с PortfolioMath status для каждого актива.
 *
 * Например, если PortfolioMath говорит BUY, а AI говорит "продать" —
 * это несоответствие.
 *
 * @param aiText — AI-текст для проверки
 * @param assetsAnalysis — данные анализа активов из PortfolioMath
 * @returns результат валидации
 */
export function validateDirections(
  aiText: string,
  assetsAnalysis: AssetAnalysis[],
): DirectionValidationResult {
  const discrepancies: DirectionValidationResult['discrepancies'] = [];
  const textLower = aiText.toLowerCase();

  for (const asset of assetsAnalysis) {
    const tickerUpper = asset.ticker.toUpperCase();
    const portfolioStatus = asset.status;

    // Пропускаем активы без статуса или с нейтральным статусом
    if (
      portfolioStatus === 'HOLD' ||
      portfolioStatus === 'STABLE' ||
      portfolioStatus === 'NO_TARGET'
    ) {
      continue;
    }

    // Проверяем наличие конфликтующих направлений в тексте
    const conflicts = CONFLICTING_DIRECTIONS[portfolioStatus];
    if (!conflicts) continue;

    // Ищем тикер в тексте
    const tickerFound = new RegExp(tickerUpper, 'i').test(aiText);
    if (!tickerFound) continue;

    // Проверяем контекст вокруг тикера на конфликтующие слова
    const tickerIndex = textLower.indexOf(tickerLower(tickerUpper));
    if (tickerIndex === -1) continue;

    // Берём контекст ±300 символов от тикера
    const contextStart = Math.max(0, tickerIndex - 300);
    const contextEnd = Math.min(aiText.length, tickerIndex + 300);
    const context = textLower.slice(contextStart, contextEnd);

    for (const conflicting of conflicts) {
      if (context.includes(conflicting.toLowerCase())) {
        // Высокая серьёзность для прямых противоположностей
        let severity: 'high' | 'medium' | 'low';
        if (
          (portfolioStatus === 'BUY' &&
            (conflicting === 'REDUCE' || conflicting === 'EXIT')) ||
          (portfolioStatus === 'EXIT' && conflicting === 'BUY')
        ) {
          severity = 'high';
        } else {
          severity = 'medium';
        }

        discrepancies.push({
          ticker: asset.ticker,
          portfolioMathStatus: portfolioStatus,
          aiSuggestedDirection: conflicting,
          severity,
        });

        break; // Одно несоответствие на актив достаточно
      }
    }
  }

  return {
    valid: discrepancies.length === 0,
    discrepancies,
  };
}

/**
 * Преобразует строку в нижний регистр с учётом кириллицы.
 */
function tickerLower(ticker: string): string {
  return ticker.toLowerCase();
}

// ============================================================================
// 2. Удаление галлюцинированных цен/количеств
// ============================================================================

/**
 * Удаляет из AI-текста галлюцинированные цены, количества и суммы,
 * которые не должны генерироваться AI — все числовые данные
 * должны приходить из детерминированных источников (Excel).
 *
 * @param text — AI-текст для очистки
 * @returns результат очистки
 */
export function removeHallucinatedData(
  text: string,
): HallucinationRemovalResult {
  const removedHallucinations: HallucinationRemovalResult['removedHallucinations'] = [];
  let cleanedText = text;

  // Удаляем галлюцинированные цены
  cleanedText = removePatterns(
    cleanedText,
    HALLUCINATED_PRICE_PATTERNS,
    'price',
    removedHallucinations,
  );

  // Удаляем галлюцинированные количества
  cleanedText = removePatterns(
    cleanedText,
    HALLUCINATED_QUANTITY_PATTERNS,
    'quantity',
    removedHallucinations,
  );

  // Удаляем галлюцинированные суммы
  cleanedText = removePatterns(
    cleanedText,
    HALLUCINATED_AMOUNT_PATTERNS,
    'amount',
    removedHallucinations,
  );

  return {
    cleanedText: cleanedText.trim(),
    removedHallucinations,
  };
}

/**
 * Удаляет совпадения по массиву паттернов из текста.
 */
function removePatterns(
  text: string,
  patterns: RegExp[],
  hallucinationType: 'price' | 'quantity' | 'amount',
  removedHallucinations: HallucinationRemovalResult['removedHallucinations'],
): string {
  let result = text;

  for (const pattern of patterns) {
    // Сбрасываем lastIndex для глобальных паттернов
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(result)) !== null) {
      // Защита от бесконечного цикла
      if (match.index < pattern.lastIndex - 1000) {
        pattern.lastIndex = 0;
        break;
      }

      removedHallucinations.push({
        type: hallucinationType,
        raw: match[0],
        ticker: match[1] || undefined,
      });

      // Заменяем на нейтральный маркер
      result = result.replace(match[0], '[ДАННЫЕ_УДАЛЕНЫ]');
    }
  }

  return result;
}

// ============================================================================
// 3. Проверка исключённых активов
// ============================================================================

/**
 * Проверяет, что AI не упоминает исключённые активы — агрегатные
 * строки типа "Рубль", "Итого", "Баланс", которые не являются
 * инвестиционными инструментами.
 *
 * @param text — AI-текст для проверки
 * @returns результат проверки
 */
export function checkExcludedAssets(
  text: string,
): ExcludedAssetsCheckResult {
  const foundMentions: ExcludedAssetsCheckResult['foundMentions'] = [];

  for (const pattern of EXCLUDED_ASSET_PATTERNS) {
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      // Защита от бесконечного цикла
      if (match.index < pattern.lastIndex - 1000) {
        pattern.lastIndex = 0;
        break;
      }

      // Извлекаем контекст (±50 символов)
      const contextStart = Math.max(0, match.index - 50);
      const contextEnd = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.slice(contextStart, contextEnd).trim();

      foundMentions.push({
        assetName: match[0].trim(),
        context,
      });
    }
  }

  return {
    valid: foundMentions.length === 0,
    foundMentions,
  };
}

// ============================================================================
// 4. Полная пост-обработка
// ============================================================================

/**
 * Выполняет полную пост-обработку AI-текста:
 *  1. Валидация направлений против PortfolioMath
 *  2. Удаление галлюцинированных данных
 *  3. Проверка исключённых активов
 *
 * @param aiText — исходный AI-текст
 * @param assetsAnalysis — данные анализа активов из PortfolioMath
 * @returns результат полной пост-обработки
 */
export function postProcessAiText(
  aiText: string,
  assetsAnalysis: AssetAnalysis[],
): PostProcessResult {
  const warnings: string[] = [];

  // 1. Валидация направлений
  const directionValidation = validateDirections(aiText, assetsAnalysis);
  if (!directionValidation.valid) {
    for (const d of directionValidation.discrepancies) {
      warnings.push(
        `[DIRECTION_CONFLICT] ${d.ticker}: PortfolioMath=${d.portfolioMathStatus}, ` +
        `AI=${d.aiSuggestedDirection} (severity=${d.severity})`,
      );
    }
  }

  // 2. Удаление галлюцинированных данных
  const hallucinationRemoval = removeHallucinatedData(aiText);
  if (hallucinationRemoval.removedHallucinations.length > 0) {
    warnings.push(
      `[HALLUCINATION_REMOVAL] Удалено ${hallucinationRemoval.removedHallucinations.length} ` +
      'галлюцинированных элементов (цен/количеств/сумм)',
    );
  }

  // 3. Проверка исключённых активов
  const excludedAssetsCheck = checkExcludedAssets(hallucinationRemoval.cleanedText);
  if (!excludedAssetsCheck.valid) {
    for (const m of excludedAssetsCheck.foundMentions) {
      warnings.push(
        `[EXCLUDED_ASSET] Найдено упоминание исключённого актива: "${m.assetName}"`,
      );
    }
  }

  return {
    cleanedText: hallucinationRemoval.cleanedText,
    directionValidation,
    hallucinationRemoval,
    excludedAssetsCheck,
    warnings,
  };
}
