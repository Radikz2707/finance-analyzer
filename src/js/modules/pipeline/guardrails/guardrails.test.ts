/**
 * Регрессионные тесты для Guardrails — модуля защиты от опасных рекомендаций ИИ.
 *
 * Проверяют:
 * 1. Блокировка SELL/EXIT/REDUCE для активов в статусе RECOVERY_ONLY
 * 2. Предупреждение о концентрации >25%
 * 3. validateAllRecommendations — проверка массива рекомендаций
 * 4. buildGuardrailsContext — формирование контекста для промпта
 * 5. isRecoveryOnly — проверка статуса позиции
 * 6. buildRecoveryStrategy — корректное субсидирование (купоны, не НКД)
 */

import { describe, it, expect } from 'vitest';

import {
  isRecoveryOnly,
  getRecoveryOnlyTickers,
  checkGuardrails,
  validateAllRecommendations,
  buildGuardrailsContext,
} from './guardrails.js';
import type { PortfolioPosition } from '../../db-manager/types.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';

// ──────────────────────────────────────────────
// Мок-репозиторий позиций
// ──────────────────────────────────────────────

function createMockPositionsRepo(positions: PortfolioPosition[]) {
  return {
    getByTicker: (ticker: string): PortfolioPosition | undefined =>
      positions.find((p) => p.ticker === ticker),
    getAll: (): PortfolioPosition[] => positions,
  };
}

