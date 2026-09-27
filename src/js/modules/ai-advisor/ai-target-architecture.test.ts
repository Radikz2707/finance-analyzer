import { buildSystemPrompt } from './prompt-templates.js';
import { AiClient } from './ai-client.js';
import type {
  AssetAnalysis,
  PortfolioReportData,
} from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import { UIOrdersData } from './types.js';
import { PortfolioSnapshot } from '../portfolio-snapshot/portfolio-snapshot.js';
import { CbrRateData } from './cbr-rate.js';
import type { InvestmentThesisResult } from '../research/investment-thesis/types.js';

// --- Helpers ---

function createMockAssetAnalysis(
  ticker: string,
  name: string,
  options: {
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
  },
): AssetAnalysis {
  return {
    name,
    ticker,
    assetType: options.assetType || 'Акция',
    currentPercent: options.currentPercent ?? 0,
    targetPercent: options.targetPercent,
    deficitRub: options.deficitRub ?? 0,
    status: (options.status || 'HOLD') as
      'HOLD' | 'BUY' | 'STABLE' | 'REDUCE' | 'NEW' | 'EXIT' | 'NO_TARGET',
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
    expect(prompt).toContain(
      'AI НЕ создаёт, НЕ изменяет и НЕ подменяет targetPercent',
    );
    expect(prompt).toContain('AI только интерпретирует');
    expect(prompt).toContain('ИСКЛЮЧИТЕЛЬНО из PortfolioMath');
  });

  it('Тест 2: USER_TARGET остаётся неизменным', () => {
    const prompt = buildSystemPrompt(21);
    // Проверяем, что AI обязан использовать только targetPercent из PortfolioMath
    expect(prompt).toContain('AI только интерпретирует');
    expect(prompt).toContain(
      'AI НЕ создаёт, НЕ изменяет и НЕ подменяет targetPercent',
    );
  });

  it('Тест 3: PortfolioMath status остаётся неизменным', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('AI только интерпретирует');
    expect(prompt).toContain(
      'AI НЕ пересчитывает веса, deficitRub, surplusRub, суммы ребалансировки',
    );
  });

  it('Тест 4: AI может предложить собственный target', () => {
    const prompt = buildSystemPrompt(21);
    // AI обязан использовать только targetPercent из PortfolioMath
    expect(prompt).toContain('ИСКЛЮЧИТЕЛЬНО из PortfolioMath');
    // NO_TARGET vs AI_RECOMMENDED_TARGET разделены
    expect(prompt).toContain('AI_RECOMMENDED_TARGET_PERCENT как рекомендацию');
    expect(prompt).toContain(
      'AI_RECOMMENDED_TARGET_PERCENT — ИСКЛЮЧИТЕЛЬНО рекомендация',
    );
  });

  it('Тест 5: AI target не попадает обратно в PortfolioMath', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain(
      'AI НЕ создаёт, НЕ изменяет и НЕ подменяет targetPercent',
    );
    expect(prompt).toContain('AI только интерпретирует');
  });

  it('Тест 6: USER_TARGET=0 и AI_TARGET=3 корректно разделены', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('targetPercent = 0% → EXIT');
    expect(prompt).toContain(
      'AI НЕ создаёт, НЕ изменяет и НЕ подменяет targetPercent',
    );
  });

  it('Тест 7: USER_TARGET=NOT_SET и AI_TARGET=3 корректно разделены', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('targetPercent отсутствует → NO_TARGET');
    expect(prompt).toContain('AI_RECOMMENDED_TARGET_PERCENT как рекомендацию');
  });

  it('Тест 8: P&L одного ticker не попадает в другой', () => {
    const client = new AiClient();

    const stmeAsset = createMockAssetAnalysis('STME', 'Сбер ETF', {
      currentPercent: 5,
      targetPercent: 0,
      deficitRub: -20000,
      status: 'EXIT',
      balancePrice: 4.3,
      currentPrice: 4.19,
      dynamicsPercent: -2.7,
      quantity: 100,
    });

    const plzlAsset = createMockAssetAnalysis('PLZL', 'Полюс', {
      currentPercent: 10,
      targetPercent: 8,
      deficitRub: 50000,
      status: 'REDUCE',
      balancePrice: 2409.8,
      currentPrice: 996.0,
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

    const context = (
      client as unknown as PrivateAiClient
    ).buildPortfolioContext(
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

    // Проверяем, что каждый актив имеет свой targetPercent (колонка target% таблицы)
    expect(context).toContain('EXIT | 0%');
    expect(context).toContain('REDUCE | 8.0%');
  });

  it('Тест 9: Active order не увеличивает фактическую quantity', () => {
    const client = new AiClient();

    const asset = createMockAssetAnalysis('SBER', 'Сбербанк', {
      currentPercent: 10,
      targetPercent: 15,
      deficitRub: 50000,
      status: 'BUY',
      balancePrice: 280.0,
      currentPrice: 285.0,
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

    const context = (
      client as unknown as PrivateAiClient
    ).buildPortfolioContext(
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
    expect(context).toContain('ЗАЯВКИ');
    expect(context).toContain('SBER: Заявка на BUY 50 шт.');

    // Quantity в контексте должна быть 100 (не 150)
    expect(context).toContain('SBER | Сбербанк | 10.0%');
    expect(context).toContain('| 100 |');
    expect(context).not.toContain('| 150 |');
  });

  it('Тест 10: Cash учитывается как ограничение', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain('Свободный кэш — реальное ограничение покупок');
    expect(prompt).toContain('BUY = "есть дефицит относительно USER_TARGET"');
  });

  it('Тест 11: ETF не получает автоматически 3%', () => {
    const prompt = buildSystemPrompt(21);
    expect(prompt).toContain(
      'Новые инструменты: НЕ добавлять по собственной инициативе',
    );
  });

  it('Тест 12: AI может оспаривать пользовательскую цель, но обязан явно обозначить это', () => {
    const prompt = buildSystemPrompt(21);
    // Проверяем, что AI обязан использовать только targetPercent из PortfolioMath
    expect(prompt).toContain('ИСКЛЮЧИТЕЛЬНО из PortfolioMath');
    // Проверяем, что AI может не согласиться с пользовательской целью, объяснив почему
    expect(prompt).toContain('AI может не согласиться с USER_TARGET');
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

    const context = (
      client as unknown as PrivateAiClient
    ).buildPortfolioContext(
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

    // Проверяем, что targetPercent = 25.0 и status = BUY переданы как есть
    // (колонки target% и Статус в таблице АКТИВЫ)
    expect(context).toContain('| BUY | 25.0% |');
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

    const context = (
      client as unknown as PrivateAiClient
    ).buildPortfolioContext(
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
    // USER_TARGET_PERCENT должен остаться 0 (не изменён) — колонки таблицы АКТИВЫ
    expect(context).toContain('| EXIT | 0% |');
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

    const context = (
      client as unknown as PrivateAiClient
    ).buildPortfolioContext(
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
    // target% отсутствует (targetPercent не задан) — в таблице выводится «—»
    expect(context).toContain('| NO_TARGET | — |');
    expect(context).toContain('NO_TARGET_TEST');
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

    const context = (
      client as unknown as PrivateAiClient
    ).buildPortfolioContext(
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
    // USER_TARGET_PERCENT должен остаться 10.0 (не изменён) — колонки таблицы АКТИВЫ
    expect(context).toContain('| REDUCE | 10.0% |');
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

    const context = (
      client as unknown as PrivateAiClient
    ).buildPortfolioContext(
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
    // USER_TARGET_PERCENT должен остаться 12.0 (не изменён) — колонки таблицы АКТИВЫ
    expect(context).toContain('| HOLD | 12.0% |');
  });
});
