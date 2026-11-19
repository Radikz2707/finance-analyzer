import { vi } from 'vitest';

import { analyzeYield, classifyOfzSeries } from './bond-yield-calculator.js';

describe('classifyOfzSeries — фактическая раскладка серий ОФЗ', () => {
  it('24xxx и 29xxx — ОФЗ-ПК (плавающий купон)', () => {
    expect(classifyOfzSeries('SU29027RMFS8')).toBe('FLOATER');
    expect(classifyOfzSeries('29027RMFS')).toBe('FLOATER');
    expect(classifyOfzSeries('SU24001RMFS6')).toBe('FLOATER');
  });

  it('25xxx и 26xxx — ОФЗ-ПД (фиксированный купон)', () => {
    expect(classifyOfzSeries('SU26207RMFS9')).toBe('FIXED');
    expect(classifyOfzSeries('SU25001RMFS5')).toBe('FIXED');
  });

  it('46xxx — ОФЗ-АД (фиксированный купон + амортизация)', () => {
    expect(classifyOfzSeries('SU46022RMFS8')).toBe('FIXED_AMORTIZING');
  });

  it('52xxx — ОФЗ-ИН (индексируемый номинал)', () => {
    expect(classifyOfzSeries('SU52002RMFS1')).toBe('INFLATION_LINKED');
  });

  it('28xxx не существует: серия не распознана → UNKNOWN', () => {
    expect(classifyOfzSeries('SU28001RMFS5')).toBe('UNKNOWN');
    expect(classifyOfzSeries('99999RMFS')).toBe('UNKNOWN');
  });

  it('не-ОФЗ и пустой идентификатор — null', () => {
    expect(classifyOfzSeries('RU000A10GC20')).toBeNull();
    expect(classifyOfzSeries(undefined)).toBeNull();
    expect(classifyOfzSeries('')).toBeNull();
  });
});

