/**
 * MathAiAgreement — единый типизированный результат согласования
 * решения расчётного ядра (PortfolioMath) и ИИ-советника.
 *
 * Ключевой принцип:
 * - mathAction и aiAction хранятся раздельно и никогда не перезаписывают друг друга.
 * - conflict=true означает, что требуется ручная проверка (REVIEW_REQUIRED).
 * - executionAllowed=false блокирует генерацию торговой заявки.
 *
 * Сценарии:
 * 1. mathAction=REDUCE, aiAction=BUY → conflict=true, requiresReview=true, executionAllowed=false
 * 2. mathAction=BUY, aiAction=BUY → conflict=false, requiresReview=false, executionAllowed=true
 * 3. mathAction=EXIT, aiAction=BUY → conflict=true, requiresReview=true, executionAllowed=false
 * 4. Один из модулей не вернул результат → conflict=true, requiresReview=true
 */

import type { AiAction, PortfolioMathStatus, MathAgreement } from '../research/types.js';

/** Статус согласования */
export type AgreementStatus =
  | 'AGREED'           // Оба модуля согласны
  | 'CONFLICT'         // Конфликт действий
  | 'MATH_ONLY'        // Только PortfolioMath вернул результат
  | 'AI_ONLY'          // Только ИИ вернул результат
  | 'NO_DATA';         // Нет данных от обоих модулей

/**
 * Единый результат согласования PortfolioMath и ИИ.
 */
export interface MathAiAgreement {
  /** Действие, рекомендованное PortfolioMath (расчётное ядро) */
  mathAction: AiAction | PortfolioMathStatus | null;

  /** Действие, рекомендованное ИИ-советником */
  aiAction: AiAction | null;

  /** Итоговое действие (после согласования) */
  finalAction: AiAction | PortfolioMathStatus | null;

  /** true, если действия конфликтуют */
  conflict: boolean;

  /** Человекочитаемое описание причины конфликта */
  conflictReason: string | null;

  /** true, если требуется ручная проверка */
  requiresReview: boolean;

  /** true, если исполнение разрешено (без конфликта и с валидными данными) */
  executionAllowed: boolean;

  /** Статус согласования */
  status: AgreementStatus;

  /** Тикер актива, к которому относится согласование */
  ticker: string;

  /** Детали конфликта (если conflict=true) */
  conflictDetails?: {
    /** Описание действия PortfolioMath */
    mathDescription: string;
    /** Описание действия ИИ */
    aiDescription: string;
    /** Уровень серьёзности конфликта */
    severity: 'high' | 'medium' | 'low';
  };
}

/**
 * Совместимые действия (не конфликтуют):
 * - BUY и AVERAGE совместимы (оба предполагают покупку)
 * - SELL и REDUCE совместимы (оба предполагают уменьшение позиции)
 * - НО: EXIT (полное закрытие) и REDUCE (частичное сокращение) НЕ совместимы,
 *   так как представляют разный объём сделки.
 * - HOLD и STABLE совместимы (удержание)
 *
 * ИСПРАВЛЕНИЕ P0-3: EXIT и REDUCE больше не считаются автоматически совместимыми.
 */
const COMPATIBLE_GROUPS: Record<string, string[]> = {
  BUY: ['BUY', 'AVERAGE'],
  AVERAGE: ['BUY', 'AVERAGE'],
  SELL: ['SELL', 'REDUCE'], // SELL и REDUCE совместимы (оба — уменьшение)
  REDUCE: ['SELL', 'REDUCE'], // REDUCE и SELL совместимы
  // EXIT больше НЕ включает REDUCE/SELL — это полный выход, а не частичное сокращение
  EXIT: ['EXIT'],
  HOLD: ['HOLD', 'STABLE'],
  STABLE: ['HOLD', 'STABLE'],
  NEW: ['NEW', 'BUY'],
  NO_TARGET: ['NO_TARGET', 'HOLD', 'STABLE'],
};

/**
 * Нормализует PortfolioMathStatus в AiAction для сравнения.
 */
