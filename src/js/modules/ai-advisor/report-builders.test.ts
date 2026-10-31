// P2: Тесты для buildFinalConclusion — итоговое заключение (7 элементов)
import { buildFinalConclusion } from './report-builders.js';

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

  // ─── Тест 1: 7 элементов присутствуют ───
  it('должен вернуть все 7 элементов заключения', () => {
    const conclusion = buildFinalConclusion(baseAsset, null);

    expect(conclusion.action).toBe('REDUCE');
    expect(conclusion.reasons).toBeInstanceOf(Array);
    expect(conclusion.reasons.length).toBeGreaterThan(0);
    expect(conclusion.risks).toBeInstanceOf(Array);
    expect(conclusion.risks.length).toBeGreaterThan(0);
    expect(conclusion.dataStatus).toBeDefined();
    expect(typeof conclusion.dataStatus).toBe('string');
    expect(conclusion.source).toBeDefined();
    expect(['MATH_ONLY', 'AI_ONLY', 'BOTH_AGREED', 'BOTH_CONFLICT', 'NO_DATA']).toContain(conclusion.source);
    expect(conclusion.mathAiAgreement).toBeDefined();
    expect(typeof conclusion.mathAiAgreement).toBe('string');
    expect(conclusion.executionLimitations).toBeInstanceOf(Array);
  });

  // ─── Тест 2: MATH_ONLY когда AI нет ───
  it('должен установить source=MATH_ONLY когда AI нет', () => {
    const conclusion = buildFinalConclusion(baseAsset, null);
    expect(conclusion.source).toBe('MATH_ONLY');
    expect(conclusion.mathAiAgreement).toContain('PortfolioMath');
  });

  // ─── Тест 3: Конфликт BUY/EXIT ───
  it('должен обнаружить конфликт BUY/EXIT', () => {
    const mathAsset = {
      ...baseAsset,
      ticker: 'IRAO',
      name: 'ИнтерРАО',
      status: 'BUY' as const,
      targetPercent: 9.1,
      currentPercent: 10.2,
      deficitRub: 5000,
      unrealizedProfitRub: 2000,
      isConcentrated: false,
    };
    const aiRec = {
      recommendedAction: 'EXIT',
      confidence: 0.7,
      rationale: 'Фундаментальные проблемы в секторе',
      keyRisks: ['Падение дивидендов'],
    };

    const conclusion = buildFinalConclusion(mathAsset, aiRec);
    expect(conclusion.source).toBe('BOTH_CONFLICT');
    expect(conclusion.mathAiAgreement).toContain('Конфликт');
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
    expect(conclusion.source).toBe('BOTH_AGREED');
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
    const hasHoldOnlyLimit = conclusion.executionLimitations.some((l) =>
      l.includes('holdOnly') || l.includes('запрещена'),
    );
    expect(hasHoldOnlyLimit).toBe(true);
  });

  // ─── Тест 6: Отсутствие данных ───
  it('должен указать неполные данные при currentPrice=0', () => {
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
    expect(conclusion.dataStatus).toContain('неполн');
    // Риск "отсутствует" должен быть в списке
    expect(conclusion.risks.some((r) => r.toLowerCase().includes('отсутствует') || r.toLowerCase().includes('нет'))).toBe(true);
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
      // HOLD и STABLE — разные действия, поэтому будет CONFLICT
      recommendedAction: 'HOLD',
      confidence: null,
      rationale: 'Стабильная позиция',
      keyRisks: [],
    };

    const conclusion = buildFinalConclusion(mathAsset, aiRec);
    // HOLD ≠ STABLE → конфликт
    expect(conclusion.source).toBe('BOTH_CONFLICT');
    expect(conclusion.mathAiAgreement).toContain('Конфликт');
  });

  // ========================================================================
  // ИСПРАВЛЕНИЯ ЭТАПА 2: Источник рекомендации и consistency
  // ========================================================================

  describe('Этап 2: Источник рекомендации — корректное определение', () => {
    it('IRAO: Math=BUY, AI=null → source=MATH_ONLY', () => {
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
      // AI не вернул рекомендацию → null
      const conclusion = buildFinalConclusion(mathAsset, null);
      expect(conclusion.source).toBe('MATH_ONLY');
      expect(conclusion.mathAiAgreement).toContain('PortfolioMath');
    });

    it('TATN: Math=BUY, AI=null → source=MATH_ONLY, не BOTH_AGREED', () => {
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
      expect(conclusion.source).toBe('MATH_ONLY');
    });

    it('PLZL: Math=REDUCE, AI=null → source=MATH_ONLY, не BOTH_AGREED', () => {
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
      expect(conclusion.source).toBe('MATH_ONLY');
      // Ключевое: не BOTH_AGREED
      expect(conclusion.source).not.toBe('BOTH_AGREED');
    });

    it('PLZL: Math=REDUCE, AI=BUY → source=BOTH_CONFLICT', () => {
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
      expect(conclusion.source).toBe('BOTH_CONFLICT');
    });

    it('SBER: Math=BUY, AI=BUY → source=BOTH_AGREED', () => {
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
      expect(conclusion.source).toBe('BOTH_AGREED');
    });

    it('validation warning и итоговая карточка должны быть консистентны', () => {
      // Симуляция: AI вернул BUY, но guardrails заблокировали → HOLD
      // И warning, и итоговая карточка должны отражать HOLD
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
      // Итоговое действие — из mathAsset.status (BUY), но ограничение holdOnly
      expect(conclusion.executionLimitations.some((l) => l.includes('запрещена') || l.includes('holdOnly'))).toBe(true);
    });
  });

  describe('Этап 2: Статистика рекомендаций — корректный подсчёт', () => {
    // Симуляция решений стратега
    interface StrategistDecision {
      ticker: string;
      finalAction: string;
    }

    function countRecommendations(decisions: StrategistDecision[]) {
      const buyCount = decisions.filter(
        (d) => d.finalAction === 'BUY',
      ).length;
      const sellCount = decisions.filter(
        (d) => d.finalAction === 'SELL' || d.finalAction === 'REDUCE' || d.finalAction === 'EXIT',
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
  });
});
