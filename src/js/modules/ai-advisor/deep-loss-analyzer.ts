/**
 * DeepLossAnalyzer — динамический анализ причин падения активов.
 *
 * Работает для ЛЮБОГО эмитента с глубоким убытком, не хардкодит тикеры.
 *
 * Ключевые принципы:
 * - Анализирует ПЕРЕПАД цены, а не абсолютное значение
 * - Сравнивает с сектором/рынком — это системное падение или проблема компании?
 * - Учитывает макро-факторы: ключевая ставка, валюты, сырьё
 * - Даёт AI контекст для обоснованной рекомендации
 */

import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';

// ──────────────────────────────────────────────
// 1. Типы данных
// ──────────────────────────────────────────────

/** Уровень глубины падения */
export type DeepLossLevel = 'MODERATE' | 'SEVERE' | 'CRITICAL';

/** Причина падения */
export type DropReason =
  | 'MARKET_CORRECTION' // Общий коррекция рынка
  | 'SECTOR_DECLINE' // Падение сектора
  | 'COMPANY_SPECIFIC' // Проблема компании
  | 'MACRO_SHOCK' // Макро-шок (ставка, валюта)
  | 'LIQUIDITY_CRUNCH' // Ликвидностный кризис
  | 'UNKNOWN'; // Не определено

/** Оценка риска фиксации убытка */
export type LossRealizationRisk = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Результат анализа глубокого падения.
 */
export interface DeepLossAnalysis {
  /** Тикер актива */
  ticker: string;
  /** Название актива */
  name: string;
  /** Текущая просадка (%) */
  drawdownPercent: number;
  /** Уровень глубины падения */
  lossLevel: DeepLossLevel;
  /** Основная причина падения */
  primaryReason: DropReason;
  /** Дополнительные причины */
  secondaryReasons: string[];
  /** Сравнение с рынком: актив упал сильнее/слабее рынка? */
  vsMarket: {
    marketDrawdown: number;
    relativePerformance: number; // положительное = отстал от рынка
    isSystemic: boolean; // системное падение или проблема компании?
  };
  /** Макро-факторы, повлиявшие на падение */
  macroFactors: Array<{
    factor: string;
    impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    description: string;
  }>;
  /** Оценка риска фиксации убытка */
  realizationRisk: LossRealizationRisk;
  /** Альтернативные сценарии вместо продажи */
  alternatives: Array<{
    action: string;
    description: string;
    risk: string;
  }>;
  /** Резюме для AI-промпта */
  summary: string;
}

// ──────────────────────────────────────────────
// 2. Определение уровня глубины падения
// ──────────────────────────────────────────────

/**
 * Определяет уровень глубины падения по проценту просадки.
 */
export function determineLossLevel(drawdownPercent: number): DeepLossLevel {
  if (drawdownPercent <= -20) return 'CRITICAL';
  if (drawdownPercent <= -40) return 'SEVERE';
  return 'MODERATE';
}

/**
 * Определяет риск фиксации убытка.
 * Чем глубже падение, тем выше психологический риск фиксации.
 */
export function determineRealizationRisk(
  drawdownPercent: number,
  lossLevel: DeepLossLevel,
): LossRealizationRisk {
  if (lossLevel === 'CRITICAL' || drawdownPercent <= -50) return 'HIGH';
  if (lossLevel === 'SEVERE' || drawdownPercent <= -30) return 'MEDIUM';
  return 'LOW';
}

// ──────────────────────────────────────────────
// 3. Анализ причин падения
// ──────────────────────────────────────────────

/**
 * Определяет причину падения на основе контекста.
 *
 * Логика:
 * - Если рынок и сектор упали одинаково сильно → MARKET_CORRECTION
 * - Если только сектор упал → SECTOR_DECLINE
 * - Если актив упал значительно сильнее рынка → COMPANY_SPECIFIC
 * - Если макро-факторы (ставка, валюта) сильно изменились → MACRO_SHOCK
 */
export function determineDropReason(params: {
  drawdownPercent: number;
  marketDrawdown: number;
  sectorDrawdown: number;
  keyRateChange: number;
  currencyChange: number;
  assetType: string;
}): DropReason {
  const { drawdownPercent, marketDrawdown, sectorDrawdown, keyRateChange, currencyChange, assetType } = params;

  // Если макро-факторы значительные → MACRO_SHOCK
  if (Math.abs(keyRateChange) > 2 || Math.abs(currencyChange) > 5) {
    return 'MACRO_SHOCK';
  }

  // Если актив упал значительно сильнее рынка (>15 п.п.) → COMPANY_SPECIFIC
  const relativeToMarket = drawdownPercent - marketDrawdown;
  if (relativeToMarket > 15) {
    return 'COMPANY_SPECIFIC';
  }

  // Если актив упал значительно сильнее сектора (>10 п.п.) → SECTOR_DECLINE
  if (assetType !== 'BOND' && Math.abs(sectorDrawdown) > 10 && relativeToMarket < 15) {
    return 'SECTOR_DECLINE';
  }

  // Иначе → MARKET_CORRECTION
  return 'MARKET_CORRECTION';
}