function normalizeToAiAction(
  status: PortfolioMathStatus | AiAction | null,
): AiAction | null {
  if (!status) return null;

  const statusToAction: Record<string, AiAction> = {
    BUY: 'BUY',
    SELL: 'SELL',
    HOLD: 'HOLD',
    REDUCE: 'REDUCE',
    EXIT: 'EXIT',
    NEW: 'BUY', // NEW → BUY (покупка нового актива)
    STABLE: 'HOLD', // STABLE → HOLD
    NO_TARGET: 'HOLD', // NO_TARGET → HOLD (нет рекомендации)
  };

  return statusToAction[status as string] ?? null;
}

/**
 * Проверяет, совместимы ли два действия.
 */
function areActionsCompatible(
  action1: AiAction | null,
  action2: AiAction | null,
): boolean {
  if (!action1 || !action2) return false;

  const normalized1 = action1;
  const normalized2 = action2;

  // Одно и то же действие — всегда совместимо
  if (normalized1 === normalized2) return true;

  // Проверяем группы совместимости
  const group1 = COMPATIBLE_GROUPS[normalized1];
  if (group1 && group1.includes(normalized2)) return true;

  const group2 = COMPATIBLE_GROUPS[normalized2];
  if (group2 && group2.includes(normalized1)) return true;

  return false;
}

/**
 * Определяет уровень серьёзности конфликта.
 * ИСПРАВЛЕНИЕ P0-3: EXIT vs REDUCE/SELL — конфликт объёма сделки (high).
 */
function determineConflictSeverity(
  mathAction: AiAction | null,
  aiAction: AiAction | null,
): 'high' | 'medium' | 'low' {
  // Высокая серьёзность: BUY vs SELL/REDUCE/EXIT (противоположные направления)
  const highConflictPairs = [
    ['BUY', 'SELL'],
    ['BUY', 'REDUCE'],
    ['BUY', 'EXIT'],
    ['SELL', 'BUY'],
    ['REDUCE', 'BUY'],
    ['EXIT', 'BUY'],
    // ИСПРАВЛЕНИЕ P0-3: EXIT vs REDUCE/SELL — конфликт объёма сделки
    ['EXIT', 'REDUCE'],
    ['EXIT', 'SELL'],
    ['REDUCE', 'EXIT'],
    ['SELL', 'EXIT'],
  ];

  for (const [a, b] of highConflictPairs) {
    if (
      (mathAction === a && aiAction === b) ||
      (mathAction === b && aiAction === a)
    ) {
      return 'high';
    }
  }

  // Средняя серьёзность: SELL vs REDUCE (оба уменьшение, но разный объём)
  const mediumConflictPairs = [
    ['SELL', 'REDUCE'],
    ['REDUCE', 'SELL'],
  ];

  for (const [a, b] of mediumConflictPairs) {
    if (
      (mathAction === a && aiAction === b) ||
      (mathAction === b && aiAction === a)
    ) {
      return 'medium';
    }
  }

  return 'low';
}

/**
 * Формирует описание действия для логов.
 */
function describeAction(
  action: AiAction | PortfolioMathStatus | null,
): string {
  if (!action) return 'НЕ ОПРЕДЕЛЕНО';
  return action.toUpperCase();
}

/**
 * Согласует решение PortfolioMath и ИИ.
 *
 * @param ticker — тикер актива
 * @param mathAction — действие от PortfolioMath (может быть PortfolioMathStatus)
 * @param aiAction — действие от ИИ (AiAction)
 * @param mathAgreement — согласие ИИ с PortfolioMath (из AI JSON)
 * @returns результат согласования
 */
