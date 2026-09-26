/**
 * Guardrails — модуль защиты от опасных рекомендаций ИИ.
 *
 * Основные правила:
 * 1. Блокировка SELL/EXIT для активов со статусом RECOVERY_ONLY
 * 2. Пересчёт стратегии вывода через усреднение на уровнях поддержки
 * 3. Субсидирование купонами/дивидендами от стабильных позиций
 */

import type { PortfolioPosition } from '../../db-manager/types.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';

// ──────────────────────────────────────────────
// 1. Типы данных guardrails
// ────────────────────────

/** Тип защиты */
export type GuardrailType = 'RECOVERY_ONLY_BLOCK' | 'SELL_LIMIT' | 'EXIT_LIMIT';

/** Предупреждение guardrail */
export interface GuardrailWarning {
  type: GuardrailType;
  ticker: string;
  message: string;
  severity: 'BLOCK' | 'WARN' | 'INFO';
  recoveryStrategy?: string;
}

/** Результат проверки guardrail */
export interface GuardrailCheckResult {
  isSafe: boolean;
  warnings: GuardrailWarning[];
  blockedActions: Array<{ ticker: string; action: string; reason: string }>;
}

/** Рекомендация по восстановлению позиции */
export interface RecoveryRecommendation {
  ticker: string;
  currentPnlPercent: number;
  recoveryAction: 'AVG_DOWN' | 'HOLD' | 'SUBSIDIZE';
  suggestedLevels: number[]; // уровни поддержки для усреднения
  subsidySource: string; // от каких позиций субсидировать
}

// ──────────────────────────────────────────────
// 2. Проверка статуса RECOVERY_ONLY
// ──────────────────────

/**
 * Проверяет, находится ли актив в режиме восстановления.
 * @param ticker — тикер актива
 * @param positionsRepo — репозиторий позиций (для инъекции зависимости)
 * @returns true если актив в RECOVERY_ONLY
 */
export function isRecoveryOnly(
  ticker: string,
  positionsRepo: { getByTicker: (ticker: string) => PortfolioPosition | undefined },
): boolean {
  try {
    const position = positionsRepo.getByTicker(ticker);
    if (!position) {
      return false;
    }
    return position.status === 'RECOVERY_ONLY';
  } catch {
    // Безопасное поведение: если ошибка чтения БД — не блокируем
    return false;
  }
}

/**
 * Получает список всех активов в режиме RECOVERY_ONLY.
 */