// ──────────────────────────────────────────────
// 4. Макро-факторы
// ──────────────────────────────────────────────

/**
 * Определяет макро-факторы, повлиявшие на падение.
 */
export function analyzeMacroFactors(params: {
  keyRate: number;
  keyRateChange: number;
  currencyChange: number;
  oilChange: number;
}): Array<{
  factor: string;
  impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  description: string;
}> {
  const { keyRate, keyRateChange, currencyChange, oilChange } = params;
  const factors: Array<{
    factor: string;
    impact: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
    description: string;
  }> = [];

  // Ключевая ставка
  if (keyRateChange > 0) {
    factors.push({
      factor: 'keyRate',
      impact: 'NEGATIVE',
      description: `Ключевая ставка ЦБ повышена на ${keyRateChange.toFixed(1)} п.п. до ${keyRate.toFixed(1)}%. Это удорожает займы и давит на акции роста.`,
    });
  } else if (keyRateChange < 0) {
    factors.push({
      factor: 'keyRate',
      impact: 'POSITIVE',
      description: `Ключевая ставка ЦБ снижена на ${Math.abs(keyRateChange).toFixed(1)} п.п. до ${keyRate.toFixed(1)}%. Это стимулирует рынок.`,
    });
  }

  // Валюта
  if (Math.abs(currencyChange) > 3) {
    const isDepreciation = currencyChange > 0; // рубль ослаб
    if (isDepreciation) {
      factors.push({
        factor: 'currency',
        impact: 'NEGATIVE',
        description: `Рубль ослаб на ${currencyChange.toFixed(1)}%. Это давит на импортёров, но помогает экспортерам.`,
      });
    } else {
      factors.push({
        factor: 'currency',
        impact: 'NEGATIVE',
        description: `Рубль укрепился на ${Math.abs(currencyChange).toFixed(1)}%. Это давит на экспортеров.`,
      });
    }
  }

  // Сырьё
  if (Math.abs(oilChange) > 5) {
    factors.push({
      factor: 'oil',
      impact: oilChange > 0 ? 'POSITIVE' : 'NEGATIVE',
      description: `Цена нефти изменилась на ${oilChange.toFixed(1)}%. Это влияет на акции нефтегазового сектора.`,
    });
  }

  return factors;
}

// ──────────────────────────────────────────────
// 5. Альтернативы продаже
// ──────────────────────────────────────────────

/**
 * Генерирует альтернативы продаже для актива с глубоким убытком.
 *
 * Альтернативы зависят от причины падения и типа актива.
 */
export function generateAlternatives(params: {
  drawdownPercent: number;
  lossLevel: DeepLossLevel;
  reason: DropReason;
  hasPositiveFundamentals: boolean;
}): Array<{
  action: string;
  description: string;
  risk: string;
}> {
  const { drawdownPercent, lossLevel, reason, hasPositiveFundamentals } = params;
  const alternatives: Array<{
    action: string;
    description: string;
    risk: string;
  }> = [];

  // Альтернатива 1: Удержание
  alternatives.push({
    action: 'Удержание',
    description: `Удержать позицию при убытке ${drawdownPercent.toFixed(1)}%. Если фундаментал не сломлен, отскок возможен при восстановлении рынка/сектора.`,
    risk: lossLevel === 'CRITICAL'
      ? 'Высокий: актив может продолжить падение'
      : 'Средний: актив может оставаться в просадке долго',
  });

  // Альтернатива 2: Хеджирование
  if (lossLevel !== 'MODERATE') {
    alternatives.push({
      action: 'Хеджирование',
      description: 'Купить put-опционы на индекс (IMOEX) для защиты портфеля от дальнейшего падения.',
      risk: 'Стоимость опционов съедает прибыль; если рынок вырастет, опционы обесценятся',
    });
  }

  // Альтернатива 3: Усреднение
  if (hasPositiveFundamentals && lossLevel !== 'CRITICAL') {
    alternatives.push({
      action: 'Усреднение',
      description: `Докупить на уровнях поддержки для снижения средней цены входа. Целевые уровни: ${(1 + drawdownPercent / 100 * 0.5).toFixed(2)}, ${(1 + drawdownPercent / 100 * 0.75).toFixed(2)}.`,
      risk: 'Если актив продолжит падение, убыток увеличится',
    });
  }

  // Альтернатива 4: Частичная продажа
  alternatives.push({
    action: 'Частичная продажа',
    description: 'Продать 20-30% позиции для снижения риска, 70-80% удержать. Это снижает психологическое давление без полной фиксации убытка.',
    risk: 'Частичная фиксация убытка; если актив вырастет, прибыль будет меньше',
  });

  // Альтернатива 5: Ротация (только если проблема компании, не рынка)
  if (reason === 'COMPANY_SPECIFIC' && !hasPositiveFundamentals) {
    alternatives.push({
      action: 'Ротация в другой актив',
      description: 'Продать проблемный актив и перераспределить капитал в более надёжные бумаги с лучшей перспективой.',
      risk: 'Реализация убытка; новые активы могут не оправдать ожиданий',
    });
  }

  return alternatives;
}

