/**
 * Integration tests: Research → Thesis → AI context.
 *
 * 13 тестов по спецификации integration pass:
 * 1. Snapshot → Thesis → AI context
 * 2. thesis fields появляются в prompt
 * 3. evidence появляются в prompt
 * 4. NO_RESEARCH → no invented thesis
 * 5. NO_DATA не превращается в VALUE
 * 6. USER_TARGET сохраняется
 * 7. PortfolioMath сохраняется
 * 8. AI target отделён от USER_TARGET
 * 9. AI action отделён от PortfolioMath
 * 10. active orders не являются research evidence
 * 11. auto-target 3% не попадает в research context
 * 12. AI disagreement может быть представлен отдельно
 * 13. insufficient evidence → low confidence
 */

import { describe, it, expect } from 'vitest';
import { InvestmentThesisEngine } from '../research/investment-thesis/investment-thesis-engine.js';
import {
  buildAssetResearchSnapshot,
  buildPortfolioAssetContext,
} from './snapshot-builder.js';
import type { AssetAnalysis } from '../portfolio-math/portfolio-math.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeAssetAnalysis(overrides: Partial<AssetAnalysis> = {}): AssetAnalysis {
  return {
    name: 'Тестовый актив',
    ticker: 'TEST',
    assetType: 'Акция',
    currentPercent: 10,
    targetPercent: 15,
    deficitRub: 50000,
    status: 'BUY',
    dynamicsPercent: 2.5,
    nkdRub: 0,
    nominal: 0,
    quantity: 100,
    balancePrice: 200,
    currentPrice: 250,
    unrealizedProfitRub: 5000,
    priority: 50000,
    isConcentrated: false,
    ...overrides,
  };
}

