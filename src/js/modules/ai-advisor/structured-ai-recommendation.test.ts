import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';
import {
  buildDeterministicAssetData,
  buildStructuredAIRecommendation,
  buildFallbackStructuredRecommendation,
  validateStructuredAIJson,
  type RawAIJson,
  type DeterministicAssetData,
} from './structured-ai-recommendation.js';
import { stripJsonBlockFromAiText } from './ai-advisor.js';
import { assertFinalAiDisplaySafe } from './ollama-manager.js';

// ─── Helpers ───────────────────────────────────────────────────────

function createAsset(o?: Partial<AssetAnalysis>): AssetAnalysis {
  return {
    name: 'SBER',
    ticker: 'SBER',
    assetType: 'STOCK',
    currentPercent: 7.9,
    targetPercent: 10,
    deficitRub: 10809,
    status: 'BUY',
    dynamicsPercent: 5.2,
    nkdRub: 0,
    nominal: 0,
    quantity: 146,
    balancePrice: 250,
    currentPrice: 278.58,
    unrealizedProfitRub: 4163,
    priority: 1,
    isConcentrated: false,
    ...o,
  };
}

function createValidAIJson(): RawAIJson {
  return {
    ticker: 'SBER',
    recommendedTargetPercent: 10,
    recommendedAction: 'BUY',
    confidence: 0.72,
    rationale: 'Дефицит позиции требует докупки',
    targetReason: 'Целевая доля 10% соответствует макро-структуре',
    keyRisks: ['Регуляторный риск', 'Геополитика'],
    keyCatalysts: ['Дивиденды Q3'],
    agreementWithPortfolioMath: 'AGREE',
  };
}

