import { parseIssCouponType } from './bond-api.js';

function description(rows: Array<[string, string]>): {
  columns: string[];
  rows: unknown[][];
} {
  return {
    columns: ['name', 'title', 'value'],
    rows: rows.map(([name, value]) => [name, name, value]),
  };
}

describe('parseIssCouponType — тип купона из description MOEX ISS', () => {
  it('ОФЗ-ПК → FLOATER с сырым значением', () => {
    const info = parseIssCouponType(description([['TYPE', 'ОФЗ-ПК']]));

    expect(info.type).toBe('FLOATER');
    expect(info.raw).toBe('ОФЗ-ПК');
    expect(info.source).toBe('ISS_DESCRIPTION');
  });

  it('ОФЗ-ПД → FIXED', () => {
    expect(parseIssCouponType(description([['TYPE', 'ОФЗ-ПД']])).type).toBe(
      'FIXED',
    );
  });

  it('ОФЗ-АД → FIXED_AMORTIZING', () => {
    expect(parseIssCouponType(description([['TYPE', 'ОФЗ-АД']])).type).toBe(
      'FIXED_AMORTIZING',
    );
  });

  it('ОФЗ-ИН → INFLATION_LINKED', () => {
    expect(parseIssCouponType(description([['TYPE', 'ОФЗ-ИН']])).type).toBe(
      'INFLATION_LINKED',
    );
  });

  it('«С плавающим купоном» → FLOATER', () => {
    expect(
      parseIssCouponType(description([['COUPONTYPE', 'С плавающим купоном']]))
        .type,
    ).toBe('FLOATER');
  });

  it('«С фиксированным купоном» → FIXED', () => {
    expect(
      parseIssCouponType(
        description([['COUPONTYPE', 'С фиксированным купоном']]),
      ).type,
    ).toBe('FIXED');
  });

  it('COUPONPERCENT не используется для классификации', () => {
    const info = parseIssCouponType(description([['COUPONPERCENT', '12.5']]));

    expect(info.type).toBe('UNKNOWN');
    expect(info.raw).toBeNull();
  });

  it('пустое description → UNKNOWN без сырого значения', () => {
    const info = parseIssCouponType(null);

    expect(info.type).toBe('UNKNOWN');
    expect(info.raw).toBeNull();
  });

  it('нераспознанное значение → UNKNOWN, но raw сохраняется', () => {
    const info = parseIssCouponType(description([['TYPE', 'Иное']]));

    expect(info.type).toBe('UNKNOWN');
    expect(info.raw).toBe('Иное');
  });
});
