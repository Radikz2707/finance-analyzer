// TЗ: Тесты для guardrails — защита от опасных рекомендаций
import {
  checkGuardrails,
  validateAllRecommendations,
  buildGuardrailsContext,
  isRecoveryOnly,
} from './guardrails.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import type { PortfolioPosition } from '../../db-manager/types.js';
import { resetUserPolicyCache } from '../../../config/user-policy.js';

function createMockPositionRepo(status?: string): {
  getByTicker: (ticker: string) => PortfolioPosition | undefined;
  getAll: () => PortfolioPosition[];
} {
  const mockPosition: PortfolioPosition = {
    ticker: 'TEST',
    name: 'Test',
    avgPrice: 100,
    status: status || 'ACTIVE',
    assetType: 'А',
    issuer: '',
    currency: 'RUB',
    market: '',
    quantity: 0,
    balanceValue: 0,
    liquidationValue: 0,
    unrealizedPnL: 0,
    holdOnly: false,
    excludeFromStockPool: false,
  } as unknown as PortfolioPosition;
  return {
    getByTicker: () => mockPosition,
    getAll: () => [mockPosition],
  };
}

function createAsset(o: Partial<AssetAnalysis>): AssetAnalysis {
  return {
    name: 'Тест',
    ticker: 'TEST',
    assetType: 'А',
    currentPercent: 10,
    targetPercent: 10,
    deficitRub: 0,
    status: 'STABLE',
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 0,
    quantity: 10,
    balancePrice: 100,
    currentPrice: 100,
    unrealizedProfitRub: 0,
    priority: 0,
    isConcentrated: false,
    ...o,
  };
}