function createMockAsset(ticker: string, overrides = {}): AssetAnalysis {
  return {
    name: ticker,
    ticker,
    assetType: ticker === 'PLZL' ? 'А' : 'О',
    currentPercent: 10,
    balancePrice: 100,
    currentPrice: 80,
    nkdRub: 0,
    couponRub: 5,
    nominal: 1000,
    quantity: 10,
    deficitRub: 0,
    status: 'BUY' as const,
    dynamicsPercent: 0,
    priority: 0,
    isConcentrated: false,
    unrealizedProfitRub: 0,
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Данные для тестов
// ──────────────────────────────────────────────

const recoveryPosition: PortfolioPosition = {
  id: 1,
  ticker: 'PLZL',
  name: 'Полюс',
  assetType: 'STOCK',
  issuer: 'Polymetal',
  currency: 'RUB',
  market: 'MOEX',
  status: 'RECOVERY_ONLY',
  avgPrice: 5000,
  quantity: 10,
  totalCost: 50000,
  currentPrice: 4000,
  currentMarketValue: 40000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const normalPosition: PortfolioPosition = {
  id: 2,
  ticker: 'SBER',
  name: 'Сбербанк',
  assetType: 'STOCK',
  issuer: 'Sberbank',
  currency: 'RUB',
  market: 'MOEX',
  status: 'ACTIVE',
  avgPrice: 280,
  quantity: 100,
  totalCost: 28000,
  currentPrice: 300,
  currentMarketValue: 30000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const anotherRecoveryPosition: PortfolioPosition = {
  id: 3,
  ticker: 'GMKN',
  name: 'Северный никель',
  assetType: 'STOCK',
  issuer: 'Norilsk Nickel',
  currency: 'RUB',
  market: 'MOEX',
  status: 'RECOVERY_ONLY',
  avgPrice: 30000,
  quantity: 5,
  totalCost: 150000,
  currentPrice: 24000,
  currentMarketValue: 120000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ──────────────────────────────────────────────
// 1. isRecoveryOnly
// ──────────────────────────────────────────────

describe('isRecoveryOnly', () => {
  it('должен вернуть true для актива в RECOVERY_ONLY', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    expect(isRecoveryOnly('PLZL', repo)).toBe(true);
  });

  it('должен вернуть false для актива в ACTIVE', () => {
    const repo = createMockPositionsRepo([normalPosition]);
    expect(isRecoveryOnly('SBER', repo)).toBe(false);
  });

  it('должен вернуть false для отсутствующего актива', () => {
    const repo = createMockPositionsRepo([]);
    expect(isRecoveryOnly('NOBODY', repo)).toBe(false);
  });

  it('должен вернуть false при ошибке репозитория', () => {
    const brokenRepo = {
      getByTicker: () => {
        throw new Error('DB error');
      },
    };
    expect(isRecoveryOnly('ANY', brokenRepo)).toBe(false);
  });
});

// ──────────────────────────────────────────────
// 2. getRecoveryOnlyTickers
// ──────────────────────────────────────────────

describe('getRecoveryOnlyTickers', () => {
  it('должен вернуть список всех RECOVERY_ONLY тикеров', () => {
    const repo = createMockPositionsRepo([
      recoveryPosition,
      normalPosition,
      anotherRecoveryPosition,
    ]);
    const tickers = getRecoveryOnlyTickers(repo);
    expect(tickers).toEqual(['PLZL', 'GMKN']);
  });

  it('должен вернуть пустой массив если нет RECOVERY_ONLY', () => {
    const repo = createMockPositionsRepo([normalPosition]);
    expect(getRecoveryOnlyTickers(repo)).toEqual([]);
  });

  it('должен вернуть пустой массив при ошибке', () => {
    const brokenRepo = {
      getAll: () => {
        throw new Error('DB error');
      },
    };
    expect(getRecoveryOnlyTickers(brokenRepo)).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 3. checkGuardrails
// ──────────────────────────────────────────────

describe('checkGuardrails', () => {
  const assetsAnalysis: AssetAnalysis[] = [
    createMockAsset('PLZL', { currentPercent: 15, balancePrice: 5000, currentPrice: 4000 }),
    createMockAsset('SBER', { currentPercent: 40, balancePrice: 280, currentPrice: 300 }),
  ];

  it('должен заблокировать SELL для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    const result = checkGuardrails('SELL', 'PLZL', repo, assetsAnalysis);

    expect(result.isSafe).toBe(false);
    expect(result.blockedActions).toHaveLength(1);
    expect(result.blockedActions[0]!.action).toBe('SELL');
    expect(result.blockedActions[0]!.reason).toContain('RECOVERY_ONLY');
  });

  it('должен заблокировать EXIT для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    const result = checkGuardrails('EXIT', 'PLZL', repo, assetsAnalysis);

    expect(result.isSafe).toBe(false);
    expect(result.blockedActions).toHaveLength(1);
  });

  it('должен заблокировать REDUCE для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    const result = checkGuardrails('REDUCE', 'PLZL', repo, assetsAnalysis);

    expect(result.isSafe).toBe(false);
    expect(result.blockedActions).toHaveLength(1);
  });

  it('должен пропустить BUY для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    const result = checkGuardrails('BUY', 'PLZL', repo, assetsAnalysis);

    expect(result.isSafe).toBe(true);
    expect(result.blockedActions).toHaveLength(0);
  });

  it('должен пропустить HOLD для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    const result = checkGuardrails('HOLD', 'PLZL', repo, assetsAnalysis);

    expect(result.isSafe).toBe(true);
    expect(result.blockedActions).toHaveLength(0);
  });

  it('должен пропустить SELL для обычного актива', () => {
    const repo = createMockPositionsRepo([normalPosition]);
    const result = checkGuardrails('SELL', 'SBER', repo, assetsAnalysis);

    expect(result.isSafe).toBe(true);
    expect(result.blockedActions).toHaveLength(0);
  });

  it('должен предупредить о концентрации >25%', () => {
    const repo = createMockPositionsRepo([normalPosition]);
    const result = checkGuardrails('SELL', 'SBER', repo, assetsAnalysis);

    const concentrationWarning = result.warnings.find(
      (w) => w.type === 'SELL_LIMIT',
    );
    expect(concentrationWarning).toBeDefined();
    expect(concentrationWarning?.message).toContain('40.0%');
  });

  it('должен вернуть пустой результат для неизвестного тикера', () => {
    const repo = createMockPositionsRepo([]);
    const result = checkGuardrails('SELL', 'UNKNOWN', repo, assetsAnalysis);

    expect(result.isSafe).toBe(true);
    expect(result.blockedActions).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// 4. validateAllRecommendations
// ──────────────────────────────────────────────

describe('validateAllRecommendations', () => {
  const assetsAnalysis: AssetAnalysis[] = [
    createMockAsset('PLZL', { currentPercent: 15 }),
    createMockAsset('SBER', { currentPercent: 10 }),
    createMockAsset('GMKN', { currentPercent: 5 }),
  ];

  it('должен заблокировать все опасные рекомендации для RECOVERY_ONLY', () => {
    const repo = createMockPositionsRepo([recoveryPosition, anotherRecoveryPosition]);
    const recommendations = [
      { ticker: 'PLZL', action: 'SELL' },
      { ticker: 'GMKN', action: 'EXIT' },
      { ticker: 'SBER', action: 'BUY' },
    ];

    const result = validateAllRecommendations(recommendations, repo, assetsAnalysis);

    expect(result.isSafe).toBe(false);
    expect(result.blockedActions).toHaveLength(2);
    expect(result.blockedActions.map((b) => b.ticker)).toContain('PLZL');
    expect(result.blockedActions.map((b) => b.ticker)).toContain('GMKN');
  });

  it('должен пропустить безопасные рекомендации', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    const recommendations = [
      { ticker: 'PLZL', action: 'BUY' },
      { ticker: 'SBER', action: 'HOLD' },
    ];

    const result = validateAllRecommendations(recommendations, repo, assetsAnalysis);

    expect(result.isSafe).toBe(true);
    expect(result.blockedActions).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// 5. buildGuardrailsContext
// ──────────────────────────────────────────────

describe('buildGuardrailsContext', () => {
  it('должен вернуть пустую строку если нет RECOVERY_ONLY', () => {
    const context = buildGuardrailsContext([], {
      getByTicker: () => undefined,
    });
    expect(context).toBe('');
  });

  it('должен сформировать контекст для одного актива', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);
    const context = buildGuardrailsContext(['PLZL'], repo);

    expect(context).toContain('ЗАЩИТНЫЕ ПРАВИЛА');
    expect(context).toContain('PLZL');
    expect(context).toContain('РЕЖИМ ВОССТАНОВЛЕНИЯ');
    expect(context).toContain('Запрещено: SELL, EXIT, REDUCE');
    expect(context).toContain('Разрешено: BUY (усреднение), HOLD');
  });

  it('должен сформировать контекст для нескольких активов', () => {
    const repo = createMockPositionsRepo([
      recoveryPosition,
      anotherRecoveryPosition,
    ]);
    const context = buildGuardrailsContext(['PLZL', 'GMKN'], repo);

    expect(context).toContain('PLZL');
    expect(context).toContain('GMKN');
    expect(context).toContain('КРИТИЧЕСКОЕ ПРАВИЛО');
  });
});

// ──────────────────────────────────────────────
// 6. buildRecoveryStrategy (через checkGuardrails)
// ──────────────────────────────────────────────

describe('buildRecoveryStrategy', () => {
  it('должен использовать couponRub для субсидирования, а не nkdRub', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);

    // Актив с высоким НКД, но нулевым купоном — не должен давать субсидирование
    const assetWithNkdButNoCoupon = createMockAsset('BOND1', {
      ticker: 'BOND1',
      currentPercent: 20,
      status: 'STABLE' as const,
      nkdRub: 50, // высокий НКД
      couponRub: 0, // но нет купона
      balancePrice: 1000,
      currentPrice: 1000,
    });

    // Актив с реальным купоном
    const assetWithCoupon = createMockAsset('BOND2', {
      ticker: 'BOND2',
      currentPercent: 30,
      status: 'STABLE' as const,
      nkdRub: 0,
      couponRub: 75, // реальный купон
      balancePrice: 1000,
      currentPrice: 1000,
    });

    const assetsAnalysis = [recoveryPosition as unknown as AssetAnalysis, assetWithNkdButNoCoupon, assetWithCoupon];
    const result = checkGuardrails('SELL', 'PLZL', repo, assetsAnalysis);

    // Стратегия должна содержать субсидирование от BOND2 (couponRub=75)
    // но НЕ от BOND1 (couponRub=0, даже если nkdRub=50)
    const recoveryStrategy = result.warnings.find(
      (w) => w.type === 'RECOVERY_ONLY_BLOCK',
    )?.recoveryStrategy;

    expect(recoveryStrategy).toBeDefined();
    expect(recoveryStrategy).toContain('75.00'); // сумма couponRub от BOND2
    expect(recoveryStrategy).not.toContain('50'); // НКД от BOND1 не должен учитываться
  });

  it('должен вернуть стратегию без субсидирования если нет стабильных позиций с купонами', () => {
    const repo = createMockPositionsRepo([recoveryPosition]);

    const assetWithNoCoupon = createMockAsset('BOND3', {
      ticker: 'BOND3',
      currentPercent: 20,
      status: 'STABLE' as const,
      nkdRub: 30,
      couponRub: 0,
      balancePrice: 1000,
      currentPrice: 1000,
    });

    const assetsAnalysis = [recoveryPosition as unknown as AssetAnalysis, assetWithNoCoupon];
    const result = checkGuardrails('SELL', 'PLZL', repo, assetsAnalysis);

    const recoveryStrategy = result.warnings.find(
      (w) => w.type === 'RECOVERY_ONLY_BLOCK',
    )?.recoveryStrategy;

    expect(recoveryStrategy).toContain('Удерживать позицию');
    expect(recoveryStrategy).not.toContain('субсидирование');
  });
});
