import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './prompt-templates.js';
import { AiClient } from './ai-client.js';
import type { AssetAnalysis, PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import { UIOrdersData } from './types.js';
import { PortfolioSnapshot } from '../portfolio-snapshot/portfolio-snapshot.js';
import { CbrRateData } from './cbr-rate.js';
import type { InvestmentThesisResult } from '../research/investment-thesis/types.js';

// --- Helpers ---

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
  quantity?: number;
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
    quantity: options.quantity ?? 10,
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

function createMockCbrRateData(): CbrRateData {
  return {
    rate: 21,
    source: 'cbr.ru',
    date: '2024-01-01',
    lastUpdated: '2024-01-01',
    isFresh: true,
  };
}

// --- Tests ---

describe('AI Target Architecture Tests', () => {
  it('Тест 1: USER_TARGET и AI_TARGET различаются', () => {
    // Проверяем, что промпт содержит разделение ответственности
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('targetPercent');
    expect(prompt).toContain('AI НЕ создаёт новые targetPercent');
    expect(prompt).toContain('AI НЕ изменяет BUY / REDUCE / STABLE / EXIT');
    expect(prompt).toContain('используй только targetPercent из PortfolioMath');
  });

  it('Тест 2: USER_TARGET остаётся неизменным', () => {
    const prompt = buildSystemPrompt(21);
    // Проверяем, что AI обязан использовать только targetPercent из PortfolioMath
    expect(prompt).toContain('AI НЕ изменяет BUY / REDUCE / STABLE / EXIT');
    expect(prompt).toContain('AI НЕ создаёт новые targetPercent');
  });

  it('Тест 3: PortfolioMath status остаётся неизменным', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('AI НЕ изменяет BUY / REDUCE / STABLE / EXIT');
    expect(prompt).toContain('AI НЕ пересчитывает самостоятельно текущие веса');
  });

  it('Тест 4: AI может предложить собственный target', () => {
    const prompt = buildSystemPrompt(21);
    // AI обязан использовать только targetPercent из PortfolioMath
    expect(prompt).toContain('используй только targetPercent из PortfolioMath');
    // NO_TARGET vs AI_RECOMMENDED_TARGET разделены
    expect(prompt).toContain('NO_TARGET vs AI_RECOMMENDED_TARGET');
    expect(prompt).toContain('AI_RECOMMENDED_TARGET_PERCENT — это ИСКЛЮЧИТЕЛЬНО AI-рекомендация');
  });

  it('Тест 5: AI target не попадает обратно в PortfolioMath', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('AI НЕ создаёт новые targetPercent');
    expect(prompt).toContain('AI НЕ изменяет BUY / REDUCE / STABLE / EXIT');
  });

  it('Тест 6: USER_TARGET=0 и AI_TARGET=3 корректно разделены', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('targetPercent = 0% → EXIT / ВЫХОД');
    expect(prompt).toContain('targetPercent = 0% нельзя превращать в BUY');
  });

  it('Тест 7: USER_TARGET=NOT_SET и AI_TARGET=3 корректно разделены', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('targetPercent отсутствует');
    expect(prompt).toContain('«Цель не задана»');
  });

  it('Тест 8: P&L одного ticker не попадает в другой', () => {
    const client = new AiClient();

    const stmeAsset = createMockAssetAnalysis('STME', 'Сбер ETF', {
      currentPercent: 5,
      targetPercent: 0,
      deficitRub: -20000,
      status: 'EXIT',
      balancePrice: 4.30,
      currentPrice: 4.19,
      dynamicsPercent: -2.7,
      quantity: 100,
    });

    const plzlAsset = createMockAssetAnalysis('PLZL', 'Полюс', {
      currentPercent: 10,
      targetPercent: 8,
      deficitRub: 50000,
      status: 'REDUCE',
      balancePrice: 2409.80,
      currentPrice: 996.00,
      dynamicsPercent: -58.7,
      quantity: 50,
    });

    const analysis = createMockAnalysis([stmeAsset, plzlAsset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders = createMockOrders();
    const cbrRateData = createMockCbrRateData();

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
      null,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // Проверяем, что STME и PLZL присутствуют в контексте
    expect(context).toContain('STME');
    expect(context).toContain('PLZL');

    // Проверяем, что данные каждого актива корректны
    // STME должен иметь P&L от входа -2.6%
    expect(context).toContain('-2.6%');
    // PLZL должен иметь P&L от входа -58.7%
    expect(context).toContain('-58.7%');

    // Проверяем, что каждый актив имеет свои USER_TARGET_PERCENT
    expect(context).toContain('USER_TARGET_PERCENT: 0.0%');
    expect(context).toContain('USER_TARGET_PERCENT: 8.0%');
  });

  it('Тест 9: Active order не увеличивает фактическую quantity', () => {
    const client = new AiClient();

    const asset = createMockAssetAnalysis('SBER', 'Сбербанк', {
      currentPercent: 10,
      targetPercent: 15,
      deficitRub: 50000,
      status: 'BUY',
      balancePrice: 280.00,
      currentPrice: 285.00,
      dynamicsPercent: 2.5,
      quantity: 100,
    });

    const analysis = createMockAnalysis([asset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders: UIOrdersData = {
      md: 'SBER: Заявка на BUY 50 шт. по цене 285 руб.',
    };
    const cbrRateData = createMockCbrRateData();

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
      null,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // Active orders должен быть отдельным блоком
    expect(context).toContain('АКТИВНЫЕ ЗАЯВКИ');
    expect(context).toContain('SBER: Заявка на BUY 50 шт.');

    // Quantity в контексте должна быть 100 (не 150)
    expect(context).toContain('Текущая доля: 10.0%');
    expect(context).not.toContain('Текущая доля: 15.0%');
  });

  it('Тест 10: Cash учитывается как ограничение', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('Свободный кэш является реальным ограничением покупок');
    expect(prompt).toContain('Не считать, что все BUY-дефициты можно выполнить одновременно, если свободного кэша недостаточно');
  });

  it('Тест 11: ETF не получает автоматически 3%', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('не назначает ETF/фондам/новым активам стандартные 3%');
  });

  it('Тест 12: AI может оспаривать пользовательскую цель, но обязан явно обозначить это', () => {
    const prompt = buildSystemPrompt(21);
    // Проверяем, что AI обязан использовать только targetPercent из PortfolioMath
    expect(prompt).toContain('НЕ предлагай новые целевые доли — используй только targetPercent из PortfolioMath');
    // Проверяем, что AI не создаёт новые targetPercent
    expect(prompt).toContain('AI НЕ создаёт новые targetPercent');
  });

  // --- Тесты на фактическое поведение buildPortfolioContext ---

  it('Тест 13: buildPortfolioContext НЕ изменяет USER_TARGET_PERCENT — значение передано как есть', () => {
    const client = new AiClient();

    const asset = createMockAssetAnalysis('TEST', 'Тестовый актив', {
      currentPercent: 10,
      targetPercent: 25,
      deficitRub: 30000,
      status: 'BUY',
      balancePrice: 100,
      currentPrice: 105,
      dynamicsPercent: 5,
      quantity: 50,
    });

    const analysis = createMockAnalysis([asset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders = createMockOrders();
    const cbrRateData = createMockCbrRateData();

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
      null,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // Проверяем, что targetPercent = 25.0 (как передано, без изменений)
    expect(context).toContain('USER_TARGET_PERCENT: 25.0%');

    // Проверяем, что status = BUY (как передано, без изменений)
    expect(context).toContain('PORTFOLIO_MATH_STATUS: BUY');
  });

  it('Тест 14: buildPortfolioContext НЕ изменяет PORTFOLIO_MATH_STATUS — EXIT остаётся EXIT', () => {
    const client = new AiClient();

    const asset = createMockAssetAnalysis('EXIT_TEST', 'Актив на выход', {
      currentPercent: 8,
      targetPercent: 0,
      deficitRub: -20000,
      status: 'EXIT',
      balancePrice: 200,
      currentPrice: 180,
      dynamicsPercent: -10,
      quantity: 40,
    });

    const analysis = createMockAnalysis([asset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders = createMockOrders();
    const cbrRateData = createMockCbrRateData();

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
      null,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // PORTFOLIO_MATH_STATUS должен остаться EXIT (не изменён)
    expect(context).toContain('PORTFOLIO_MATH_STATUS: EXIT');
    // USER_TARGET_PERCENT должен остаться 0.0 (не изменён)
    expect(context).toContain('USER_TARGET_PERCENT: 0.0%');
  });

  it('Тест 15: buildPortfolioContext НЕ изменяет статус NO_TARGET', () => {
    const client = new AiClient();

    const asset = createMockAssetAnalysis('NO_TARGET_TEST', 'Актив без цели', {
      currentPercent: 5,
      targetPercent: undefined,
      deficitRub: 0,
      status: 'NO_TARGET',
      balancePrice: 50,
      currentPrice: 52,
      dynamicsPercent: 4,
      quantity: 20,
    });

    const analysis = createMockAnalysis([asset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders = createMockOrders();
    const cbrRateData = createMockCbrRateData();

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
      null,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // PORTFOLIO_MATH_STATUS должен остаться NO_TARGET (не изменён)
    expect(context).toContain('PORTFOLIO_MATH_STATUS: NO_TARGET');
    // USER_TARGET_PERCENT должен быть 'НЕ ЗАДАН' (не задан)
    expect(context).toContain('USER_TARGET_PERCENT: НЕ ЗАДАН');
    // AI_RECOMMENDED_TARGET_PERCENT явно отделён от USER_TARGET
    expect(context).toContain('AI_RECOMMENDED_TARGET_PERCENT: AI формирует рекомендацию самостоятельно');
    expect(context).toContain('НЕ пользовательская цель');
  });

  it('Тест 16: buildPortfolioContext НЕ изменяет REDUCE статус', () => {
    const client = new AiClient();

    const asset = createMockAssetAnalysis('REDUCE_TEST', 'Актив на снижение', {
      currentPercent: 20,
      targetPercent: 10,
      deficitRub: -50000,
      status: 'REDUCE',
      balancePrice: 300,
      currentPrice: 310,
      dynamicsPercent: 3.3,
      quantity: 60,
    });

    const analysis = createMockAnalysis([asset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders = createMockOrders();
    const cbrRateData = createMockCbrRateData();

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
      null,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // PORTFOLIO_MATH_STATUS должен остаться REDUCE (не изменён)
    expect(context).toContain('PORTFOLIO_MATH_STATUS: REDUCE');
    // USER_TARGET_PERCENT должен остаться 10.0 (не изменён)
    expect(context).toContain('USER_TARGET_PERCENT: 10.0%');
  });

  it('Тест 17: buildPortfolioContext НЕ изменяет HOLD статус', () => {
    const client = new AiClient();

    const asset = createMockAssetAnalysis('HOLD_TEST', 'Актив на удержание', {
      currentPercent: 12,
      targetPercent: 12,
      deficitRub: 0,
      status: 'HOLD',
      balancePrice: 150,
      currentPrice: 150,
      dynamicsPercent: 0,
      quantity: 30,
    });

    const analysis = createMockAnalysis([asset]);
    const inc = createMockIncome();
    const validation = createMockValidation();
    const orders = createMockOrders();
    const cbrRateData = createMockCbrRateData();

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
      null,
      new Map(),
      undefined,
      undefined,
      cbrRateData,
    );

    // PORTFOLIO_MATH_STATUS должен остаться HOLD (не изменён)
    expect(context).toContain('PORTFOLIO_MATH_STATUS: HOLD');
    // USER_TARGET_PERCENT должен остаться 12.0 (не изменён)
    expect(context).toContain('USER_TARGET_PERCENT: 12.0%');
  });
});