// ──────────────────────────────────────────────
// 6. Основной интерфейс — DeepLossAnalysis
// ──────────────────────────────────────────────

/**
 * Полный анализ глубокого падения актива.
 *
 * @param params — параметры актива и контекста
 * @returns DeepLossAnalysis
 */
export function analyzeDeepLoss(params: {
  /** Анализ актива из PortfolioMath */
  asset: AssetAnalysis;
  /** Текущая просадка рынка (%) */
  marketDrawdown: number;
  /** Текущая просадка сектора (%) */
  sectorDrawdown: number;
  /** Изменение ключевой ставки (%) */
  keyRateChange: number;
  /** Текущая ключевая ставка (%) */
  keyRate: number;
  /** Изменение курса валюты (%) */
  currencyChange: number;
  /** Изменение цены нефти (%) */
  oilChange: number;
  /** Фундаментал актива в норме? */
  hasPositiveFundamentals: boolean;
}): DeepLossAnalysis {
  const {
    asset,
    marketDrawdown,
    sectorDrawdown,
    keyRateChange,
    keyRate,
    currencyChange,
    oilChange,
    hasPositiveFundamentals,
  } = params;

  // Рассчитываем drawdownPercent из balancePrice и currentPrice
  const balancePrice = asset.balancePrice ?? 0;
  const currentPrice = asset.currentPrice ?? 0;
  const drawdownPercent = balancePrice > 0
    ? ((currentPrice - balancePrice) / balancePrice) * 100
    : 0;

  // Определение уровня
  const lossLevel = determineLossLevel(drawdownPercent);

  // Определение причины
  const reason = determineDropReason({
    drawdownPercent,
    marketDrawdown,
    sectorDrawdown,
    keyRateChange,
    currencyChange: currencyChange ?? 0,
    assetType: asset.assetType.toUpperCase(),
  });

  // Макро-факторы
  const macroFactors = analyzeMacroFactors({
    keyRate,
    keyRateChange,
    currencyChange: currencyChange ?? 0,
    oilChange: oilChange ?? 0,
  });

  // Риск фиксации
  const realizationRisk = determineRealizationRisk(drawdownPercent, lossLevel);

  // Альтернативы
  const alternatives = generateAlternatives({
    drawdownPercent,
    lossLevel,
    reason,
    hasPositiveFundamentals,
  });

  // Сравнение с рынком
  const relativePerformance = drawdownPercent - marketDrawdown;
  const isSystemic = Math.abs(relativePerformance) < 10;

  // Резюме
  const reasonText = {
    MARKET_CORRECTION: 'общая коррекция рынка',
    SECTOR_DECLINE: 'падение сектора',
    COMPANY_SPECIFIC: 'проблема конкретной компании',
    MACRO_SHOCK: 'макро-шок (ставка/валюта/сырьё)',
    LIQUIDITY_CRUNCH: 'ликвидностный кризис',
    UNKNOWN: 'не определено',
  }[reason];

  const summary = [
    `${asset.ticker} (${asset.name}): падение на ${drawdownPercent.toFixed(1)}%.`,
    `Уровень: ${lossLevel === 'CRITICAL' ? 'КРИТИЧЕСКОЕ' : lossLevel === 'SEVERE' ? 'СЕРЬЁЗНОЕ' : 'УМЕРЕННОЕ'}.`,
    `Причина: ${reasonText}.`,
    isSystemic
      ? `Системное падение: актив движется вместе с рынком (относительно ${relativePerformance >= 0 ? '+' : ''}${relativePerformance.toFixed(1)} п.п.).`
      : `Проблема актива: отстал от рынка на ${relativePerformance.toFixed(1)} п.п.`,
    realizationRisk === 'HIGH'
      ? '⚠️ Высокий психологический риск фиксации убытка.'
      : '',
    alternatives.length > 0
      ? `Альтернативы: ${alternatives.map(a => a.action).join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');

  return {
    ticker: asset.ticker,
    name: asset.name,
    drawdownPercent,
    lossLevel,
    primaryReason: reason,
    secondaryReasons: macroFactors.map(f => f.description),
    vsMarket: {
      marketDrawdown,
      relativePerformance,
      isSystemic,
    },
    macroFactors,
    realizationRisk,
    alternatives,
    summary,
  };
}
