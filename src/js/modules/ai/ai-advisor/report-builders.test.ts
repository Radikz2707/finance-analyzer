// P2: Тесты для buildFinalConclusion — итоговое заключение (4 элемента)
import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import {
  buildAssetsTablesAndBars,
  buildFinalConclusion,
} from './report-builders.js';

function createAsset(o: Partial<AssetAnalysis>): AssetAnalysis {
  return {
    name: o.ticker ?? 'Актив',
    ticker: 'TEST',
    assetType: 'А',
    currentPercent: 0,
    targetPercent: 10,
    deficitRub: 0,
    status: 'HOLD',
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 0,
    quantity: 1,
    balancePrice: 100,
    currentPrice: 100,
    unrealizedProfitRub: 0,
    priority: 0,
    isConcentrated: false,
    ...o,
  };
}

describe('buildFinalConclusion — итоговое заключение', () => {
  const baseAsset = {
    ticker: 'PLZL',
    name: 'Полюс',
    status: 'REDUCE' as const,
    targetPercent: 7.1,
    currentPercent: 17.7,
    deficitRub: -53000,
    unrealizedProfitRub: -58000,
    balancePrice: 2410,
    currentPrice: 1061,
    holdOnly: false,
    isConcentrated: true,
    quantity: 50,
  };

  // ─── Тест 1: 4 элемента присутствуют ───
  it('должен вернуть все 4 элемента заключения', () => {
    const conclusion = buildFinalConclusion(baseAsset, null);

    expect(conclusion.action).toBe('REDUCE');
    expect(conclusion.reasons).toBeInstanceOf(Array);
    expect(conclusion.reasons.length).toBeGreaterThan(0);
    expect(conclusion.risks).toBeInstanceOf(Array);
    expect(conclusion.risks.length).toBeGreaterThan(0);
    expect(conclusion.executionLimitations).toBeInstanceOf(Array);
  });

  // ─── Тест 2: Причины для REDUCE ───
  it('должен показать причины для REDUCE', () => {
    const conclusion = buildFinalConclusion(baseAsset, null);
    expect(conclusion.reasons.some((r) => r.includes('Профицит'))).toBe(true);
  });

  // ─── Тест 3: Риски для концентрированной позиции ───
  it('должен указать риски для концентрированной позиции', () => {
    const conclusion = buildFinalConclusion(baseAsset, null);
    expect(
      conclusion.risks.some(
        (r) => r.includes('концентрац') || r.includes('Просадк'),
      ),
    ).toBe(true);
  });

  // ─── Тест 4: Согласованность BUY/BUY ───
  it('должен показать согласованность когда Math=AI=BUY', () => {
    const mathAsset = {
      ...baseAsset,
      ticker: 'SBER',
      name: 'Сбербанк',
      status: 'BUY' as const,
      targetPercent: 11.1,
      currentPercent: 9.6,
      deficitRub: 7500,
      unrealizedProfitRub: 4000,
      isConcentrated: false,
    };
    const aiRec = {
      recommendedAction: 'BUY',
      confidence: 0.8,
      rationale: 'Недооценен, сильный фундаментал',
      keyRisks: [],
    };

    const conclusion = buildFinalConclusion(mathAsset, aiRec);
    expect(conclusion.action).toBe('BUY');
    expect(conclusion.reasons.length).toBeGreaterThan(0);
  });

  // ─── Тест 5: Ограничения holdOnly ───
  it('должен добавить ограничение holdOnly', () => {
    const holdAsset = {
      ...baseAsset,
      ticker: 'IRAO',
      name: 'ИнтерРАО',
      status: 'SELL' as const,
      holdOnly: true,
      unrealizedProfitRub: 1000,
      isConcentrated: false,
    };

    const conclusion = buildFinalConclusion(holdAsset, null);
    const hasHoldOnlyLimit = conclusion.executionLimitations.some(
      (l) => l.includes('holdOnly') || l.includes('запрещена'),
    );
    expect(hasHoldOnlyLimit).toBe(true);
  });

  // ─── Тест 6: Отсутствие данных ───
  it('должен указать риск при currentPrice=0', () => {
    const noDataAsset = {
      ...baseAsset,
      ticker: 'TEST',
      name: 'Тест',
      currentPrice: 0,
      unrealizedProfitRub: 0,
      currentPercent: 5,
      targetPercent: 10,
      deficitRub: 1000,
      status: 'BUY',
      isConcentrated: false,
    };

    const conclusion = buildFinalConclusion(noDataAsset, null);
    expect(
      conclusion.risks.some(
        (r) =>
          r.toLowerCase().includes('отсутствует') ||
          r.toLowerCase().includes('нет'),
      ),
    ).toBe(true);
  });

  // ─── Тест 7: AI рекомендация с null confidence ───
  it('должен корректно обработать AI с confidence=null', () => {
    const mathAsset = {
      ...baseAsset,
      ticker: 'TATN',
      name: 'Татнефть',
      status: 'STABLE' as const,
      targetPercent: 8.1,
      currentPercent: 8.0,
      deficitRub: 0,
      unrealizedProfitRub: -1000,
      isConcentrated: false,
    };
    const aiRec = {
      recommendedAction: 'HOLD',
      confidence: null,
      rationale: 'Стабильная позиция',
      keyRisks: [],
    };

    const conclusion = buildFinalConclusion(mathAsset, aiRec);
    expect(conclusion.action).toBe('STABLE');
  });

  // ========================================================================
  // ИСПРАВЛЕНИЯ ЭТАПА 2: Консистентность действий
  // ========================================================================

  describe('Консистентность действий', () => {
    it('IRAO: Math=BUY → action=BUY', () => {
      const mathAsset = {
        ...baseAsset,
        ticker: 'IRAO',
        name: 'ИнтерРАО',
        status: 'BUY' as const,
        targetPercent: 9.1,
        currentPercent: 8.3,
        deficitRub: 48000,
        unrealizedProfitRub: 2000,
        isConcentrated: false,
      };
      const conclusion = buildFinalConclusion(mathAsset, null);
      expect(conclusion.action).toBe('BUY');
    });

    it('TATN: Math=BUY → action=BUY', () => {
      const mathAsset = {
        ...baseAsset,
        ticker: 'TATN',
        name: 'Татнефть',
        status: 'BUY' as const,
        targetPercent: 8.0,
        currentPercent: 7.2,
        deficitRub: 40000,
        unrealizedProfitRub: -5000,
        isConcentrated: false,
      };
      const conclusion = buildFinalConclusion(mathAsset, null);
      expect(conclusion.action).toBe('BUY');
    });

    it('PLZL: Math=REDUCE → action=REDUCE', () => {
      const mathAsset = {
        ...baseAsset,
        ticker: 'PLZL',
        name: 'Полюс',
        status: 'REDUCE' as const,
        targetPercent: 7.1,
        currentPercent: 17.7,
        deficitRub: -53000,
        unrealizedProfitRub: -58000,
        isConcentrated: true,
      };
      const conclusion = buildFinalConclusion(mathAsset, null);
      expect(conclusion.action).toBe('REDUCE');
    });

    it('PLZL: Math=REDUCE, AI=BUY → action=REDUCE (математика приоритет)', () => {
      const mathAsset = {
        ...baseAsset,
        ticker: 'PLZL',
        name: 'Полюс',
        status: 'REDUCE' as const,
        targetPercent: 7.1,
        currentPercent: 17.7,
        deficitRub: -53000,
        unrealizedProfitRub: -58000,
        isConcentrated: true,
      };
      const aiRec = {
        recommendedAction: 'BUY',
        confidence: 0.6,
        rationale: 'Долгосрочный потенциал',
        keyRisks: ['Низкая цена'],
      };
      const conclusion = buildFinalConclusion(mathAsset, aiRec);
      expect(conclusion.action).toBe('REDUCE');
    });

    it('SBER: Math=BUY, AI=BUY → action=BUY', () => {
      const mathAsset = {
        ...baseAsset,
        ticker: 'SBER',
        name: 'Сбербанк',
        status: 'BUY' as const,
        targetPercent: 11.1,
        currentPercent: 9.6,
        deficitRub: 7500,
        unrealizedProfitRub: 4000,
        isConcentrated: false,
      };
      const aiRec = {
        recommendedAction: 'BUY',
        confidence: 0.8,
        rationale: 'Недооценен',
        keyRisks: [],
      };
      const conclusion = buildFinalConclusion(mathAsset, aiRec);
      expect(conclusion.action).toBe('BUY');
    });

    it('validation warning и итоговая карточка должны быть консистентны', () => {
      const mathAsset = {
        ...baseAsset,
        ticker: 'IRAO',
        name: 'ИнтерРАО',
        status: 'BUY' as const,
        targetPercent: 9.1,
        currentPercent: 8.3,
        deficitRub: 48000,
        unrealizedProfitRub: 2000,
        holdOnly: true,
        isConcentrated: false,
      };
      const aiRec = {
        recommendedAction: 'BUY',
        confidence: 0.7,
        rationale: 'Покупать',
        keyRisks: [],
      };
      const conclusion = buildFinalConclusion(mathAsset, aiRec);
      expect(
        conclusion.executionLimitations.some(
          (l) => l.includes('запрещена') || l.includes('holdOnly'),
        ),
      ).toBe(true);
    });
  });

  describe('Статистика рекомендаций — корректный подсчёт', () => {
    interface StrategistDecision {
      ticker: string;
      finalAction: string;
    }

    function countRecommendations(decisions: StrategistDecision[]) {
      const buyCount = decisions.filter((d) => d.finalAction === 'BUY').length;
      const sellCount = decisions.filter(
        (d) =>
          d.finalAction === 'SELL' ||
          d.finalAction === 'REDUCE' ||
          d.finalAction === 'EXIT',
      ).length;
      const holdCount = decisions.filter(
        (d) => d.finalAction === 'HOLD' || d.finalAction === 'STABLE',
      ).length;
      return { buyCount, sellCount, holdCount, total: decisions.length };
    }

    it('не должен считать REDUCE и как покупку, и как продажу', () => {
      const decisions: StrategistDecision[] = [
        { ticker: 'SBER', finalAction: 'BUY' },
        { ticker: 'PLZL', finalAction: 'REDUCE' },
        { ticker: 'GAZP', finalAction: 'HOLD' },
      ];
      const counts = countRecommendations(decisions);
      expect(counts.buyCount).toBe(1);
      expect(counts.sellCount).toBe(1); // REDUCE считается как продажа
      expect(counts.holdCount).toBe(1);
      expect(counts.buyCount + counts.sellCount + counts.holdCount).toBe(3);
    });

    it('STABLE и HOLD — одна категория', () => {
      const decisions: StrategistDecision[] = [
        { ticker: 'SBER', finalAction: 'HOLD' },
        { ticker: 'GAZP', finalAction: 'STABLE' },
        { ticker: 'VTBR', finalAction: 'BUY' },
      ];
      const counts = countRecommendations(decisions);
      expect(counts.holdCount).toBe(2); // HOLD + STABLE
      expect(counts.buyCount).toBe(1);
    });

    it('14 активов: 2 покупки, 1 продажа, 11 удержаний', () => {
      const decisions: StrategistDecision[] = [
        { ticker: 'SBER', finalAction: 'BUY' },
        { ticker: 'TATN', finalAction: 'BUY' },
        { ticker: 'PLZL', finalAction: 'REDUCE' },
        ...Array.from({ length: 11 }, (_, i) => ({
          ticker: `ASSET${i}`,
          finalAction: 'STABLE',
        })),
      ];
      const counts = countRecommendations(decisions);
      expect(counts.total).toBe(14);
      expect(counts.buyCount).toBe(2);
      expect(counts.sellCount).toBe(1);
      expect(counts.holdCount).toBe(11);
    });

    describe('buildAssetsTablesAndBars — знаки и итог ребалансировки', () => {
      it('показывает профицит положительным, дефицит отрицательным', () => {
        const result = buildAssetsTablesAndBars([
          createAsset({
            ticker: 'PLZL',
            name: 'Полюс',
            status: 'REDUCE',
            currentPercent: 19.8,
            targetPercent: 10,
            deficitRub: -59_805,
          }),
          createAsset({
            ticker: 'IRAO',
            name: 'Ирао',
            status: 'BUY',
            currentPercent: 5.6,
            targetPercent: 15,
            deficitRub: 57_467,
          }),
        ]);

        // PLZL: профицит → плюс и зелёный
        expect(result.tableRows).toContain('+59');
        expect(result.tableRows).toContain('#56d364');
        // IRAO: дефицит → минус и красный
        expect(result.tableRows).toContain('-57');
        expect(result.tableRows).toContain('#ff7b72');
      });

      it('включает NEW-ОФЗ в итог и считает 3 позиции', () => {
        const result = buildAssetsTablesAndBars([
          createAsset({
            ticker: 'IRAO',
            name: 'Ирао',
            status: 'BUY',
            currentPercent: 5.6,
            targetPercent: 15,
            deficitRub: 57_467,
          }),
          createAsset({
            ticker: 'TATN',
            name: 'Татнефть',
            status: 'BUY',
            currentPercent: 2.9,
            targetPercent: 10,
            deficitRub: 43_562,
          }),
          createAsset({
            ticker: 'SU26238RMFS4',
            name: 'ОФЗ 26238',
            assetType: 'О',
            status: 'NEW',
            currentPercent: 9.5,
            targetPercent: 10,
            deficitRub: 5_168,
          }),
        ]);

        expect(result.rebalanceBlock).toContain('106');
        expect(result.rebalanceBlock).toContain('3 позиции');
        expect(result.rebalanceBlock).not.toContain('2 позиций');
      });
    });
  });
});