export function getRecoveryOnlyTickers(
  positionsRepo: { getAll: () => PortfolioPosition[] },
): string[] {
  try {
    const allPositions = positionsRepo.getAll();
    return allPositions
      .filter((p) => p.status === 'RECOVERY_ONLY')
      .map((p) => p.ticker);
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// 3. Блокировка опасных действий
// ──────────────────────

/**
 * Проверяет рекомендацию ИИ на соответствие guardrails.
 * @param recommendedAction — действие от ИИ (BUY/SELL/REDUCE/EXIT/HOLD)
 * @param ticker — тикер актива
 * @param positionsRepo — репозиторий позиций
 * @param assetsAnalysis — анализ активов (для P&L)
 * @returns результат проверки
 */
export function checkGuardrails(
  recommendedAction: string,
  ticker: string,
  positionsRepo: {
    getByTicker: (ticker: string) => PortfolioPosition | undefined;
    getAll: () => PortfolioPosition[];
  },
  assetsAnalysis: AssetAnalysis[],
): GuardrailCheckResult {
  const warnings: GuardrailWarning[] = [];
  const blockedActions: Array<{ ticker: string; action: string; reason: string }> = [];

  const asset = assetsAnalysis.find((a) => a.ticker === ticker);
  const position = positionsRepo.getByTicker(ticker);

  // ─── Правило 1: RECOVERY_ONLY блокирует SELL/EXIT/REDUCE ───
  if (position && position.status === 'RECOVERY_ONLY') {
    const isDangerousAction =
      recommendedAction === 'SELL' ||
      recommendedAction === 'EXIT' ||
      recommendedAction === 'REDUCE';

    if (isDangerousAction) {
      const pnlPercent = asset
        ? ((asset.currentPrice - asset.balancePrice) / asset.balancePrice) * 100
        : 0;

      warnings.push({
        type: 'RECOVERY_ONLY_BLOCK',
        ticker,
        message: `Действие ${recommendedAction} заблокировано: актив ${ticker} в режиме RECOVERY_ONLY (P&L: ${pnlPercent.toFixed(1)}%)`,
        severity: 'BLOCK',
        recoveryStrategy: buildRecoveryStrategy(ticker, pnlPercent, position, assetsAnalysis),
      });

      blockedActions.push({
        ticker,
        action: recommendedAction,
        reason: `RECOVERY_ONLY: актив ${ticker} находится в режиме восстановления. Запрещена фиксация убытка.`,
      });
    }
  }

  // ─── Правило 2: Предупреждение о большой концентрации ───
  if (asset && asset.currentPercent > 25) {
    warnings.push({
      type: 'SELL_LIMIT',
      ticker,
      message: `Внимание: концентрация ${ticker} составляет ${asset.currentPercent.toFixed(1)}% — превышен лимит 25%`,
      severity: 'WARN',
    });
  }

  return {
    isSafe: blockedActions.length === 0,
    warnings,
    blockedActions,
  };
}

/**
 * Проверяет весь массив рекомендаций ИИ.
 */
export function validateAllRecommendations(
  recommendations: Array<{ ticker: string; action: string }>,
  positionsRepo: {
    getByTicker: (ticker: string) => PortfolioPosition | undefined;
    getAll: () => PortfolioPosition[];
  },
  assetsAnalysis: AssetAnalysis[],
): GuardrailCheckResult {
  const allWarnings: GuardrailWarning[] = [];
  const allBlockedActions: Array<{ ticker: string; action: string; reason: string }> = [];

  for (const rec of recommendations) {
    const result = checkGuardrails(
      rec.action,
      rec.ticker,
      positionsRepo,
      assetsAnalysis,
    );

    allWarnings.push(...result.warnings);
    allBlockedActions.push(...result.blockedActions);
  }

  return {
    isSafe: allBlockedActions.length === 0,
    warnings: allWarnings,
    blockedActions: allBlockedActions,
  };
}

// ──────────────────────────────────────────────
// 4. Генерация стратегии восстановления
// ──────────────────────

/**
 * Формирует стратегию восстановления для заблокированного актива.
 */
function buildRecoveryStrategy(
  ticker: string,
  pnlPercent: number,
  position: PortfolioPosition,
  assetsAnalysis: AssetAnalysis[],
): string {
  const strategyParts: string[] = [];

  // Усреднение на уровнях поддержки
  if (pnlPercent < -30) {
    strategyParts.push(
      '📉 Глубокий убыток (' + pnlPercent.toFixed(1) + '%): рассмотреть усреднение на уровнях поддержки. ' +
      'Целевой уровень входа: ' + position.avgPrice.toFixed(2) + ' ₽. ' +
      'Рекомендуется докупать только при подтверждении поддержки (2-3 свечи отскока).',
    );
  } else if (pnlPercent < -10) {
    strategyParts.push(
      '⚠️ Умеренный убыток (' + pnlPercent.toFixed(1) + '%): удерживать позицию, ждать отскока. ' +
      'Не продавать на минимумах.',
    );
  }

  // Субсидирование от других позиций
  const stableAssets = assetsAnalysis.filter(
    (a) =>
      a.status === 'STABLE' ||
      a.status === 'BUY' ||
      a.assetType === 'О' ||
      a.assetType === 'Облигация',
  );

  if (stableAssets.length > 0) {
    const stableDividends = stableAssets
      .filter((a) => a.nkdRub > 0)
      .reduce((sum, a) => sum + a.nkdRub, 0);

    if (stableDividends > 0) {
      strategyParts.push(
        `💰 Субсидирование: стабильные позиции генерируют ${stableDividends.toFixed(2)} ₽ купонов/дивидендов. ` +
        `Использовать для усреднения позиции ${ticker} без дополнительного кэша.`,
      );
    }
  }

  // Свободный кэш
  const freeCashAsset = assetsAnalysis.find((a) => a.assetType === 'Кэш' || a.assetType === 'CASH');
  if (freeCashAsset && freeCashAsset.currentPercent > 0) {
    strategyParts.push(
      '💵 Свободный кэш: ' + freeCashAsset.currentPercent.toFixed(1) + '% портфеля. ' +
      'Можно использовать для частичного усреднения без ребалансировки.',
    );
  }

  return strategyParts.length > 0
    ? strategyParts.join('\n')
    : 'Удерживать позицию, ждать восстановления. Не продавать на минимумах.';
}

// ──────────────────────────────────────────────
// 5. Формирование контекста guardrails для промпта
// ──────────────────────

/**
 * Генерирует текстовый блок guardrails для вставки в промпт ИИ.
 */
export function buildGuardrailsContext(
  recoveryTickers: string[],
  positionsRepo: {
    getByTicker: (ticker: string) => PortfolioPosition | undefined;
  },
): string {
  if (recoveryTickers.length === 0) {
    return '';
  }

  let context = '=== ЗАЩИТНЫЕ ПРАВИЛА (GUARDRAILS) — ОБЯЗАТЕЛЬНО СОБЛЮДАЙ ===\n';
  context += 'Следующие активы находятся в режиме RECOVERY_ONLY:\n';

  for (const ticker of recoveryTickers) {
    const position = positionsRepo.getByTicker(ticker);
    if (position) {
      context += '• ' + ticker + ' (' + position.name + '): РЕЖИМ ВОССТАНОВЛЕНИЯ\n';
      context += '  - Запрещено: SELL, EXIT, REDUCE (фиксация убытка)\n';
      context += '  - Разрешено: BUY (усреднение), HOLD\n';
      context += '  - Причина: актив ' + ticker + ' в режиме восстановления, текущая цена ниже средней\n\n';
    }
  }

  context += '⚠️ КРИТИЧЕСКОЕ ПРАВИЛО:\n';
  context += 'Если ИИ-агент рекомендует SELL/EXIT/REDUCE для актива из списка RECOVERY_ONLY:\n';
  context += '1. БЛОКИРУЙ рекомендацию\n';
  context += '2. ЗАМЕНИ на HOLD или BUY (усреднение)\n';
  context += '3. ОБЪЯСНИ причину блокировки\n';
  context += '4. ПРЕДЛОЖИ стратегию восстановления через усреднение на уровнях поддержки\n';
  context += '5. ПРЕДЛОЖИ субсидирование купонами/дивидендами от стабильных позиций\n\n';

  return context;
}
