import {
  MAX_PERCENT_PRICE,
  resolveCompanionPrice,
  resolvePrice,
} from './bond-price-normalizer.js';

describe('resolvePrice', () => {
  it('акции и ETF всегда в рублях', () => {
    const result = resolvePrice({
      rawPrice: 285,
      isBond: false,
      source: 'QUIK_COST',
    });

    expect(result.priceRub).toBe(285);
    expect(result.priceUnit).toBe('RUB');
    expect(result.priceNormalized).toBe(true);
  });

  it('рублёвая цена облигации 998 не умножается на номинал', () => {
    const result = resolvePrice({
      rawPrice: 998,
      nominal: 1000,
      isBond: true,
      source: 'QUIK_PRICE',
    });

    expect(result.priceRub).toBe(998);
    expect(result.scale).toBe('RUB');
    expect(result.priceNormalized).toBe(true);
  });

  it('цена 99,8 % превращается в 998 ₽ по ориентиру MOEX', () => {
    const result = resolvePrice({
      rawPrice: 99.8,
      nominal: 1000,
      isBond: true,
      source: 'QUIK_PRICE',
      references: [{ nominal: 1000, pricePct: 99.8, source: 'MOEX_ISS' }],
    });

    expect(result.priceRub).toBe(998);
    expect(result.priceUnit).toBe('PERCENT_OF_NOMINAL');
    expect(result.priceNormalized).toBe(true);
    expect(result.priceSource).toBe('QUIK_PRICE');
  });

  it('без ориентира не угадывает масштаб: UNKNOWN + предупреждение', () => {
    const result = resolvePrice({
      rawPrice: 99.8,
      nominal: 1000,
      isBond: true,
      source: 'QUIK_PRICE',
    });

    expect(result.priceRub).toBe(0);
    expect(result.priceUnit).toBe('UNKNOWN');
    expect(result.priceNormalized).toBe(false);
    expect(result.priceWarning).toContain('нет ориентира');
  });

  it('цена 95,1 % превращается в 951 ₽ при ориентире 97 %', () => {
    const result = resolvePrice({
      rawPrice: 95.1,
      nominal: 1000,
      isBond: true,
      source: 'QUIK_LIQ_PRICE',
      references: [{ nominal: 1000, pricePct: 97, source: 'BONDS_SHEET' }],
    });

    expect(result.priceRub).toBe(951);
    expect(result.priceUnit).toBe('PERCENT_OF_NOMINAL');
    expect(result.priceNormalized).toBe(true);
  });

  it('цена 976,95 трактуется как рубли без ориентира', () => {
    const result = resolvePrice({
      rawPrice: 976.95,
      nominal: 1000,
      isBond: true,
      source: 'QUIK_LIQ_PRICE',
    });

    expect(result.priceRub).toBe(976.95);
    expect(result.priceUnit).toBe('RUB');
    expect(result.priceNormalized).toBe(true);
  });

  it('нулевая цена добирается с MOEX ISS', () => {
    const result = resolvePrice({
      rawPrice: 0,
      isBond: true,
      source: 'QUIK_PRICE',
      references: [{ nominal: 1000, pricePct: 100.5, source: 'MOEX_ISS' }],
    });

    expect(result.priceRub).toBe(1005);
    expect(result.priceSource).toBe('MOEX_ISS');
    expect(result.priceNormalized).toBe(true);
  });

  it('рублёвый ориентир Smart-Lab используется напрямую', () => {
    const result = resolvePrice({
      rawPrice: 0,
      isBond: true,
      source: 'QUIK_PRICE',
      references: [{ nominal: 1000, priceRub: 1010, source: 'SMARTLAB' }],
    });

    expect(result.priceRub).toBe(1010);
    expect(result.priceUnit).toBe('RUB');
    expect(result.priceSource).toBe('SMARTLAB');
  });

  it('нулевая цена без ориентиров — UNKNOWN + предупреждение', () => {
    const result = resolvePrice({
      rawPrice: 0,
      isBond: true,
      source: 'UNKNOWN',
    });

    expect(result.priceRub).toBe(0);
    expect(result.priceNormalized).toBe(false);
    expect(result.priceWarning).toContain('не найдена');
  });

  it('Стоимость / Позиция (rawIsRub) не конвертируется', () => {
    const result = resolvePrice({
      rawPrice: 96,
      nominal: 1000,
      isBond: true,
      rawIsRub: true,
      source: 'QUIK_COST',
    });

    expect(result.priceRub).toBe(96);
    expect(result.priceUnit).toBe('RUB');
    expect(result.priceNormalized).toBe(true);
  });

  it('номинал ≈ 100: рубли и проценты совпадают — выбираются рубли', () => {
    const result = resolvePrice({
      rawPrice: 99,
      nominal: 100,
      isBond: true,
      source: 'QUIK_PRICE',
    });

    expect(result.priceRub).toBe(99);
    expect(result.priceUnit).toBe('RUB');
  });

  it('цена не согласуется с ориентиром — UNKNOWN + предупреждение', () => {
    const result = resolvePrice({
      rawPrice: 100,
      nominal: 1000,
      isBond: true,
      source: 'QUIK_PRICE',
      references: [{ nominal: 1000, pricePct: 50, source: 'MOEX_ISS' }],
    });

    expect(result.priceRub).toBe(0);
    expect(result.priceNormalized).toBe(false);
    expect(result.priceWarning).toContain('не согласуется');
  });

  it('порог процентов — 250', () => {
    expect(MAX_PERCENT_PRICE).toBe(250);
  });
});

describe('resolveCompanionPrice', () => {
  it('балансовая цена в рублях не меняется', () => {
    expect(resolveCompanionPrice(1000.15, 1000, [])).toBe(1000.15);
  });

  it('балансовая цена в % конвертируется по ориентиру', () => {
    expect(
      resolveCompanionPrice(98, 1000, [
        { nominal: 1000, pricePct: 98, source: 'MOEX_ISS' },
      ]),
    ).toBe(980);
  });

  it('без ориентира возвращает исходное значение', () => {
    expect(resolveCompanionPrice(95.1, 1000, [])).toBe(95.1);
  });
});
