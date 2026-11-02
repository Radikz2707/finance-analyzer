import { describe, it, expect } from 'vitest';
import { priceImpact, dv01, scenarioAnalysis, keyRateSensitivity, determineDurationType, analyzeDuration } from './bond-duration-calculator.js';

describe('bond-duration-calculator', () => {
  describe('UNKNOWN duration', () => {
    it('priceImpact returns null for UNKNOWN', () => { expect(priceImpact(5, 'UNKNOWN', 12, 1)).toBeNull(); });
    it('dv01 returns null for UNKNOWN', () => { expect(dv01(5, 'UNKNOWN', 1000, 100, 12)).toBeNull(); });
    it('scenarioAnalysis returns empty array for UNKNOWN', () => { expect(scenarioAnalysis(5, 'UNKNOWN', 1000, 100, 12, [1, 2, -1])).toEqual([]); });
    it('keyRateSensitivity returns null for UNKNOWN', () => { expect(keyRateSensitivity(5, 'UNKNOWN', 1000, 100, 'FIXED', 1)).toBeNull(); });
    it('analyzeDuration returns MISSING quality for UNKNOWN', () => {
      const r = analyzeDuration({ duration: 5, durationType: 'UNKNOWN', currentYield: 12, currentPrice: 1000, quantity: 100 });
      expect(r.dataQuality).toBe('MISSING'); expect(r.derivedDataQuality).toBe('MISSING'); expect(r.dv01).toBeNull(); expect(r.scenarios).toEqual([]); expect(r.duration).toBe(5);
    });
  });
  describe('DV01 with confirmed units', () => {
    const confirmedDv01 = { value: 45.5, unit: 'PRICE_PER_BOND_PER_1BP' as const, scope: 'ONE_BOND' as const };
    it('preserves originalDv01 when DV01 type confirmed', () => {
      const r = analyzeDuration({ duration: 45.5, durationType: 'DV01', currentYield: 12, currentPrice: 1000, quantity: 100, originalDv01: confirmedDv01 });
      expect(r.dataQuality).toBe('AVAILABLE'); expect(r.derivedDataQuality).toBe('MISSING');
      expect(r.originalDv01).toBeDefined();
      if (r.originalDv01) {
        expect(r.originalDv01.value).toBe(45.5);
        expect(r.originalDv01.unit).toBe('PRICE_PER_BOND_PER_1BP');
        expect(r.originalDv01.scope).toBe('ONE_BOND');
      }
    });
    it('dv01 returns null for DV01 type (blocked)', () => { expect(dv01(45.5, 'DV01', 1000, 100, 12)).toBeNull(); });
    it('priceImpact returns null for DV01 type (blocked)', () => { expect(priceImpact(45.5, 'DV01', 12, 1)).toBeNull(); });
    it('scenarioAnalysis returns empty for DV01 type', () => { expect(scenarioAnalysis(45.5, 'DV01', 1000, 100, 12, [1, 2])).toEqual([]); });
    it('originalDv01 is not auto-populated when not provided', () => {
      const r = analyzeDuration({ duration: 5, durationType: 'UNKNOWN', currentYield: 12, currentPrice: 1000, quantity: 100 });
      expect(r.originalDv01).toBeUndefined();
    });
  });
  describe('DV01 without confirmed units', () => {
    it('does not create originalDv01 automatically', () => {
      const r = analyzeDuration({ duration: 5, durationType: 'UNKNOWN', currentYield: 12, currentPrice: 1000, quantity: 100 });
      expect(r.originalDv01).toBeUndefined();
    });
    it('unknown duration type does not trigger derived calculations', () => {
      const r = analyzeDuration({ duration: 5, durationType: 'UNKNOWN', currentYield: 12, currentPrice: 1000, quantity: 100, scenarios: [1, 2, 3] });
      expect(r.dv01).toBeNull(); expect(r.scenarios).toEqual([]);
    });
  });
  describe('MODIFIED duration', () => {
    it('priceImpact calculates correctly for +1% yield change', () => {
      const impact = priceImpact(5, 'MODIFIED', 12, 1);
      expect(impact).toBeCloseTo(-5, 1);
    });
    it('dv01 calculates correctly for MODIFIED', () => {
      const result = dv01(5, 'MODIFIED', 1000, 100, 12);
      expect(result).toBeCloseTo(50, 1);
    });
    it('analyzeDuration returns AVAILABLE quality for MODIFIED', () => {
      const r = analyzeDuration({ duration: 5, durationType: 'MODIFIED', currentYield: 12, currentPrice: 1000, quantity: 100, scenarios: [1, -1] });
      expect(r.dataQuality).toBe('AVAILABLE'); expect(r.derivedDataQuality).toBe('AVAILABLE');
      expect(r.dv01).toBeCloseTo(50, 1); expect(r.scenarios).toHaveLength(2);
    });
    it('scenarioAnalysis generates results for MODIFIED', () => {
      const results = scenarioAnalysis(5, 'MODIFIED', 1000, 100, 12, [1, -1]);
      expect(results).toHaveLength(2);
      expect(results[0]?.yieldChangePct).toBe(1);
      expect(results[0]?.priceImpactPct).toBeCloseTo(-5, 1);
    });
  });
  describe('MACAULAY duration', () => {
    it('converts Macaulay to Modified using YTM', () => {
      const impact = priceImpact(5, 'MACAULAY', 12, 1);
      expect(impact).toBeCloseTo(-4.464, 1);
    });
    it('dv01 converts Macaulay correctly', () => {
      const result = dv01(5, 'MACAULAY', 1000, 100, 12);
      expect(result).toBeCloseTo(44.64, 1);
    });
    it('analyzeDuration returns PARTIAL when MACAULAY without YTM', () => {
      const r = analyzeDuration({ duration: 5, durationType: 'MACAULAY', currentYield: 0, currentPrice: 1000, quantity: 100 });
      expect(r.dataQuality).toBe('PARTIAL'); expect(r.derivedDataQuality).toBe('PARTIAL');
    });
    it('MACAULAY with positive yield allows derived calculations', () => {
      const r = analyzeDuration({ duration: 5, durationType: 'MACAULAY', currentYield: 12, currentPrice: 1000, quantity: 100, scenarios: [1] });
      expect(r.dataQuality).toBe('AVAILABLE'); expect(r.dv01).not.toBeNull(); expect(r.scenarios).toHaveLength(1);
    });
  });
  describe('Invalid data', () => {
    it('negative duration returns null for priceImpact', () => { expect(priceImpact(-5, 'MODIFIED', 12, 1)).toBeNull(); });
    it('zero duration returns null for priceImpact', () => { expect(priceImpact(0, 'MODIFIED', 12, 1)).toBeNull(); });
    it('NaN duration returns falsy for priceImpact', () => { expect(priceImpact(NaN, 'MODIFIED', 12, 1)).toBeFalsy(); });
    it('Infinity duration returns non-finite for priceImpact', () => { expect(Number.isFinite(priceImpact(Infinity, 'MODIFIED', 12, 1))).toBe(false); });
    it('dv01 returns null for negative duration', () => { expect(dv01(-5, 'MODIFIED', 1000, 100, 12)).toBeNull(); });
    it('dv01 returns null for zero price', () => { expect(dv01(5, 'MODIFIED', 0, 100, 12)).toBeNull(); });
    it('dv01 returns null for zero quantity', () => { expect(dv01(5, 'MODIFIED', 1000, 0, 12)).toBeNull(); });
    it('analyzeDuration handles negative duration gracefully', () => {
      const r = analyzeDuration({ duration: -5, durationType: 'MODIFIED', currentYield: 12, currentPrice: 1000, quantity: 100 });
      expect(r.duration).toBeNull(); expect(r.dv01).toBeNull();
    });
    it('analyzeDuration handles zero duration gracefully', () => {
      const r = analyzeDuration({ duration: 0, durationType: 'MODIFIED', currentYield: 12, currentPrice: 1000, quantity: 100 });
      expect(r.duration).toBeNull();
    });
    it('dv01 returns falsy for NaN price', () => { expect(dv01(5, 'MODIFIED', NaN, 100, 12)).toBeFalsy(); });
    it('dv01 returns null for negative price', () => { expect(dv01(5, 'MODIFIED', -100, 100, 12)).toBeNull(); });
  });
  describe('Dependent functions', () => {
    it('priceImpact blocks UNKNOWN', () => { expect(priceImpact(5, 'UNKNOWN', 12, 1)).toBeNull(); });
    it('priceImpact blocks DV01', () => { expect(priceImpact(5, 'DV01', 12, 1)).toBeNull(); });
    it('dv01 blocks UNKNOWN', () => { expect(dv01(5, 'UNKNOWN', 1000, 100, 12)).toBeNull(); });
    it('dv01 blocks DV01', () => { expect(dv01(5, 'DV01', 1000, 100, 12)).toBeNull(); });
    it('scenarioAnalysis blocks UNKNOWN', () => { expect(scenarioAnalysis(5, 'UNKNOWN', 1000, 100, 12, [1, 2])).toEqual([]); });
    it('scenarioAnalysis blocks DV01', () => { expect(scenarioAnalysis(5, 'DV01', 1000, 100, 12, [1, 2])).toEqual([]); });
    it('keyRateSensitivity blocks UNKNOWN', () => { expect(keyRateSensitivity(5, 'UNKNOWN', 1000, 100, 'FIXED', 1)).toBeNull(); });
    it('keyRateSensitivity blocks DV01', () => { expect(keyRateSensitivity(5, 'DV01', 1000, 100, 'FIXED', 1)).toBeNull(); });
    it('keyRateSensitivity applies floater multiplier', () => {
      const floater = keyRateSensitivity(5, 'MODIFIED', 1000, 100, 'FLOATER', 1);
      const fixed = keyRateSensitivity(5, 'MODIFIED', 1000, 100, 'FIXED', 1);
      expect(floater).not.toBeNull(); expect(fixed).not.toBeNull();
      if (floater !== null && fixed !== null) { expect(Math.abs(floater)).toBeCloseTo(Math.abs(fixed) * 0.2, 1); }
    });
    it('determineDurationType returns correct values', () => {
      expect(determineDurationType(true, false, false)).toBe('MODIFIED');
      expect(determineDurationType(false, true, false)).toBe('MACAULAY');
      expect(determineDurationType(false, false, true)).toBe('EFFECTIVE');
      expect(determineDurationType(false, false, false)).toBe('UNKNOWN');
    });
  });
});
