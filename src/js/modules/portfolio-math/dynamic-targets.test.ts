// ВНИМАНИЕ: используются глобальные API vitest (globals: true),
// т.к. явный import из 'vitest' ломает runner (vitest 5.0.x + эта конфигурация).
import { validateTargetPercentages } from '../xlsx-parser/xlsx-parser.js';
import { AggregatedAsset } from '../xlsx-parser/xlsx-parser.js';

describe('Динамические целевые доли — валидация и расчёт кэш-резерва', () => {
  // Вспомогательная функция для создания моковых активов
  const createAsset = (
    ticker: string,
    targetPercent: number,
  ): AggregatedAsset =>
    ({
      ticker,
      name: ticker,
      assetType: 'А',
      totalLiquidationValue: 0,
      totalLiquidationPercent: 0,
      totalBalancePercent: 0,
      targetPercent,
      totalQuantity: 0,
      balancePrice: 0,
      currentPrice: 0,
      totalUnrealizedProfitRub: 0,
      dynamicsPercent: 0,
      liquidationPrice: 0,
      totalBalanceValue: 0,
      accounts: [],
    } as unknown as AggregatedAsset);

  // ─── Тест 1: Расчёт при стоимости <= triggerValue → baseTarget ───
  it('должна корректно считать кэш-резерв при единственном активе', () => {
    const assets = [createAsset('SBER', 15)];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(true);
    expect(result.totalTargetPercent).toBe(15);
    expect(result.cashReservePercent).toBe(85);
  });

  // ─── Тест 2: Сумма целевых долей + кэш = 100% с учётом округления ───
  it('сумма целевых долей + кэш = 100% с учётом округления', () => {
    const assets = [
      createAsset('SBER', 15),
      createAsset('GAZP', 10),
      createAsset('LKOH', 12),
      createAsset('ROSN', 8),
    ];
    const result = validateTargetPercentages(assets);

    expect(result.totalTargetPercent + result.cashReservePercent).toBeCloseTo(
      100,
      1,
    );
    expect(result.isValid).toBe(true);
  });

  // ─── Тест 3: Реальный сценарий — сумма 95.2%, кэш 4.8% ───
  it('должна корректно обрабатывать реальную ситуацию: сумма=95.2%, кэш=4.8%', () => {
    const assets = [
      createAsset('SBER', 15),
      createAsset('GAZP', 10),
      createAsset('LKOH', 12),
      createAsset('ROSN', 8),
      createAsset('VTBR', 5),
      createAsset('MGNT', 10),
      createAsset('TATN', 10),
      createAsset('ALRS', 7),
      createAsset('GMKN', 8),
      createAsset('SNGS', 5),
      createAsset('FESK', 5),
      createAsset('CHMF', 0.2),
    ];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(true);
    expect(result.totalTargetPercent).toBeCloseTo(95.2, 1);
    expect(result.cashReservePercent).toBeCloseTo(4.8, 1);
  });

  // ─── Тест 4: Отсутствие автоматической нормализации ───
  it('НЕ должна нормализовать до 100%', () => {
    // Сумма целевых долей = 95.2% (как в реальности)
    // cashReserve = 4.8%
    // НЕ должно быть нормализации до 100%
    const assets = [createAsset('TEST', 95.2)];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(true);
    expect(result.totalTargetPercent).toBe(95.2);
    expect(result.cashReservePercent).toBeCloseTo(4.8, 10);
    // Кэш-резерв НЕ обнуляется и НЕ нормализуется
    expect(result.cashReservePercent).not.toBe(0);
  });

  // ─── Тест 5: Отрицательная целевая доля → ошибка ───
  it('должна выбрасывать ошибку для отрицательной целевой доли', () => {
    const assets = [createAsset('TEST', -5)];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('TEST');
    expect(result.errors[0]).toContain('-5');
  });

  // ─── Тест 6: Целевая доля > 100% → ошибка ───
  it('должна выбрасывать ошибку для целевой доли > 100%', () => {
    const assets = [createAsset('TEST', 150)];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(false);
    // 2 ошибки: доля > 100% и сумма > 100%
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((e) => e.includes('TEST') && e.includes('150'))).toBe(true);
  });

  // ─── Тест 7: Сумма целевых долей > 100% → ошибка ───
  it('должна выбрасывать ошибку когда сумма > 100%', () => {
    const assets = [
      createAsset('A', 60),
      createAsset('B', 50),
    ];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('> 100%');
  });

  // ─── Тест 8: Отрицательный кэш-резерв → предупреждение ───
  it('должна выдавать предупреждение при отрицательном кэш-резерве', () => {
    const assets = [
      createAsset('A', 60),
      createAsset('B', 55),
    ];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(false); // ошибка из-за суммы > 100%
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('отрицательный');
    expect(result.cashReservePercent).toBe(-15);
  });

  // ─── Тест 9: Актив с undefined targetPercent не учитывается ───
  it('должна игнорировать активы без targetPercent (undefined)', () => {
    const assets = [
      createAsset('WITH_TARGET', 30),
      {
        ...createAsset('NO_TARGET', 0),
        targetPercent: undefined,
      } as AggregatedAsset,
    ];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(true);
    expect(result.totalTargetPercent).toBe(30);
    expect(result.cashReservePercent).toBe(70);
  });

  // ─── Тест 10: Пустой массив активов ───
  it('должна корректно обрабатывать пустой массив активов', () => {
    const assets: AggregatedAsset[] = [];
    const result = validateTargetPercentages(assets);

    expect(result.isValid).toBe(true);
    expect(result.totalTargetPercent).toBe(0);
    expect(result.cashReservePercent).toBe(100);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