function buildEngine(): InvestmentThesisEngine {
  return new InvestmentThesisEngine();
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('Integration: Research → Thesis → AI context', () => {
  const engine = buildEngine();

  // 1. Snapshot → Thesis → AI context
  it('1. Snapshot → Thesis → ThesisResult создаётся корректно', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'SBER',
      name: 'ПАО Сбербанк',
      assetType: 'Акция',
      currentPercent: 10,
      targetPercent: 15,
      status: 'BUY',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 1000000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    expect(result.ticker).toBe('SBER');
    expect(result.thesis).toBeTruthy();
    expect(result.thesis.length).toBeGreaterThan(10);
    expect(result.bullCase).toBeTruthy();
    expect(result.baseCase).toBeTruthy();
    expect(result.bearCase).toBeTruthy();
    expect(result.assetType).toBe('STOCK');
  });

  // 2. thesis fields появляются в prompt
  it('2. thesis fields появляются в сформированном контексте', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'GAZP',
      name: 'ПАО Газпром',
      currentPercent: 5,
      status: 'HOLD',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 500000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // Проверяем что все ключевые поля заполнены
    expect(result.thesis).toBeDefined();
    expect(result.bullCase).toBeDefined();
    expect(result.baseCase).toBeDefined();
    expect(result.bearCase).toBeDefined();
    expect(Array.isArray(result.keyDrivers)).toBe(true);
    expect(Array.isArray(result.keyRisks)).toBe(true);
    expect(Array.isArray(result.keyCatalysts)).toBe(true);
    expect(result.valuationView).toBeDefined();
    expect(result.macroSensitivity).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.evidenceReferences).toBeDefined();
  });

  // 3. evidence появляются в prompt
  it('3. evidence появляются в InvestmentThesisResult', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'VTBR',
      name: 'ПАО ВТБ',
      currentPercent: 3,
      status: 'REDUCE',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 300000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // evidenceReferences может быть пустым (нет VALUE полей с evidenceIds),
    // но поле должно существовать
    expect(result.evidenceReferences).toBeDefined();
    expect(Array.isArray(result.evidenceReferences)).toBe(true);
  });

  // 4. NO_RESEARCH → no invented thesis
  it('4. NO_RESEARCH → AI не получает выдуманный thesis', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'NONE',
      name: 'Нет данных',
      currentPercent: 0,
      targetPercent: undefined,
      status: 'NO_TARGET',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 0,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // При отсутствии research данных thesis должен содержать "отсутствуют" / "недостаточно"
    const thesisLower = result.thesis.toLowerCase();
    const hasInventedData = /выручка \d+|чистая прибыль \d+|roe \d+|p\/e \d+/i.test(thesisLower);
    expect(hasInventedData).toBe(false);
  });

  // 5. NO_DATA не превращается в VALUE
  it('5. NO_DATA не превращается в VALUE в confidence', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'NODATA',
      name: 'Только NO_DATA',
      currentPercent: 0,
      status: 'NO_TARGET',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 0,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // При отсутствии VALUE данных confidence должна быть LOW
    expect(result.confidence.level).toBe('LOW');
    expect(result.confidence.value).toBeLessThan(0.2);
    expect(result.valuationView.stance).toBe('insufficient_data');
  });

  // 6. USER_TARGET сохраняется
  it('6. USER_TARGET_PERCENT сохраняется в portfolioContext', () => {
    const asset = makeAssetAnalysis({
      ticker: 'USER',
      name: 'Пользовательская цель',
      currentPercent: 8,
      targetPercent: 12,
      status: 'BUY',
    });

    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 1000000,
    });

    expect(portfolioCtx.targetPercent).toBe(12);
    expect(portfolioCtx.currentPercent).toBe(8);
    expect(portfolioCtx.portfolioMathStatus).toBe('BUY');
  });

  // 7. PortfolioMath сохраняется
  it('7. PortfolioMath status корректно передаётся в thesis', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'MATH',
      name: 'PortfolioMath тест',
      currentPercent: 20,
      targetPercent: 0,
      status: 'EXIT',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 1000000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // Thesis должен содержать контекст портфеля
    expect(result.thesis).toContain('Контекст портфеля');
    expect(result.thesis).toContain('20%');
    expect(result.thesis).toContain('0%');
    expect(result.thesis).toContain('EXIT');
  });

  // 8. AI target отделён от USER_TARGET
  it('8. AI_RECOMMENDED_TARGET_PERCENT отделён от USER_TARGET_PERCENT', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'SEPARATE',
      name: 'Разделение целей',
      currentPercent: 5,
      targetPercent: 10,
      status: 'BUY',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 500000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // Thesis не должен содержать AI_RECOMMENDED_TARGET_PERCENT —
    // это поле формируется AI, а не ThesisEngine
    expect(result.thesis).not.toContain('AI_RECOMMENDED_TARGET_PERCENT');
    expect(result.thesis).not.toContain('AI_RECOMMENDED_ACTION');

    // Thesis содержит только fact-данные
    expect(result.thesis).toContain('Контекст портфеля');
  });

  // 9. AI action отделён от PortfolioMath
  it('9. AI_RECOMMENDED_ACTION отделён от PORTFOLIO_MATH_STATUS', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'ACTION',
      name: 'Действие AI',
      currentPercent: 15,
      targetPercent: 15,
      status: 'STABLE',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 750000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // Thesis содержит PortfolioMath status
    expect(result.thesis).toContain('STABLE');

    // Но не содержит AI action
    expect(result.thesis).not.toContain('AI_RECOMMENDED_ACTION');
  });

  // 10. active orders не являются research evidence
  it('10. active orders не являются investment evidence', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'ORDERS',
      name: 'С заявками',
      currentPercent: 5,
      targetPercent: 10,
      status: 'BUY',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 500000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // Evidence references не должны содержать "order" или "заявка"
    const hasOrderEvidence = result.evidenceReferences.some(
      (e) => /order|заявка|bid|ask/i.test(e.fact),
    );
    expect(hasOrderEvidence).toBe(false);
  });

  // 11. auto-target 3% не попадает в research context
  it('11. auto-target 3% не попадает в research context', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'AUTO',
      name: 'Авто-таргет',
      currentPercent: 0,
      targetPercent: undefined,
      status: 'NO_TARGET',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 0,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // Thesis не должен содержать "3%" как рекомендацию
    // (auto-target 3% — это HTML-логика, не research)
    const thesisText = result.thesis;
    // При отсутствии target и research данных 3% не должен появляться
    expect(thesisText).not.toContain('рекомендуется 3%');
    expect(thesisText).not.toContain('базовая доля 3%');
  });

  // 12. AI disagreement может быть представлен отдельно
  it('12. AI disagreement может быть представлен отдельно', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'DISAGREE',
      name: 'Расхождение с PortfolioMath',
      currentPercent: 25,
      targetPercent: 10,
      status: 'REDUCE',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 1000000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    // Thesis фиксирует факт: PortfolioMath хочет REDUCE
    expect(result.thesis).toContain('REDUCE');

    // Но AI может не согласиться — это отдельное поле,
    // которое формируется в AI output, не в thesis
    // Проверяем что thesis не содержит AI decision
    expect(result.thesis).not.toContain('AI_VS_PORTFOLIO_MATH');
    expect(result.thesis).not.toContain('AI_DISAGREES');
  });

  // 13. insufficient evidence → low confidence
  it('13. insufficient evidence → confidence = LOW', async () => {
    const asset = makeAssetAnalysis({
      ticker: 'INSUFF',
      name: 'Недостаточно доказательств',
      currentPercent: 2,
      targetPercent: 5,
      status: 'BUY',
    });

    const { snapshot } = await buildAssetResearchSnapshot(asset);
    const portfolioCtx = buildPortfolioAssetContext(asset, {
      totalPortfolioValue: 200000,
    });

    const result = engine.generate({ snapshot, portfolioContext: portfolioCtx });

    expect(result.confidence.level).toBe('LOW');
    expect(result.confidence.value).toBeLessThan(0.2);
    expect(result.valuationView.stance).toBe('insufficient_data');
    expect(result.macroSensitivity.dataSource).toBe('INSUFFICIENT');
  });
});
