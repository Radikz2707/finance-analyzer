import { describe, it, expect } from 'vitest';
import { PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import { UIOrdersData } from './types.js';
import { PortfolioSnapshot } from '../portfolio-snapshot/portfolio-snapshot.js';
import { CbrRateData } from './cbr-rate.js';
import { AiClient } from './ai-client.js';
import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';
import type { InvestmentThesisResult } from '../research/investment-thesis/types.js';

// Создаём моки для тестирования
function createMockAssetAnalysis(ticker: string, name: string, options: {
  currentPercent?: number;
  targetPercent?: number;
  deficitRub?: number;
  status?: string;
  balancePrice?: number;
  currentPrice?: number;
  dynamicsPercent?: number;
  nkdRub?: number;
  assetType?: string;
}): AssetAnalysis {
  return {
    name,
    ticker,
    assetType: options.assetType || 'Акция',
    currentPercent: options.currentPercent ?? 0,
    targetPercent: options.targetPercent,
    deficitRub: options.deficitRub ?? 0,
    status: (options.status || 'HOLD') as 'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' | 'NEW' | 'EXIT' | 'NO_TARGET',
    dynamicsPercent: options.dynamicsPercent ?? 0,
    nkdRub: options.nkdRub ?? 0,
    nominal: 100,
    quantity: 10,
    balancePrice: options.balancePrice ?? 0,
    currentPrice: options.currentPrice ?? 0,
    priceUnit: 'RUB' as const,
    unrealizedProfitRub: 0,
    priority: 1,
    isConcentrated: false,
  };
}

function createMockAnalysis(assets: AssetAnalysis[]): PortfolioReportData {
  return {
    macro: {
      stocksPercent: 40,
      bondsPercent: 40,
      totalBalance: 1000000,
      freeCash: 100000,
      stocksDeficitRub: 50000,
      bondsDeficitRub: 30000,
      iisOrdersSum: 0,
      brokerOrdersSum: 0,
      activeOrdersListText: '',
    },
    assetsAnalysis: assets,
    freeStocksPoolPercent: 20,
  };
}

function createMockIncome(): CalculatedIncome {
  return {
    totalDivsNet: 50000,
    totalDivs: 60000,
    totalNkd: 10000,
    stocks: [],
  };
}

function createMockValidation(): ValidationResult {
  return {
    isValid: true,
    errors: [],
  };
}

function createMockOrders(): UIOrdersData {
  return {
    md: 'Нет активных заявок.',
  };
}

function createMockSnapshot(): PortfolioSnapshot | null {
  return null;
}

function createMockCbrRateData(): CbrRateData {
  return {
    rate: 21,
    source: 'cbr.ru',
    date: '2024-01-01',
    lastUpdated: '2024-01-01',
    isFresh: true,
  };
}

describe('Тестирование изоляции данных в AI user prompt', () => {
  it('Должен изолировать данные STME и PLZL в отдельных блоках', () => {
    const client = new AiClient();

    // Создаём тестовые данные
    const stmeAsset = createMockAssetAnalysis('STME', 'Сбер ETF', {
      currentPercent: 5,
      targetPercent: 0,
      deficitRub: -20000,
      status: 'EXIT',
      balancePrice: 4.30,
      currentPrice: 4.19,
      dynamicsPercent: -2.7,
    });

    const plzlAsset = createMockAssetAnalysis('PLZL', 'Полюс', {
      currentPercent: 10,
      targetPercent: 8,
      deficitRub: 50000,
      status: 'REDUCE',
      balancePrice: 2409.80,
      currentPrice: 996.00,
      dynamicsPercent: -58.7,
    });

    const analysis = createMockAnalysis([stmeAsset, plzlAsset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders = createMockOrders();
    const snapshot = createMockSnapshot();
    const cbrRateData = createMockCbrRateData();

    // Вызываем buildPortfolioContext
    interface PrivateAiClient {
      buildPortfolioContext(
        analysis: PortfolioReportData,
        inc: CalculatedIncome,
        validation: ValidationResult,
        orders: UIOrdersData,
        snapshot: PortfolioSnapshot | null,
        thesisResults: Map<string, InvestmentThesisResult>,
        historicalData?: {
          profitC10: number;
          profitC11: number;
          investedNet: number;
          totalPurchases: number;
          totalSales: number;
          commission: number;
        },
        accountsInfo?: Array<{ name: string; value: number }>,
        cbrRateData?: CbrRateData,
      ): string;
    }
    const context = (client as unknown as PrivateAiClient).buildPortfolioContext(
      analysis,
      inc,
      validation,
      orders,
      snapshot,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // Проверяем наличие данных активов
    expect(context).toContain('STME');
    expect(context).toContain('PLZL');

    // Проверяем данные STME
    const stmeIndex = context.indexOf('STME');
    const plzlIndex = context.indexOf('PLZL');
    expect(stmeIndex).toBeGreaterThan(-1);
    expect(plzlIndex).toBeGreaterThan(-1);

    // Блок STME (от начала до PLZL)
    const stmeBlock = context.substring(0, plzlIndex);
    expect(stmeBlock).toContain('STME');
    // DETERMINISTIC PORTFOLIO RESULT находится после всех активов, проверяем весь контекст
    expect(context).toContain('USER_TARGET_PERCENT: 0.0%');
    expect(context).toContain('PORTFOLIO_MATH_STATUS: EXIT');

    // Блок PLZL (от PLZL до конца)
    const plzlBlock = context.substring(plzlIndex);
    expect(plzlBlock).toContain('PLZL');
    expect(context).toContain('USER_TARGET_PERCENT: 8.0%');
    expect(context).toContain('PORTFOLIO_MATH_STATUS: REDUCE');

    // КРИТИЧЕСКАЯ ПРОВЕРКА: данные STME не должны содержать данные PLZL
    // В блоке STME не должно быть цен PLZL
    expect(stmeBlock).not.toContain('2 409,80');

    // КРИТИЧЕСКАЯ ПРОВЕРКА: данные PLZL не должны содержать данные STME
    // В блоке PLZL не должно быть цен STME
    expect(plzlBlock).not.toContain('4,30');

    // Проверяем наличие блока ACTIVE ORDERS отдельно от позиций
    expect(context).toContain('АКТИВНЫЕ ЗАЯВКИ');
  });
});