describe('Guardrails — защита от опасных рекомендаций', () => {
  // ─── checkGuardrails: RECOVERY_ONLY ───
  it('должен заблокировать SELL для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    const asset = createAsset({ ticker: 'TEST', currentPrice: 80, balancePrice: 120 });
    const result = checkGuardrails('SELL', 'TEST', repo, [asset]);
    expect(result.isSafe).toBe(false);
    expect(result.blockedActions).toHaveLength(1);
    expect(result.blockedActions[0]!.action).toBe('SELL');
    expect(result.blockedActions[0]!.reason).toContain('RECOVERY_ONLY');
  });

  it('должен заблокировать EXIT для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    const asset = createAsset({ ticker: 'TEST' });
    const result = checkGuardrails('EXIT', 'TEST', repo, [asset]);
    expect(result.blockedActions).toHaveLength(1);
  });

  it('должен заблокировать REDUCE для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    const asset = createAsset({ ticker: 'TEST' });
    const result = checkGuardrails('REDUCE', 'TEST', repo, [asset]);
    expect(result.blockedActions).toHaveLength(1);
  });

  it('не должен блокировать BUY для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    const asset = createAsset({ ticker: 'TEST' });
    const result = checkGuardrails('BUY', 'TEST', repo, [asset]);
    expect(result.blockedActions).toHaveLength(0);
    expect(result.isSafe).toBe(true);
  });

  it('не должен блокировать HOLD для RECOVERY_ONLY актива', () => {
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    const asset = createAsset({ ticker: 'TEST' });
    const result = checkGuardrails('HOLD', 'TEST', repo, [asset]);
    expect(result.blockedActions).toHaveLength(0);
  });

  it('не должен блокировать действие когда актив не RECOVERY_ONLY', () => {
    const repo = createMockPositionRepo();
    const asset = createAsset({ ticker: 'TEST' });
    const result = checkGuardrails('SELL', 'TEST', repo, [asset]);
    expect(result.blockedActions).toHaveLength(0);
  });

  it('должен предупредить о концентрации > 25%', () => {
    const repo = createMockPositionRepo();
    const asset = createAsset({ ticker: 'TEST', currentPercent: 30 });
    const result = checkGuardrails('SELL', 'TEST', repo, [asset]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.type).toBe('SELL_LIMIT');
  });

  // ─── No-sell policy ───
  describe('No-sell policy', () => {
    beforeEach(() => {
      resetUserPolicyCache();
    });

    it('должен заблокировать EXIT для IRAO (no-sell ticker)', () => {
      process.env.PORTFOLIO_NO_SELL_TICKERS = 'IRAO,TATN';
      const repo = createMockPositionRepo();
      const asset = createAsset({ ticker: 'IRAO', currentPercent: 10 });
      const result = checkGuardrails('EXIT', 'IRAO', repo, [asset]);
      expect(result.blockedActions).toHaveLength(1);
      expect(result.blockedActions[0]!.reason).toContain('NO_SELL_POLICY');
    });

    it('должен заблокировать SELL для TATN (no-sell ticker)', () => {
      process.env.PORTFOLIO_NO_SELL_TICKERS = 'IRAO,TATN';
      const repo = createMockPositionRepo();
      const asset = createAsset({ ticker: 'TATN', currentPercent: 8 });
      const result = checkGuardrails('SELL', 'TATN', repo, [asset]);
      expect(result.blockedActions).toHaveLength(1);
      expect(result.blockedActions[0]!.reason).toContain('NO_SELL_POLICY');
    });

    it('должен заблокировать REDUCE для no-sell ticker', () => {
      process.env.PORTFOLIO_NO_SELL_TICKERS = 'IRAO,TATN';
      const repo = createMockPositionRepo();
      const asset = createAsset({ ticker: 'IRAO', currentPercent: 10 });
      const result = checkGuardrails('REDUCE', 'IRAO', repo, [asset]);
      expect(result.blockedActions).toHaveLength(1);
    });

    it('не должен блокировать BUY для no-sell ticker', () => {
      process.env.PORTFOLIO_NO_SELL_TICKERS = 'IRAO,TATN';
      const repo = createMockPositionRepo();
      const asset = createAsset({ ticker: 'IRAO', currentPercent: 10 });
      const result = checkGuardrails('BUY', 'IRAO', repo, [asset]);
      expect(result.blockedActions).toHaveLength(0);
      expect(result.isSafe).toBe(true);
    });

    it('не должен блокировать HOLD для no-sell ticker', () => {
      process.env.PORTFOLIO_NO_SELL_TICKERS = 'IRAO,TATN';
      const repo = createMockPositionRepo();
      const asset = createAsset({ ticker: 'IRAO', currentPercent: 10 });
      const result = checkGuardrails('HOLD', 'IRAO', repo, [asset]);
      expect(result.blockedActions).toHaveLength(0);
    });

    it('должен заблокировать EXIT для GMKN (из user-policy.json)', () => {
      resetUserPolicyCache();
      delete process.env.PORTFOLIO_NO_SELL_TICKERS;
      const repo = createMockPositionRepo();
      const asset = createAsset({ ticker: 'GMKN', currentPercent: 8 });
      const result = checkGuardrails('EXIT', 'GMKN', repo, [asset]);
      expect(result.blockedActions).toHaveLength(1);
      expect(result.blockedActions[0]!.reason).toContain('NO_SELL_POLICY');
    });
  });

  // ─── validateAllRecommendations ───
  it('должен проверить все рекомендации', () => {
    process.env.PORTFOLIO_NO_SELL_TICKERS = '';
    resetUserPolicyCache();
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    const asset = createAsset({ ticker: 'TEST' });
    const recommendations = [
      { ticker: 'TEST', action: 'SELL' },
      { ticker: 'TEST', action: 'BUY' },
    ];
    const result = validateAllRecommendations(recommendations, repo, [asset]);
    expect(result.blockedActions).toHaveLength(1);
    expect(result.blockedActions[0]!.action).toBe('SELL');
  });

  // ─── isRecoveryOnly ───
  it('должен вернуть true для RECOVERY_ONLY', () => {
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    expect(isRecoveryOnly('TEST', repo)).toBe(true);
  });

  it('должен вернуть false когда статус другой', () => {
    const repo = createMockPositionRepo('ACTIVE');
    expect(isRecoveryOnly('TEST', repo)).toBe(false);
  });

  it('должен вернуть false когда позиция не найдена', () => {
    const repo = createMockPositionRepo();
    expect(isRecoveryOnly('TEST', repo)).toBe(false);
  });

  // ─── buildGuardrailsContext ───
  it('должен вернуть пустую строку когда нет recovery ticker', () => {
    const result = buildGuardrailsContext([], createMockPositionRepo());
    expect(result).toBe('');
  });

  it('должен сгенерировать контекст для recovery ticker', () => {
    const repo = createMockPositionRepo('RECOVERY_ONLY');
    const result = buildGuardrailsContext(['TEST'], repo);
    expect(result).toContain('RECOVERY_ONLY');
    expect(result).toContain('Запрещено: SELL, EXIT, REDUCE');
    expect(result).toContain('Разрешено: BUY');
  });
});