describe('analyzeYield — тип купона: ISS description → серия → Excel', () => {
  const base = {
    couponAmount: 0,
    couponPeriodDays: 0,
    marketPrice: 950,
    nominal: 1000,
    quantity: 10,
  };

  it('29027: Excel FIXED + ISS FLOATER → UNKNOWN/excel_conflict с атрибуцией', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: 'SU29027RMFS8',
      issCouponType: 'FLOATER',
      issCouponTypeRaw: 'ОФЗ-ПК',
    });

    expect(result.couponType).toBe('UNKNOWN');
    expect(result.couponTypeReason).toBe('excel_conflict');
    expect(result.couponTypeReasonDetail).toBe(
      'Excel FIXED, ISS FLOATER (ОФЗ-ПК)',
    );
    expect(result.couponTypeSource).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[BOND_CARD]'));
    log.mockRestore();
  });

  it('29027 без ISS, серия 29xxx → UNKNOWN/excel_conflict (Excel FIXED против серии)', () => {
    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: 'SU29027RMFS8',
    });

    expect(result.couponType).toBe('UNKNOWN');
    expect(result.couponTypeReason).toBe('excel_conflict');
    expect(result.couponTypeReasonDetail).toBe('Excel FIXED, серия FLOATER');
  });

  it('29027 без купона + ISS FLOATER → FLOATER с источником ISS', () => {
    const result = analyzeYield({
      ...base,
      identifier: 'SU29027RMFS8',
      issCouponType: 'FLOATER',
      issCouponTypeRaw: 'ОФЗ-ПК',
    });

    expect(result.couponType).toBe('FLOATER');
    expect(result.couponTypeSource).toBe('ISS');
    expect(result.couponTypeReason).toBeNull();
  });

  it('26xxx: Excel FIXED + ISS FIXED → FIXED без конфликта', () => {
    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: 'SU26207RMFS9',
      issCouponType: 'FIXED',
      issCouponTypeRaw: 'ОФЗ-ПД',
    });

    expect(result.couponType).toBe('FIXED');
    expect(result.couponTypeSource).toBe('ISS');
    expect(result.couponTypeReason).toBeNull();
  });

  it('26xxx без ISS → FIXED по серии', () => {
    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: 'SU26207RMFS9',
    });

    expect(result.couponType).toBe('FIXED');
    expect(result.couponTypeSource).toBe('SERIES');
  });

  it('24xxx без купона → FLOATER: серия известна, ZERO_COUPON не ставим', () => {
    const result = analyzeYield({
      ...base,
      identifier: 'SU24001RMFS6',
    });

    expect(result.couponType).toBe('FLOATER');
    expect(result.couponTypeSource).toBe('SERIES');
  });

  it('неизвестный префикс госрегномера → UNKNOWN/type_unconfirmed', () => {
    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: '99999RMFS',
    });

    expect(result.couponType).toBe('UNKNOWN');
    expect(result.couponTypeReason).toBe('type_unconfirmed');
    expect(result.couponTypeReasonDetail).toContain(
      'префикс серии не распознан',
    );
  });

  it('не-ОФЗ без купона и без ISS → UNKNOWN (нет подтверждения источника)', () => {
    const result = analyzeYield({
      ...base,
      identifier: 'RU000A10GC20',
    });

    // Пункт 2 плана: нулевой купон без авторитетного подтверждения (ISS/серия)
    // → UNKNOWN, а не ZERO_COUPON. Это чинит кейс ALROSA: неактивная строка
    // Excel ≠ бескупонная бумага.
    // reason=null: это не «нераспознанная серия ОФЗ», а просто отсутствие данных.
    expect(result.couponType).toBe('UNKNOWN');
    expect(result.couponTypeSource).toBe('EXCEL');
    expect(result.couponTypeReason).toBeNull();
  });

  // ─── Контр-тест пункта 2: ALROSA ───
  it('КОНТР-ТЕСТ: ALROSA с maturity date ≠ ZERO_COUPON (пункт 2 плана)', () => {
    // ALROSA в отчёте 01:28 показывала «ZERO_COUPON» И «next payment: 12.12.2026» —
    // оксюморон: бескупонная бумага не может иметь следующую выплату.
    // Фикс: без ISS/серии → UNKNOWN (не ZERO_COUPON).
    // UNKNOWN + nextCouponDate — не оксюморон: тип не подтверждён,
    // но дата выплаты может быть известна из источника.
    const result = analyzeYield({
      ...base,
      identifier: 'RU000A10GC20',
      maturityDate: new Date('2026-12-12T00:00:00.000Z'),
      nextCouponDate: new Date('2026-12-12T00:00:00.000Z'),
    });

    // Без ISS/серии → UNKNOWN, не ZERO_COUPON (главный фикс пункта 2)
    expect(result.couponType).toBe('UNKNOWN');
    // nextCouponDate показывается потому что подтверждён источником
    expect(result.nextCouponDate).toBe('2026-12-12');
  });

  it('46xxx → FIXED_AMORTIZING, YTM помечен как без учёта амортизации', () => {
    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: 'SU46022RMFS8',
      maturityDate: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(result.couponType).toBe('FIXED_AMORTIZING');
    expect(result.ytmMethod).toBe('AMORTIZING_NOT_ADJUSTED');
  });

  it('флоатер: YTM помечен методикой «неизменная ставка»', () => {
    const result = analyzeYield({
      ...base,
      identifier: 'SU24001RMFS6',
      couponAmount: 0,
      couponPeriodDays: 91,
      maturityDate: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(result.couponType).toBe('FLOATER');
    expect(result.ytmMethod).toBe('FLOATER_ASSUMED_CONSTANT_RATE');
  });

  it('пробрасывает подтверждённую дату следующей выплаты (эталон 29027)', () => {
    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: 'SU29027RMFS8',
      nextCouponDate: new Date('2026-12-11T00:00:00.000Z'),
    });

    expect(result.nextCouponDate).toBe('2026-12-11');
  });

  it('без даты в источнике → null (карточка пишет «дата не указана»)', () => {
    const result = analyzeYield({
      ...base,
      couponAmount: 35,
      couponPeriodDays: 182,
      identifier: 'SU26207RMFS9',
    });

    expect(result.nextCouponDate).toBeNull();
  });
});