export function agreeMathAndAi(
  ticker: string,
  mathAction: AiAction | PortfolioMathStatus | null,
  aiAction: AiAction | null,
  mathAgreement: MathAgreement | null = null,
): MathAiAgreement {
  // Нормализуем mathAction в AiAction для сравнения
  const normalizedMath = normalizeToAiAction(
    mathAction as PortfolioMathStatus | AiAction | null,
  );
  const normalizedAi = aiAction;

  // Случай 1: Нет данных от обоих модулей
  if (!normalizedMath && !normalizedAi) {
    return {
      ticker,
      mathAction,
      aiAction,
      finalAction: null,
      conflict: false,
      conflictReason: 'Нет данных от обоих модулей',
      requiresReview: true,
      executionAllowed: false,
      status: 'NO_DATA',
    };
  }

  // Случай 2: Только PortfolioMath
  if (normalizedMath && !normalizedAi) {
    return {
      ticker,
      mathAction,
      aiAction: null,
      finalAction: mathAction,
      conflict: false,
      conflictReason: null,
      requiresReview: false,
      executionAllowed: true,
      status: 'MATH_ONLY',
    };
  }

  // Случай 3: Только ИИ
  if (!normalizedMath && normalizedAi) {
    return {
      ticker,
      mathAction: null,
      aiAction,
      finalAction: aiAction,
      conflict: true,
      conflictReason: 'ИИ рекомендовал действие, но PortfolioMath не вернул результат',
      requiresReview: true,
      executionAllowed: false,
      status: 'AI_ONLY',
    };
  }

  // Случай 4: Оба вернули результат — проверяем совместимость
  if (areActionsCompatible(normalizedMath, normalizedAi)) {
    // Действия совместимы — используем действие ИИ (оно более конкретное)
    // или PortfolioMath (если ИИ вернул HOLD — нейтральное действие)
    const finalAction =
      normalizedAi === 'HOLD'
        ? mathAction
        : aiAction;

    return {
      ticker,
      mathAction,
      aiAction,
      finalAction,
      conflict: false,
      conflictReason: null,
      requiresReview: false,
      executionAllowed: true,
      status: 'AGREED',
    };
  }

  // Конфликт!
  const severity = determineConflictSeverity(normalizedMath, normalizedAi);
  const conflictReason = `Конфликт: PortfolioMath=${describeAction(
    mathAction,
  )}, ИИ=${describeAction(aiAction)}`;

  // Если ИИ явно не согласен (DISAGREE) — конфликт подтверждён
  const isDisagreement = mathAgreement === 'DISAGREE';

  // При конфликте HIGH severity — всегда требует ручной проверки
  // При MEDIUM — также требует проверки (SELL vs EXIT/REDUCE)
  // При LOW — можно пропустить, но логируем
  const requiresReview = severity !== 'low' || isDisagreement;

  return {
    ticker,
    mathAction,
    aiAction,
    finalAction: null, // При конфликте — нет финального действия
    conflict: true,
    conflictReason,
    requiresReview,
    executionAllowed: false, // БЛОКИРУЕМ исполнение при конфликте
    status: 'CONFLICT',
    conflictDetails: {
      mathDescription: describeAction(mathAction),
      aiDescription: describeAction(aiAction),
      severity,
    },
  };
}

/**
 * Проверяет, разрешено ли исполнение действия с учётом защитных ограничений.
 *
 * @param agreement — результат согласования
 * @param holdOnly — true, если позиция запрещена к продаже
 * @param marketDataValid — true, если рыночные данные достоверны
 * @param executionBlocked — true, если исполнение заблокировано
 * @returns true, если исполнение разрешено
 */
export function isExecutionAllowed(
  agreement: MathAiAgreement,
  holdOnly: boolean = false,
  marketDataValid: boolean = true,
  executionBlocked: boolean = false,
): boolean {
  // 1. Если есть конфликт — исполнение запрещено
  if (agreement.conflict || agreement.requiresReview) {
    return false;
  }

  // 2. Если holdOnly — запрещена продажа/уменьшение
  if (holdOnly) {
    const sellActions: string[] = ['SELL', 'REDUCE', 'EXIT'];
    const finalActionStr = agreement.finalAction as string | null;
    if (finalActionStr && sellActions.includes(finalActionStr)) {
      return false;
    }
  }

  // 3. Если рыночные данные невалидны — исполнение запрещено
  if (!marketDataValid) {
    return false;
  }

  // 4. Если исполнение заблокировано — запрещено
  if (executionBlocked) {
    return false;
  }

  return true;
}