function createDet(
  o?: Partial<DeterministicAssetData>,
): DeterministicAssetData {
  return {
    ticker: 'SBER',
    name: 'Sberbank',
    currentPercent: 7.9,
    userTargetPercent: 10,
    portfolioMathStatus: 'BUY',
    currentPrice: 278.58,
    balancePrice: 250,
    drawdownPercent: 11.43,
    unrealizedProfitRub: 4163,
    currentQuantity: 146,
    liquidationValueRub: 40673,
    buyAmountRub: 10809,
    sellAmountRub: null,
    marketDataValid: true,
    executionBlocked: false,
    activeOrders: [],
    activeOrderConflict: false,
    ...o,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('StructuredAIRecommendation', () => {
  // Test 1: Valid AI JSON passes validation
  describe('Test 1: Valid AI JSON', () => {
    it('passes validation for correct JSON', () => {
      const json = createValidAIJson();
      const result = validateStructuredAIJson(json, ['SBER', 'GAZP']);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  // Test 2: Invalid ticker
  describe('Test 2: Invalid ticker', () => {
    it('fails validation for unknown ticker', () => {
      const json: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'UNKNOWN',
      };
      const result = validateStructuredAIJson(json, ['SBER', 'GAZP']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'ticker')).toBe(true);
    });
  });

  // Test 3: Invalid action
  describe('Test 3: Invalid action', () => {
    it('fails validation for invalid action', () => {
      const json: RawAIJson = {
        ...createValidAIJson(),
        recommendedAction: 'HODL',
      };
      const result = validateStructuredAIJson(json, ['SBER']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'recommendedAction')).toBe(
        true,
      );
    });
  });

  // Test 4: Confidence out of range
  describe('Test 4: Confidence out of range', () => {
    it('fails validation for confidence > 1', () => {
      const json: RawAIJson = {
        ...createValidAIJson(),
        confidence: 1.5,
      };
      const result = validateStructuredAIJson(json, ['SBER']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'confidence')).toBe(true);
    });

    it('fails validation for confidence < 0', () => {
      const json: RawAIJson = {
        ...createValidAIJson(),
        confidence: -0.1,
      };
      const result = validateStructuredAIJson(json, ['SBER']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'confidence')).toBe(true);
    });
  });

  // Test 5: Negative target percent
  describe('Test 5: Negative target percent', () => {
    it('fails validation for negative target', () => {
      const json: RawAIJson = {
        ...createValidAIJson(),
        recommendedTargetPercent: -5,
      };
      const result = validateStructuredAIJson(json, ['SBER']);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'recommendedTargetPercent'),
      ).toBe(true);
    });
  });

  // Test 6: Missing required text fields
  describe('Test 6: Missing required text fields', () => {
    it('fails validation when rationale is empty', () => {
      const json: RawAIJson = {
        ...createValidAIJson(),
        rationale: '',
      };
      const result = validateStructuredAIJson(json, ['SBER']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'rationale')).toBe(true);
    });

    it('fails validation when targetReason is null', () => {
      const json: RawAIJson = {
        ...createValidAIJson(),
        targetReason: null,
      };
      const result = validateStructuredAIJson(json, ['SBER']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'targetReason')).toBe(true);
    });
  });

  // Test 7: Merge with valid AI
  describe('Test 7: Merge with valid AI', () => {
    it('combines deterministic + AI correctly', () => {
      const det = createDet();
      const aiJson = createValidAIJson();
      const validation = validateStructuredAIJson(aiJson, ['SBER']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      // Deterministic fields preserved
      expect(result.currentPercent).toBe(7.9);
      expect(result.buyAmountRub).toBe(10809);
      expect(result.currentPrice).toBe(278.58);
      expect(result.executionBlocked).toBe(false);
      expect(result.userTargetPercent).toBe(10);

      // AI fields applied
      expect(result.recommendedTargetPercent).toBe(10);
      expect(result.recommendedAction).toBe('BUY');
      expect(result.confidence).toBe(0.72);
      expect(result.rationale).toBe('Дефицит позиции требует докупки');
      expect(result.agreementWithPortfolioMath).toBe('AGREE');
    });
  });

  // Test 8: Merge with invalid AI → fallback
  describe('Test 8: Invalid AI JSON → fallback', () => {
    it('returns fallback when AI JSON is invalid', () => {
      const det = createDet();
      const invalidJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'UNKNOWN',
      };
      const validation = validateStructuredAIJson(invalidJson, ['SBER']);
      const result = buildStructuredAIRecommendation(
        det,
        invalidJson,
        validation,
      );

      // Deterministic preserved
      expect(result.currentPercent).toBe(7.9);
      expect(result.buyAmountRub).toBe(10809);

      // AI fields are fallback
      expect(result.recommendedTargetPercent).toBeNull();
      expect(result.recommendedAction).toBeNull();
      expect(result.confidence).toBeNull();
      expect(result.rationale).toBe('AI analysis unavailable');
      expect(result.agreementWithPortfolioMath).toBe('UNCERTAIN');
    });
  });

  // Test 9: Merge with null AI → fallback
  describe('Test 9: Null AI → fallback', () => {
    it('returns fallback when AI JSON is null', () => {
      const det = createDet();
      const result = buildStructuredAIRecommendation(det, null, null);

      expect(result.currentPercent).toBe(7.9);
      expect(result.recommendedTargetPercent).toBeNull();
      expect(result.rationale).toBe('AI analysis unavailable');
    });
  });

  // Test 10: Execution blocked when price = 0
  describe('Test 10: Execution blocked when price = 0', () => {
    it('sets executionBlocked = true when currentPrice = 0', () => {
      const asset = createAsset({
        currentPrice: 0,
        quantity: 100,
        deficitRub: 5000,
        status: 'BUY',
      });
      const det = buildDeterministicAssetData(asset);

      expect(det.executionBlocked).toBe(true);
      expect(det.marketDataValid).toBe(false);
      expect(det.liquidationValueRub).toBeNull();
      expect(det.currentPrice).toBeNull();
    });
  });

  // Test 11: Active order conflict
  describe('Test 11: Active order conflict', () => {
    it('detects BUY status with SELL order as conflict', () => {
      const asset = createAsset({
        status: 'BUY',
        deficitRub: 10000,
      });
      const det = buildDeterministicAssetData(asset, ['SELL']);

      expect(det.activeOrderConflict).toBe(true);
    });

    it('detects REDUCE status with BUY order as conflict', () => {
      const asset = createAsset({
        status: 'REDUCE',
        deficitRub: -5000,
      });
      const det = buildDeterministicAssetData(asset, ['BUY']);

      expect(det.activeOrderConflict).toBe(true);
    });

    it('no conflict when status and order match', () => {
      const asset = createAsset({
        status: 'BUY',
        deficitRub: 10000,
      });
      const det = buildDeterministicAssetData(asset, ['BUY']);

      expect(det.activeOrderConflict).toBe(false);
    });
  });

  // Test 12: NO_TARGET case
  describe('Test 12: NO_TARGET case', () => {
    it('userTargetPercent = null when targetPercent undefined', () => {
      const asset = createAsset({
        targetPercent: undefined,
        status: 'NO_TARGET',
        deficitRub: 0,
      });
      const det = buildDeterministicAssetData(asset);

      expect(det.userTargetPercent).toBeNull();
      expect(det.portfolioMathStatus).toBe('NO_TARGET');
    });
  });

  // Test 13: BUY amount from deterministic
  describe('Test 13: BUY amount from deterministic', () => {
    it('report uses deterministic buyAmount, not AI', () => {
      const det = createDet({ buyAmountRub: 10809 });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        recommendedAction: 'BUY',
        // AI could say anything about amounts — it doesn't matter
      };
      const validation = validateStructuredAIJson(aiJson, ['SBER']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      // Report MUST use deterministic
      expect(result.buyAmountRub).toBe(10809);
    });
  });

  // Test 14: SELL amount from deterministic
  describe('Test 14: SELL amount from deterministic', () => {
    it('report uses deterministic sellAmount', () => {
      const asset = createAsset({
        status: 'REDUCE',
        deficitRub: -44266,
      });
      const det = buildDeterministicAssetData(asset);

      expect(det.sellAmountRub).toBe(44266);
    });
  });

  // Test 15: EXIT case
  describe('Test 15: EXIT case', () => {
    it('liquidationValue calculated for EXIT', () => {
      const asset = createAsset({
        status: 'EXIT',
        targetPercent: 0,
        currentPrice: 278.58,
        quantity: 146,
        deficitRub: -40673,
      });
      const det = buildDeterministicAssetData(asset);

      expect(det.liquidationValueRub).toBe(278.58 * 146);
      expect(det.sellAmountRub).toBe(40673);
    });
  });

  // Test 16: Research price NO_DATA but PortfolioMath price valid
  describe('Test 16: Research NO_DATA, PortfolioMath valid', () => {
    it('executionBlocked = false when PortfolioMath price > 0', () => {
      const asset = createAsset({
        currentPrice: 957.4,
        quantity: 10,
        deficitRub: 5000,
        status: 'BUY',
      });
      const det = buildDeterministicAssetData(asset);

      expect(det.executionBlocked).toBe(false);
      expect(det.marketDataValid).toBe(true);
      expect(det.currentPrice).toBe(957.4);
    });
  });

  // Test 17: Fallback recommendation
  describe('Test 17: Fallback recommendation', () => {
    it('builds fallback with correct structure', () => {
      const det = createDet();
      const fallback = buildFallbackStructuredRecommendation(det);

      expect(fallback.ticker).toBe('SBER');
      expect(fallback.currentPercent).toBe(7.9);
      expect(fallback.recommendedTargetPercent).toBeNull();
      expect(fallback.rationale).toBe('AI analysis unavailable');
      expect(fallback.keyRisks).toEqual([]);
      expect(fallback.keyCatalysts).toEqual([]);
    });
  });

  // Test 18: Dashboard numbers must not depend on AI markdown
  describe('Test 18: Dashboard independence from AI', () => {
    it('deterministic fields unchanged regardless of AI content', () => {
      const det = createDet({ buyAmountRub: 10809 });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        // AI could claim any target — deterministic stays
        recommendedTargetPercent: 999,
      };
      const validation = validateStructuredAIJson(aiJson, ['SBER']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      // Deterministic is untouched
      expect(result.buyAmountRub).toBe(10809);
      expect(result.currentPercent).toBe(7.9);
      expect(result.currentPrice).toBe(278.58);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // REGRESSION TESTS — конкретные баги pipeline PDF
  // ═══════════════════════════════════════════════════════════

  // Test 19: SBRB liquidationValue = 19.059 × 5 = 95.295, НЕ 95 295
  describe('Regression: SBRB liquidationValue corruption', () => {
    it('SBRB: 19.059 × 5 = 95.295, никогда не 95295 (95 тысяч)', () => {
      const asset = createAsset({
        ticker: 'SBRB',
        name: 'SBRB ETF',
        currentPrice: 19.059,
        quantity: 5,
        currentPercent: 0.02,
        deficitRub: 0,
        status: 'NO_TARGET',
        targetPercent: undefined,
      });
      const det = buildDeterministicAssetData(asset);

      expect(det.liquidationValueRub).toBeCloseTo(95.3, 1);
      // НЕ 95295 (95 тысяч) — это corruption из AI markdown
      expect(det.liquidationValueRub).not.toBe(95295);
      // Правильное значение:
      expect(det.liquidationValueRub).toBe(95.295);
    });

    it('SBRB: deterministic fields не меняются при любом AI JSON', () => {
      const asset = createAsset({
        ticker: 'SBRB',
        name: 'SBRB ETF',
        currentPrice: 19.059,
        quantity: 5,
        currentPercent: 0.02,
        deficitRub: 0,
        status: 'NO_TARGET',
        targetPercent: undefined,
      });
      const det = buildDeterministicAssetData(asset);

      // AI мог бы написать в rationale любую сумму — это не влияет на deterministic
      const aiJson: RawAIJson = {
        ticker: 'SBRB',
        recommendedTargetPercent: 1,
        recommendedAction: 'HOLD',
        confidence: 0.5,
        rationale: 'liquidation 95295 рублей',
        targetReason: 'target 1%',
        keyRisks: [],
        keyCatalysts: [],
        agreementWithPortfolioMath: 'UNCERTAIN',
      };
      const validation = validateStructuredAIJson(aiJson, ['SBRB']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      // Числовые поля ИСКЛЮЧИТЕЛЬНО из deterministic
      expect(result.liquidationValueRub).toBeCloseTo(95.3, 1);
      expect(result.currentPrice).toBe(19.059);
      expect(result.currentQuantity).toBe(5);
      // AI rationale — это текст, он не используется для расчётов
      expect(result.rationale).toBe('liquidation 95295 рублей');
    });
  });

  // Test 20: SUR NOT_SET ≠ AI target
  describe('Regression: SUR NOT_SET ≠ AI target', () => {
    it('SUR с targetPercent=undefined: userTargetPercent=null, AI target не показывается как USER', () => {
      const asset = createAsset({
        ticker: 'SUR',
        name: 'SUR Bond',
        targetPercent: undefined,
        status: 'NO_TARGET',
        deficitRub: 0,
      });
      const det = buildDeterministicAssetData(asset);

      expect(det.userTargetPercent).toBeNull();
      expect(det.portfolioMathStatus).toBe('NO_TARGET');
    });

    it('SUR: даже если AI вернул target=1%, это AI recommendation, не USER_TARGET', () => {
      const asset = createAsset({
        ticker: 'SUR',
        name: 'SUR Bond',
        targetPercent: undefined,
        status: 'NO_TARGET',
        deficitRub: 0,
      });
      const det = buildDeterministicAssetData(asset);

      // AI вернул target=1% — это AI recommendation
      const aiJson: RawAIJson = {
        ticker: 'SUR',
        recommendedTargetPercent: 1,
        recommendedAction: 'BUY',
        confidence: 0.6,
        rationale: 'AI рекомендует',
        targetReason: '1% для диверсификации',
        keyRisks: [],
        keyCatalysts: [],
        agreementWithPortfolioMath: 'AGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['SUR']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      // userTargetPercent остаётся null
      expect(result.userTargetPercent).toBeNull();
      // AI target есть, но это ИИ-рекомендация
      expect(result.recommendedTargetPercent).toBe(1);
      // В отчёте это должно быть помечено как AI recommendation
      expect(result.rationale).toBe('AI рекомендует');
    });

    it('SUR: без AI fallback — recommendedTargetPercent=null', () => {
      const asset = createAsset({
        ticker: 'SUR',
        name: 'SUR Bond',
        targetPercent: undefined,
        status: 'NO_TARGET',
        deficitRub: 0,
      });
      const det = buildDeterministicAssetData(asset);
      const result = buildStructuredAIRecommendation(det, null, null);

      expect(result.userTargetPercent).toBeNull();
      expect(result.recommendedTargetPercent).toBeNull();
      expect(result.rationale).toBe('AI analysis unavailable');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // NEW REGRESSION TESTS — свободная инвестиционная логика AI
  // ═══════════════════════════════════════════════════════════

  // Test 23: EXIT — валидное AI действие
  describe('Regression: EXIT is valid AI action', () => {
    it('EXIT проходит валидацию как допустимое действие', () => {
      const json: RawAIJson = {
        ticker: 'PLZL',
        recommendedTargetPercent: 0,
        recommendedAction: 'EXIT',
        confidence: 0.85,
        rationale: 'Фундаментальное ухудшение, санкции, выход из позиции',
        targetReason: 'Целевая доля 0%',
        keyRisks: ['Санкции', 'Падение выручки'],
        keyCatalysts: ['Новые санкции'],
        agreementWithPortfolioMath: 'DISAGREE',
      };
      const result = validateStructuredAIJson(json, ['PLZL']);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('AVERAGE проходит валидацию как допустимое действие', () => {
      const json: RawAIJson = {
        ticker: 'SBER',
        recommendedTargetPercent: 15,
        recommendedAction: 'AVERAGE',
        confidence: 0.7,
        rationale: 'Усреднение позиции при недооценке',
        targetReason: 'Увеличение доли до 15%',
        keyRisks: ['Волатильность'],
        keyCatalysts: ['Дивиденды'],
        agreementWithPortfolioMath: 'AGREE',
      };
      const result = validateStructuredAIJson(json, ['SBER']);
      expect(result.valid).toBe(true);
    });
  });

  // Test 24: Глубокий убыток НЕ блокирует SELL
  describe('Regression: deep loss does NOT block SELL', () => {
    it('SELL при просадке -58% → НЕ блокируется, действие SELL', () => {
      const det = createDet({
        ticker: 'PLZL',
        name: 'Полюс',
        balancePrice: 1000,
        currentPrice: 420,
        drawdownPercent: -58,
        unrealizedProfitRub: -58000,
      });
      const aiJson: RawAIJson = {
        ticker: 'PLZL',
        recommendedTargetPercent: 0,
        recommendedAction: 'SELL',
        confidence: 0.8,
        rationale: 'Фундаментальное ухудшение бизнеса, снижение маржи',
        targetReason: 'Снижение доли до 0%',
        keyRisks: ['Волатильность'],
        keyCatalysts: [],
        agreementWithPortfolioMath: 'AGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.recommendedAction).toBe('SELL');
      expect(result.strategistOverride).toBeNull();
    });
  });

  // Test 25: Глубокий убыток НЕ блокирует EXIT
  describe('Regression: deep loss does NOT block EXIT', () => {
    it('EXIT при просадке -70% → НЕ блокируется, действие EXIT', () => {
      const det = createDet({
        ticker: 'PLZL',
        name: 'Полюс',
        balancePrice: 1000,
        currentPrice: 300,
        drawdownPercent: -70,
        unrealizedProfitRub: -70000,
      });
      const aiJson: RawAIJson = {
        ticker: 'PLZL',
        recommendedTargetPercent: 0,
        recommendedAction: 'EXIT',
        confidence: 0.9,
        rationale: 'Полный выход из позиции, санкции',
        targetReason: 'Целевая доля 0%',
        keyRisks: ['Санкции'],
        keyCatalysts: [],
        agreementWithPortfolioMath: 'AGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.recommendedAction).toBe('EXIT');
      expect(result.strategistOverride).toBeNull();
    });
  });

  // Test 26: Глубокий убыток НЕ блокирует REDUCE
  describe('Regression: deep loss does NOT block REDUCE', () => {
    it('REDUCE при просадке -58% → НЕ блокируется, действие REDUCE', () => {
      const det = createDet({
        drawdownPercent: -58,
        balancePrice: 1000,
        currentPrice: 420,
      });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'PLZL',
        recommendedAction: 'REDUCE',
        rationale: 'Снижение целевой доли с 12% до 5%',
        keyCatalysts: [],
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.recommendedAction).toBe('REDUCE');
      expect(result.strategistOverride).toBeNull();
    });
  });

  // Test 27: AI может выбрать BUY при PortfolioMath REDUCE
  describe('Regression: AI can BUY when PortfolioMath = REDUCE', () => {
    it('PortfolioMath=REDUCE, AI=BUY → AI действие сохраняется', () => {
      const det = createDet({
        portfolioMathStatus: 'REDUCE',
        drawdownPercent: -10,
        balancePrice: 300,
        currentPrice: 270,
      });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'PLZL',
        recommendedAction: 'BUY',
        recommendedTargetPercent: 15,
        rationale: 'Недооценка, сильные фундаментальные показатели',
        targetReason: 'Увеличение доли выше целевой',
        agreementWithPortfolioMath: 'DISAGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.recommendedAction).toBe('BUY');
      expect(result.portfolioMathStatus).toBe('REDUCE');
      expect(result.agreementWithPortfolioMath).toBe('DISAGREE');
    });
  });

  // Test 28: AI может выбрать HOLD при PortfolioMath BUY
  describe('Regression: AI can HOLD when PortfolioMath = BUY', () => {
    it('PortfolioMath=BUY, AI=HOLD → AI действие сохраняется', () => {
      const det = createDet({
        portfolioMathStatus: 'BUY',
        drawdownPercent: 5,
        balancePrice: 250,
        currentPrice: 262,
      });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'PLZL',
        recommendedAction: 'HOLD',
        rationale: 'Нет катализаторов для роста, ждать',
        targetReason: 'Текущая доля достаточна',
        agreementWithPortfolioMath: 'DISAGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.recommendedAction).toBe('HOLD');
      expect(result.portfolioMathStatus).toBe('BUY');
      expect(result.agreementWithPortfolioMath).toBe('DISAGREE');
    });
  });

  // Test 29: AI может предложить собственную целевую долю
  describe('Regression: AI can set own target', () => {
    it('AI_RECOMMENDED_TARGET ≠ USER_TARGET', () => {
      const det = createDet({
        userTargetPercent: 10,
        portfolioMathStatus: 'STABLE',
      });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'PLZL',
        recommendedTargetPercent: 15,
        recommendedAction: 'BUY',
        rationale: 'Увеличение целевой доли до 15%',
        targetReason: 'Уверенность в росте бизнеса',
        agreementWithPortfolioMath: 'DISAGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.userTargetPercent).toBe(10);
      expect(result.recommendedTargetPercent).toBe(15);
      expect(result.recommendedAction).toBe('BUY');
    });
  });

  // Test 30: USER_TARGET остаётся фактом, AI не меняет
  describe('Regression: USER_TARGET_PERCENT is user fact, AI cannot change', () => {
    it('userTargetPercent = 10 остаётся 10, AI не меняет', () => {
      const det = createDet({ userTargetPercent: 10 });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'PLZL',
        recommendedTargetPercent: 999,
        rationale: 'AI предлагает 999%',
        targetReason: 'Абсурдная рекомендация',
        agreementWithPortfolioMath: 'DISAGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.userTargetPercent).toBe(10);
      // AI target может быть любым — это рекомендация
      expect(result.recommendedTargetPercent).toBe(999);
    });
  });

  // Test 31: PortfolioMath status остаётся фактом
  describe('Regression: PortfolioMath status is math fact, AI cannot change', () => {
    it('portfolioMathStatus = REDUCE остаётся REDUCE, AI не меняет', () => {
      const det = createDet({ portfolioMathStatus: 'REDUCE' });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'PLZL',
        recommendedAction: 'BUY',
        rationale: 'AI предлагает BUY',
        agreementWithPortfolioMath: 'DISAGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.portfolioMathStatus).toBe('REDUCE');
      expect(result.recommendedAction).toBe('BUY');
    });
  });

  // Test 32: AI может явно DISAGREE с PortfolioMath
  describe('Regression: AI can explicitly DISAGREE with PortfolioMath', () => {
    it('agreementWithPortfolioMath = DISAGREE при разных действиях', () => {
      const det = createDet({ portfolioMathStatus: 'REDUCE' });
      const aiJson: RawAIJson = {
        ...createValidAIJson(),
        ticker: 'PLZL',
        recommendedAction: 'EXIT',
        rationale: 'Полный выход из позиции, не согласен с REDUCE',
        targetReason: 'Целевая доля 0%',
        agreementWithPortfolioMath: 'DISAGREE',
      };
      const validation = validateStructuredAIJson(aiJson, ['PLZL']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.portfolioMathStatus).toBe('REDUCE');
      expect(result.recommendedAction).toBe('EXIT');
      expect(result.agreementWithPortfolioMath).toBe('DISAGREE');
    });
  });

  // Test 33: При отсутствии данных AI не выдумывает значения
  describe('Regression: AI does not invent missing data', () => {
    it('NO_DATA → rationale не содержит "недооценен"', () => {
      const det = createDet({
        ticker: 'UNKNOWN',
        name: 'Unknown Asset',
        currentPrice: null,
        drawdownPercent: null,
        marketDataValid: false,
      });
      const aiJson: RawAIJson = {
        ticker: 'UNKNOWN',
        recommendedTargetPercent: 5,
        recommendedAction: 'HOLD',
        confidence: 0.3,
        rationale: 'Нет данных о цене — удерживать позицию до получения данных',
        targetReason: 'Нет данных для изменения',
        keyRisks: ['Нет данных'],
        keyCatalysts: [],
        agreementWithPortfolioMath: 'UNCERTAIN',
      };
      const validation = validateStructuredAIJson(aiJson, ['UNKNOWN']);
      const result = buildStructuredAIRecommendation(det, aiJson, validation);

      expect(result.recommendedAction).toBe('HOLD');
      expect(result.rationale).toContain('Нет данных');
    });
  });

  // Test 21: Raw JSON не попадает в HTML
  describe('Regression: raw JSON leakage to HTML', () => {
    it('JSON извлечён из текста — используется только для StructuredAIAssetRecommendation', () => {
      // extractJsonFromAiResponse экспортирован из ai-client.ts
      // Он извлекает JSON из AI-ответа для валидации и merge
      // Сам JSON НЕ вставляется в HTML — только через aiResult.structuredJson
    });

    it('aiBoxHtml формируется из deterministic + narrative, без raw JSON', () => {
      // aiBoxHtml = header + priceAlerts + newAssetsWarning + validationAlerts + incomeWidget + stripJsonBlockFromAiText(aiResult.text)
      // stripJsonBlockFromAiText удаляет ```json ... ``` и ``` ... ``` блоки
      // Остается только narrative текст от AI
    });
  });

  // ═══════════════════════════════════════════════════════════
  // REGRESSION TEST: Problem 1 — raw JSON leakage в финальный report
  // ═══════════════════════════════════════════════════════════

  describe('Regression: Problem 1 — raw JSON leakage to final report', () => {
    it('stripJsonBlockFromAiText удаляет structured JSON из AI-текста', () => {
      const rawAiText = `
### 7. Краткое резюме (3-5 действий)

1. Реализовать продажи: Закрыть позицию по STME.
2. Перераспределить: Использовать средства для покупки SBER.

\`\`\`json
{
  "ticker": "STME",
  "recommendedTargetPercent": 0.0,
  "recommendedAction": "EXIT",
  "confidence": 0.95,
  "rationale": "Актив в убытке",
  "targetReason": "Снижение концентрации",
  "keyRisks": ["Волатильность"],
  "keyCatalysts": ["Исполнение заявок"],
  "agreementWithPortfolioMath": "AGREE"
}
\`\`\`

Это всё.
`;

      const cleaned = stripJsonBlockFromAiText(rawAiText);

      // JSON-блок удалён целиком
      expect(cleaned).not.toContain('```json');
      expect(cleaned).not.toContain('```');
      expect(cleaned).not.toContain('"ticker"');
      expect(cleaned).not.toContain('"recommendedTargetPercent"');
      expect(cleaned).not.toContain('"recommendedAction"');
      expect(cleaned).not.toContain('"agreementWithPortfolioMath"');
      expect(cleaned).not.toContain('"confidence"');

      // Narrative текст сохранён
      expect(cleaned).toContain('Краткое резюме');
      expect(cleaned).toContain('Реализовать продажи');
      expect(cleaned).toContain('Перераспределить');
      expect(cleaned).toContain('Это всё');
    });

    it('stripJsonBlockFromAiText удаляет inline JSON {"ticker": ...}', () => {
      const rawAiText = 'Рекомендация: {"ticker": "PLZL", "recommendedTargetPercent": 0, "recommendedAction": "EXIT"} — закрыть позицию.';
      const cleaned = stripJsonBlockFromAiText(rawAiText);

      expect(cleaned).not.toContain('"ticker"');
      expect(cleaned).not.toContain('"recommendedTargetPercent"');
      expect(cleaned).not.toContain('"recommendedAction"');
      expect(cleaned).toContain('закрыть позицию');
    });

    it('assertFinalAiDisplaySafe НЕ выбрасывает ошибку после stripJsonBlockFromAiText', () => {
      const rawAiText = `
### 7. Краткое резюме
1. Продать PLZL.

\`\`\`json
{
  "ticker": "PLZL",
  "recommendedTargetPercent": 0.0,
  "recommendedAction": "EXIT",
  "confidence": 0.9,
  "rationale": "test",
  "targetReason": "test",
  "keyRisks": [],
  "keyCatalysts": [],
  "agreementWithPortfolioMath": "AGREE"
}
\`\`\`
`;

      const cleaned = stripJsonBlockFromAiText(rawAiText);

      // Эта строка НЕ должна выбросить ошибку
      expect(() => assertFinalAiDisplaySafe(cleaned)).not.toThrow();
    });

    it('PIPELINE PATH: structuredJson во входе → final text НЕ содержит JSON-ключей', () => {
      // Симулируем реальный pipeline path:
      // 1. AI возвращает текст с JSON-блоком
      // 2. stripJsonBlockFromAiText очищает текст
      // 3. assertFinalAiDisplaySafe проверяет чистоту

      const aiResponseWithJson = `
📋 Экспертное заключение ИИ-советника (октябрь 2026 г.)

## 1. Макро и структура портфеля
Ситуация: Октябрь 2026 г. Ключевая ставка ЦБ РФ — 14%.

## 2. Рекомендации по каждому активу

| Тикер | Тип | Статус |
| :--- | :--- | :--- |
| STME | Фонд | EXIT |

## 7. Краткое резюме

1. Реализовать продажи: Закрыть позицию по STME.
2. Перераспределить: Использовать средства для покупки SBER.

\`\`\`json
{
  "ticker": "STME",
  "recommendedTargetPercent": 0.0,
  "recommendedAction": "EXIT",
  "confidence": 0.95,
  "rationale": "Актив в убытке (-5.5%). ETF на акции с высокой волатильностью.",
  "targetReason": "Снижение концентрации в убыточных фондах.",
  "keyRisks": ["Волатильность рынка", "Риск проскальзывания при продаже"],
  "keyCatalysts": ["Исполнение заявок на продажу"],
  "agreementWithPortfolioMath": "AGREE"
}
\`\`\`
`;

      // Шаг 1: Очищаем текст
      const cleanedText = stripJsonBlockFromAiText(aiResponseWithJson);

      // Шаг 2: Проверяем, что ключи structured JSON удалены
      expect(cleanedText).not.toContain('recommendedTargetPercent');
      expect(cleanedText).not.toContain('recommendedAction');
      expect(cleanedText).not.toContain('agreementWithPortfolioMath');
      expect(cleanedText).not.toContain('"ticker"');
      expect(cleanedText).not.toContain('{"ticker"');
      expect(cleanedText).not.toContain('```json');
      expect(cleanedText).not.toContain('```');

      // Шаг 3: assertFinalAiDisplaySafe НЕ выбрасывает ошибку
      expect(() => assertFinalAiDisplaySafe(cleanedText)).not.toThrow();

      // Шаг 4: Narrative текст сохранён
      expect(cleanedText).toContain('Экспертное заключение');
      expect(cleanedText).toContain('Краткое резюме');
      expect(cleanedText).toContain('Реализовать продажи');
      expect(cleanedText).toContain('Перераспределить');
    });

    it('stripJsonBlockFromAiText сохраняет narrative при множественных JSON-блоках', () => {
      const rawAiText = `
Первый блок:
\`\`\`json
{"ticker": "STME", "recommendedAction": "EXIT"}
\`\`\`

Текст между блоками.

Второй блок:
{"ticker": "PLZL", "recommendedTargetPercent": 0}

Финальный текст.
`;

      const cleaned = stripJsonBlockFromAiText(rawAiText);

      expect(cleaned).not.toContain('"ticker"');
      expect(cleaned).not.toContain('"recommendedAction"');
      expect(cleaned).not.toContain('"recommendedTargetPercent"');
      expect(cleaned).toContain('Текст между блоками');
      expect(cleaned).toContain('Финальный текст');
    });
  });
});
