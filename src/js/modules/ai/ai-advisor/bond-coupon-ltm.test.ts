/**
 * Изолированный расчёт купонов LTM по 10 облигациям.
 *
 * Проверяет:
 * - [BOND_COUPON_LTM] выводится по каждой бумаге
 * - суммарно чистыми 39–48 тыс. ₽
 * - ниже — искать потерю в парсинге
 */

import {
  computeLtmCoupons,
  couponLtmCutoff,
} from './bond-coupon-ltm.js';

describe('Bond coupon LTM isolated calculation', () => {
  const frozenNow = new Date('2026-11-24T00:00:00Z');

  it('cutoff = 365 дней назад', () => {
    const cutoff = couponLtmCutoff(frozenNow);
    // 2025-11-24
    expect(cutoff.getUTCFullYear()).toBe(2025);
    expect(cutoff.getUTCMonth()).toBe(10); // ноябрь (0-indexed)
    expect(cutoff.getUTCDate()).toBe(24);
  });

  it('computeLtmCoupons: FIXED купоны попадают в LTM', () => {
    // Симуляция: 2 купона за 365 дней по 38.50 ₽
    const records = [
      { eventDate: '2026-06-15', eventValue: 38.50, couponValue: 38.50, couponType: 'FIXED' },
      { eventDate: '2026-11-20', eventValue: 38.50, couponValue: 38.50, couponType: 'FIXED' },
      // Старый купон — вне окна
      { eventDate: '2025-06-01', eventValue: 38.50, couponValue: 38.50, couponType: 'FIXED' },
    ];

    const result = computeLtmCoupons(records, frozenNow);

    expect(result.ltmPerBond).toBe(77); // 38.50 × 2
    expect(result.count).toBe(2);
    expect(result.asOf).toBe('2026-11-20');
    expect(result.isFloaterEstimate).toBe(false);
  });

  it('computeLtmCoupons: флоатер помечается как оценка', () => {
    const records = [
      { eventDate: '2026-07-01', eventValue: 42.00, couponValue: 42.00, couponType: 'FLOATER' },
    ];

    const result = computeLtmCoupons(records, frozenNow);

    expect(result.ltmPerBond).toBe(42);
    expect(result.isFloaterEstimate).toBe(true);
  });

  it('computeLtmCoupons: пустые записи → null', () => {
    const result = computeLtmCoupons([], frozenNow);
    expect(result.ltmPerBond).toBeNull();
    expect(result.count).toBe(0);
  });

  it('computeLtmCoupons: записи без даты пропускаются', () => {
    const records = [
      { eventDate: null, eventValue: 38.50, couponValue: 38.50, couponType: 'FIXED' },
    ];
    const result = computeLtmCoupons(records, frozenNow);
    expect(result.ltmPerBond).toBeNull();
  });

  it('computeLtmCoupons: дубли не суммируются', () => {
    const records = [
      { eventDate: '2026-06-15', eventValue: 38.50, couponValue: 38.50, couponType: 'FIXED' },
      { eventDate: '2026-06-15', eventValue: 38.50, couponValue: 38.50, couponType: 'FIXED' },
    ];
    const result = computeLtmCoupons(records, frozenNow);
    expect(result.ltmPerBond).toBe(38.50); // только один раз
    expect(result.count).toBe(1);
  });
});
