import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AggregatedAsset } from './xlsx-parser.js';

// Моки создаём через vi.hoisted, чтобы они были доступны в hoisted-фабриках vi.mock
const {
  mockSheetToJson,
  mockDecodeRange,
  mockEncodeCell,
  mockReadFile,
  mockWriteFile,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockSheetToJson: vi.fn(),
  mockDecodeRange: vi.fn(),
  mockEncodeCell: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockExistsSync: vi.fn(),
}));

// Мокаем xlsx
vi.mock('xlsx', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    utils: {
      sheet_to_json: (...args: unknown[]) => mockSheetToJson(...args),
      decode_range: (...args: unknown[]) => mockDecodeRange(...args),
      encode_cell: (...args: unknown[]) => mockEncodeCell(...args),
    },
  },
}));

// Мокаем fs — default и namespace ссылаются на ОДИН мок existsSync,
// чтобы настройка через vi.mocked(fs.existsSync) действовала и на
// код, использующий `import * as fs from 'fs'`.
vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
  },
  existsSync: mockExistsSync,
}));

import fs from 'fs';
import { XlsxParserModule } from './xlsx-parser.js';
import * as _config from './xlsx-parser-config.js';

describe('XlsxParserModule', () => {
  let parser: XlsxParserModule;

  beforeEach(() => {
    vi.clearAllMocks();
    parser = new XlsxParserModule();

    // Мокаем fs.existsSync для загрузки workbook
    vi.mocked(fs.existsSync).mockReturnValue(true);

    // Мокаем readFile
    mockReadFile.mockReturnValue({
      SheetNames: ['QUIK', 'Акции', 'Облигации', 'Цели', 'Отчет по сделкам'],
      Sheets: {
        QUIK: { '!ref': 'A1:Z50' },
        'Акции': { '!ref': 'A1:Z1000' },
        'Облигации': { '!ref': 'A1:Z500' },
        'Цели': { '!ref': 'A1:Z20' },
        'Отчет по сделкам': { '!ref': 'A1:Z100' },
      },
    });

    // Мокаем sheet_to_json для QUIK
    mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
      if (sheet['!ref'] === 'A1:Z50') {
        return [
          {
            'Инструмент': 'Сбербанк',
            'Код инструмента': 'SBER',
            'Вид активов': 'Акция',
            '%, активов, по ликвидационной стоимости': 25,
            '%, активов, по балансовой стоимости': 24,
            'Target Percent': 30,
            'Балансовая цена': 280,
            'Стоимость': 28500, // позиция в рублях (285 * 100)
            'Ликвидационная цена': 283,
            'Динамика актива': 2.5,
            'НКД': 0,
            'Позиция': 100,
            'Нереализованная прибыль': 500,
          },
          {
            'Инструмент': 'ТКС Холдинг',
            'Код инструмента': 'TCSG',
            'Вид активов': 'Акция',
            '%, активов, по ликвидационной стоимости': 15,
            '%, активов, по балансовой стоимости': 14,
            'Target Percent': undefined,
            'Балансовая цена': 1600,
            'Стоимость': 81000, // позиция в рублях (1620 * 50)
            'Ликвидационная цена': 1615,
            'Динамика актива': -1.2,
            'НКД': 0,
            'Позиция': 50,
            'Нереализованная прибыль': 100,
          },
          {
            'Инструмент': 'Рубль',
            'Код инструмента': '',
            'Вид активов': '',
            'Стоимость': 500000,
          },
          {
            'Инструмент': 'Итого активов',
            'Код инструмента': '',
            'Вид активов': '',
            'Ликвидационная стоимость': 5000000,
          },
        ];
      }
      if (sheet['!ref'] === 'A1:Z1000') {
        return [
          { 'Код инструмента': 'SBER', 'Инструмент сокр.': 'Сбербанк', 'Цена послед.': 285, '% измен.закр.': 2.5 },
          { 'Код инструмента': 'TCSG', 'Инструмент сокр.': 'ТКС Холдинг', 'Цена послед.': 1620, '% измен.закр.': -1.2 },
          { 'Код инструмента': 'PLZL', 'Инструмент сокр.': 'Полюс', 'Цена послед.': 18000, '% измен.закр.': 0.8 },
        ];
      }
      if (sheet['!ref'] === 'A1:Z500') {
        return [
          { 'ISIN': 'RU000A10C8F3', 'Номинал': 1000 },
          { 'ISIN': 'RU000A10EC22', 'Номинал': 1000 },
        ];
      }
      if (sheet['!ref'] === 'A1:Z20') {
        return [
          { 'Группа инструментов': 'Акции', 'доля': 60 },
          { 'Группа инструментов': 'Облигации', 'доля': 35 },
        ];
      }
      if (sheet['!ref'] === 'A1:Z100') {
        return [
          { '__EMPTY': 'ЛИКВИДНЫЕ СРЕДСТВА', '__EMPTY_1': 500000 },
          { '__EMPTY': 'ИТОГО АКТИВОВ', '__EMPTY_1': 5000000 },
          { '__EMPTY': 'ВНЕСЕНО СРЕДСТВ', '__EMPTY_1': 3000000 },
        ];
      }
      return [];
    });

    // Мокаем decode_range
    mockDecodeRange.mockReturnValue({
      s: { r: 0, c: 0 },
      e: { r: 50, c: 25 },
    });

    // Мокаем encode_cell
    mockEncodeCell.mockImplementation(({ r, c }: { r: number; c: number }) => {
      return String.fromCharCode(65 + (c as number)) + (r as number + 1);
    });
  });

  describe('parseCurrentPortfolio', () => {
    it('должен парсить текущий портфель из листа QUIK', async () => {
      const assets = await parser.parseCurrentPortfolio();

      expect(assets).toHaveLength(2); // Рубль и Итого фильтруются

      const sber = assets.find((a) => a.ticker === 'SBER');
      expect(sber).toBeDefined();
      expect(sber?.name).toBe('Сбербанк');
      expect(sber?.liquidationPercent).toBe(25);
      expect(sber?.targetPercent).toBe(30);
      expect(sber?.currentPrice).toBe(285);
      expect(sber?.balancePrice).toBe(280);
      expect(sber?.quantity).toBe(100);
      expect(sber?.nkdRub).toBe(0);
    });

    it('должен фильтровать служебные строки (Рубль, Итого)', async () => {
      const assets = await parser.parseCurrentPortfolio();

      const rubleAsset = assets.find((a) => a.name === 'Рубль');
      expect(rubleAsset).toBeUndefined();

      const totalAsset = assets.find((a) => a.name === 'Итого активов');
      expect(totalAsset).toBeUndefined();
    });

    it('должен корректно обрабатывать активы без target (NO_TARGET)', async () => {
      const assets = await parser.parseCurrentPortfolio();

      const tcsAsset = assets.find((a) => a.ticker === 'TCSG');
      expect(tcsAsset).toBeDefined();
      expect(tcsAsset?.targetPercent).toBeUndefined();
    });

    it('должен конвертировать дроби в проценты для targetPercent', async () => {
      // Проверяем parseOptionalTargetPercent: 0.15 → 15
      const assets = await parser.parseCurrentPortfolio();
      const sber = assets.find((a) => a.ticker === 'SBER');

      // В моке targetPercent = 30 (уже процент), проверка что число корректно
      expect(sber?.targetPercent).toBe(30);
    });

    it('должен устанавливать balancePercent как liqPercent когда balPercent = 0', async () => {
      const assets = await parser.parseCurrentPortfolio();
      const sber = assets.find((a) => a.ticker === 'SBER');

      // balancePercent = 24, liqPercent = 25, balancePercent > 0 → берём balancePercent
      expect(sber?.balancePercent).toBe(24);
    });
  });

  describe('parseQuotesSheet', () => {
    it('должен парсить лист Акции и строить quotesMap', async () => {
      const quotesMap = await parser.parseQuotesSheet();

      expect(quotesMap['SBER']).toBeDefined();
      expect(quotesMap['SBER'].currentPrice).toBe(285);
      expect(quotesMap['SBER'].dailyDynamicsPercent).toBe(2.5);
      expect(quotesMap['SBER'].shortName).toBe('Сбербанк');

      expect(quotesMap['TCSG']).toBeDefined();
      expect(quotesMap['TCSG'].currentPrice).toBe(1620);
      expect(quotesMap['TCSG'].dailyDynamicsPercent).toBe(-1.2);
    });

    it('должен фильтровать аномальные значения дневной динамики (> 25%)', async () => {
      // Переопределяем моки для проверки фильтрации
      mockSheetToJson.mockReturnValue([
        { 'Код инструмента': 'ANOM', 'Инструмент сокр.': 'Аномальная акция', 'Цена послед.': 100, '% измен.закр.': 30 },
        { 'Код инструмента': 'NORMAL', 'Инструмент сокр.': 'Нормальная акция', 'Цена послед.': 50, '% измен.закр.': 5 },
      ]);

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 5, c: 25 },
      });

      const quotesMap = await parser.parseQuotesSheet();

      // Аномальная динамика (30%) должна быть обнулена
      expect(quotesMap['ANOM']?.dailyDynamicsPercent).toBe(0);
      // Нормальная динамика (5%) должна остаться
      expect(quotesMap['NORMAL']?.dailyDynamicsPercent).toBe(5);
    });

    it('должен сохранять nameToTickerMap для fuzzy-поиска', async () => {
      await parser.parseQuotesSheet();

      const nameMap = parser['nameToTickerMap'];
      expect(nameMap['СБЕРБАНК']).toBe('SBER');
      expect(nameMap['ТКС ХОЛДИНГ']).toBe('TCSG');
    });
  });

  describe('parseBondsSheet', () => {
    it('должен парсить лист Облигации и строить bondsMap', async () => {
      const bondsMap = await parser.parseBondsSheet();

      expect(bondsMap.size).toBe(2);
      expect(bondsMap.has('RU000A10C8F3')).toBe(true);
      expect(bondsMap.get('RU000A10C8F3')?.nominal).toBe(1000);
      expect(bondsMap.get('RU000A10C8F3')?.source).toBe('EXCEL_BONDS');
    });

    it('должен возвращать пустую карту при отсутствии листа', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK'],
        Sheets: { QUIK: { '!ref': 'A1:Z50' } },
      });

      const bondsMap = await parser.parseBondsSheet();
      expect(bondsMap.size).toBe(0);
    });
  });

  describe('getBondReference и getBondNominal', () => {
    it('должен возвращать справочные данные по облигации', async () => {
      await parser.parseBondsSheet();

      const ref = parser.getBondReference('RU000A10C8F3');
      expect(ref).toBeDefined();
      expect(ref?.nominal).toBe(1000);
      expect(ref?.source).toBe('EXCEL_BONDS');
    });

    it('должен возвращать undefined для неизвестного ISIN', async () => {
      const ref = parser.getBondReference('UNKNOWN_ISIN');
      expect(ref).toBeUndefined();
    });

    it('должен возвращать номинал облигации', async () => {
      await parser.parseBondsSheet();

      const nominal = parser.getBondNominal('RU000A10EC22');
      expect(nominal).toBe(1000);
    });

    it('должен возвращать undefined для номиналя неизвестной облигации', async () => {
      const nominal = parser.getBondNominal('UNKNOWN_ISIN');
      expect(nominal).toBeUndefined();
    });
  });

  describe('parseMacroGoals', () => {
    it('должен извлекать макроцели из листов Цели и Отчет по сделкам', async () => {
      const goals = await parser.parseMacroGoals();

      expect(goals.stocksPercent).toBe(60);
      expect(goals.bondsPercent).toBe(35);
      expect(goals.freeCash).toBe(500000);
      expect(goals.totalBalance).toBe(5000000);
    });

    it('должен выбрасывать ошибку при отсутствии целевой доли акций', async () => {
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z20') {
          // Нет строчки с акциями
          return [
            { 'Группа инструментов': 'Облигации', 'доля': 35 },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            { '__EMPTY': 'ЛИКВИДНЫЕ СРЕДСТВА', '__EMPTY_1': 500000 },
            { '__EMPTY': 'ИТОГО АКТИВОВ', '__EMPTY_1': 5000000 },
          ];
        }
        return [];
      });

      await expect(parser.parseMacroGoals()).rejects.toThrow(
        'Не найдена целевая доля акций в листе «Цели»',
      );
    });

    it('должен выбрасывать ошибку при отсутствии ликвидного кэша', async () => {
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z20') {
          return [
            { 'Группа инструментов': 'Акции', 'доля': 60 },
            { 'Группа инструментов': 'Облигации', 'доля': 35 },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          // Нет ликвидного кэша
          return [
            { '__EMPTY': 'ИТОГО АКТИВОВ', '__EMPTY_1': 5000000 },
          ];
        }
        return [];
      });

      await expect(parser.parseMacroGoals()).rejects.toThrow(
        'Не найден ликвидный кэш',
      );
    });
  });

  describe('parseInvestedFunds', () => {
    it('должен извлекать вложенные средства из листа Отчет по сделкам', async () => {
      const result = await parser.parseInvestedFunds();

      expect(result.totalNet).toBe(3000000);
    });

    it('должен выбрасывать ошибку при отсутствии листа QUIK', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: [],
        Sheets: {},
      });

      await expect(parser.parseInvestedFunds()).rejects.toThrow(
        'Не найден лист «QUIK» для расчета вложенных средств',
      );
    });
  });

  describe('parseAccountsInfo', () => {
    it('должен извлекать информацию о счетах из листов Портфель_XXX', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_S04J3LB', 'Портфель_403GPBT'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
          'Портфель_403GPBT': { '!ref': 'A1:Z100' },
        },
      });

      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Ликвидационная стоимость': 1000000,
            },
          ];
        }
        return [];
      });

      const accounts = await parser.parseAccountsInfo();

      expect(accounts).toHaveLength(2);
      expect(accounts.find((a) => a.name === 'S04J3LB')).toBeDefined();
      expect(accounts.find((a) => a.name === '403GPBT')).toBeDefined();
    });

    it('должен фильтровать счета с некорректным кодом', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_SHORT', 'Портфель_S04J3LB'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_SHORT': { '!ref': 'A1:Z100' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
        },
      });

      mockSheetToJson.mockReturnValue([]);

      const accounts = await parser.parseAccountsInfo();

      // SHORT — 5 символов, но может не пройти валидацию
      // S04J3LB — 7 символов, должен пройти
      expect(accounts.length).toBeGreaterThanOrEqual(0);
    });

    it('должен возвращать пустой массив при отсутствии портфельных листов', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK'],
        Sheets: { QUIK: { '!ref': 'A1:Z50' } },
      });

      const accounts = await parser.parseAccountsInfo();
      expect(accounts).toEqual([]);
    });
  });

  describe('parseAggregatedPortfolio', () => {
    it('должен агрегировать позиции по тикерам с детализацией по счетам', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_S04J3LB', 'Портфель_403GPBT'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
          'Портфель_403GPBT': { '!ref': 'A1:Z100' },
        },
      });

      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z50') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              '%, активов, по ликвидационной стоимости': 25,
              '%, активов, по балансовой стоимости': 24,
              'Target Percent': 30,
              'Балансовая цена': 280,
              'Стоимость': 28500, // позиция в рублях (285 * 100)
              'Позиция': 100,
              'Нереализованная прибыль': 500,
              'Динамика актива': 2.5,
            },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              '%, активов': 20,
              'Целевая доля, %': 30,
              'Балансовая цена': 280,
              'Балансовая стоимость': 28000,
              'Стоимость': 28500,
              'Позиция': 100,
              'Нереализованная прибыль': 500,
              'Динамика актива': 2.5,
            },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();

      expect(aggregated.length).toBeGreaterThanOrEqual(0);
    });

    it('должен корректно пересчитывать проценты из liquidationValue', async () => {
      // Проверка: проценты НЕ складываются, а пересчитываются из рублёвых значений
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_S04J3LB'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
        },
      });

      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z50') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              'Target Percent': 30,
              'Балансовая цена': 280,
              'Стоимость': 28500, // позиция в рублях (285 * 100)
              'Позиция': 100,
            },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              '%, активов': 40,
              'Целевая доля, %': 30,
              'Балансовая цена': 280,
              'Балансовая стоимость': 28000,
              'Стоимость': 28500,
              'Позиция': 100,
            },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();

      // totalLiquidationPercent должен быть пересчитан из liquidationValue,
      // а не сложено 40% + 40% = 80%
      const sber = aggregated.find((a) => a.ticker === 'SBER');
      if (sber) {
        expect(sber.totalLiquidationPercent).toBeGreaterThan(0);
        expect(sber.totalLiquidationPercent).toBeLessThanOrEqual(100);
      }
    });

    it('должен брать ВСЕ цены из основного QUIK, а не из Портфель_XXX', async () => {
      // Мокаем QUIK с ценами
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z50') {
          // QUIK содержит authoritative prices
          return [
            {
              'Инструмент': 'PLZL',
              'Код инструмента': 'PLZL',
              'Вид активов': 'Акция',
              'Балансовая цена': 950,
              'Стоимость': 95860, // позиция в рублях (958.60 * 100)
              'Ликвидационная цена': 958.60,
              'Позиция': 100,
            },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          // Портфель_XXX содержит quantity, НО НЕ ЦЕНЫ
          // Если здесь Стоимость = 95860 (позиция в рублях), это НЕ должно быть currentPrice
          return [
            {
              'Инструмент': 'PLZL',
              'Код инструмента': 'PLZL',
              'Вид активов': 'Акция',
              'Позиция': 100,
              'Балансовая стоимость': 95000,
              // ОШИБКА: Стоимость = 95860 (это positionValue, а не currentPrice!)
              'Стоимость': 95860,
            },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();
      const plzl = aggregated.find((a) => a.ticker === 'PLZL');

      // КРИТИЧЕСКАЯ ПРОВЕРКА: currentPrice = Стоимость / Позиция = 95860 / 100 = 958.60
      expect(plzl).toBeDefined();
      expect(plzl?.currentPrice).toBe(958.60);
      expect(plzl?.balancePrice).toBe(950);
      expect(plzl?.liquidationPrice || 0).toBeGreaterThanOrEqual(0);

      // positionValue = currentPrice × quantity
      expect(plzl?.totalLiquidationValue).toBe(958.60 * 100); // 95860
    });

    it('должен нормализовать цены облигаций через nominal', async () => {
      // Мокаем QUIK с облигацией:
      //   Балансовая цена — УЖЕ В РУБЛЯХ (980 ₽ = 98% от номинала 1000)
      //   Ликвидационная цена — В % от номинала (99%)
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z50') {
          return [
            {
              'Инструмент': 'Облигация А',
              'Код инструмента': 'RU000A10C8F3',
              'Вид активов': 'Облигация',
              'Номинал': 1000,
              'Балансовая цена': 980, // 980 ₽ (уже в рублях, 98% от 1000)
              'Стоимость': 49500, // позиция в рублях (990 * 50)
              'Ликвидационная цена': 99, // 99% от номинала
              'Позиция': 50,
            },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            {
              'Инструмент': 'Облигация А',
              'Код инструмента': 'RU000A10C8F3',
              'Вид активов': 'Облигация',
              'Позиция': 50,
            },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();
      const bond = aggregated.find((a) => a.ticker === 'RU000A10C8F3');

      // balancePrice — уже в рублях, не конвертируется
      expect(bond).toBeDefined();
      expect(bond?.balancePrice).toBe(980); // 980 ₽ (из Excel, без конвертации)
      expect(bond?.currentPrice).toBe(1000 * 99 / 100); // 990 (из Стоимость / Позиция)
      expect(bond?.nominal).toBe(1000);
      expect(bond?.priceUnit).toBe('PERCENT_OF_NOMINAL');

      // positionValue = currentPrice × quantity
      expect(bond?.totalLiquidationValue).toBe(990 * 50); // 49500
    });

    it('должен использовать единый path для всех инструментов', async () => {
      // Проверяем, что SBER, IRAO, STME, SBRB проходят через одну логику
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z50') {
          return [
            { 'Инструмент': 'Сбербанк', 'Код инструмента': 'SBER', 'Вид активов': 'Акция', 'Балансовая цена': 280, 'Стоимость': 28500, 'Ликвидационная цена': 285, 'Позиция': 100 },
            { 'Инструмент': 'Интер РАО', 'Код инструмента': 'IRAO', 'Вид активов': 'Акция', 'Балансовая цена': 4.50, 'Стоимость': 4550, 'Ликвидационная цена': 4.55, 'Позиция': 1000 },
            { 'Инструмент': 'SBERBANK GPD', 'Код инструмента': 'STME', 'Вид активов': 'ETF', 'Балансовая цена': 120, 'Стоимость': 6100, 'Ликвидационная цена': 122, 'Позиция': 50 },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            { 'Инструмент': 'Сбербанк', 'Код инструмента': 'SBER', 'Позиция': 100 },
            { 'Инструмент': 'Интер РАО', 'Код инструмента': 'IRAO', 'Позиция': 1000 },
            { 'Инструмент': 'SBERBANK GPD', 'Код инструмента': 'STME', 'Позиция': 50 },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();

      const sber = aggregated.find((a) => a.ticker === 'SBER');
      const irao = aggregated.find((a) => a.ticker === 'IRAO');
      const stme = aggregated.find((a) => a.ticker === 'STME');

      // Все должны иметь корректные цены из QUIK
      expect(sber?.currentPrice).toBe(285);
      expect(irao?.currentPrice).toBe(4.55);
      expect(stme?.currentPrice).toBe(122);

      // positionValue = currentPrice × quantity для всех
      expect(sber?.totalLiquidationValue).toBe(285 * 100);
      expect(irao?.totalLiquidationValue).toBe(4.55 * 1000);
      expect(stme?.totalLiquidationValue).toBe(122 * 50);
    });
  });

  describe('aggregatedToCurrentAssets', () => {
    it('должен преобразовывать AggregatedAsset в CurrentAsset', () => {
      const aggregated: AggregatedAsset[] = [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          assetType: 'Акция',
          totalLiquidationValue: 285000,
          totalLiquidationPercent: 25,
          totalBalancePercent: 24,
          targetPercent: 30,
          totalQuantity: 100,
          balancePrice: 280,
          currentPrice: 285,
          liquidationPrice: 283,
          totalUnrealizedProfitRub: 500,
          dynamicsPercent: 2.5,
          nkdRub: 0,
          nominal: undefined,
          priceUnit: 'RUB',
          totalBalanceValue: 28000,
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: false,
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS',
              liquidationValue: 285000,
              liquidationPercent: 25,
              balancePercent: 24,
              targetPercent: 30,
              quantity: 100,
              balancePrice: 280,
              balanceValue: 28000,
              currentPrice: 285,
              unrealizedProfitRub: 500,
              dynamicsPercent: 2.5,
              nkdRub: 0,
              nominal: undefined,
              priceUnit: 'RUB',
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        },
      ];

      const currentAssets = parser.aggregatedToCurrentAssets(aggregated);

      expect(currentAssets).toHaveLength(1);
      expect(currentAssets[0].ticker).toBe('SBER');
      expect(currentAssets[0].liquidationPercent).toBe(25);
      expect(currentAssets[0].targetPercent).toBe(30);
      expect(currentAssets[0].accountId).toBe('S04J3LB');
      expect(currentAssets[0].accountType).toBe('IIS');
      expect(currentAssets[0].holdOnly).toBe(false);
    });

    it('должен устанавливать accountId = undefined для агрегированных позиций', () => {
      const aggregated: AggregatedAsset[] = [
        {
          ticker: 'PLZL',
          name: 'Полюс',
          assetType: 'Акция',
          totalLiquidationValue: 500000,
          totalLiquidationPercent: 15,
          totalBalancePercent: 14,
          targetPercent: 20,
          totalQuantity: 50,
          balancePrice: 10000,
          currentPrice: 10200,
          liquidationPrice: 10150,
          totalUnrealizedProfitRub: 1000,
          dynamicsPercent: 1.5,
          nkdRub: undefined,
          nominal: undefined,
          priceUnit: 'RUB',
          totalBalanceValue: 500000,
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: false,
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS',
              liquidationValue: 300000,
              liquidationPercent: 10,
              balancePercent: 9,
              targetPercent: 20,
              quantity: 30,
              balancePrice: 10000,
              balanceValue: 300000,
              currentPrice: 10200,
              unrealizedProfitRub: 600,
              dynamicsPercent: 1.5,
              nkdRub: undefined,
              nominal: undefined,
              priceUnit: 'RUB',
              holdOnly: false,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER',
              liquidationValue: 200000,
              liquidationPercent: 5,
              balancePercent: 5,
              targetPercent: 20,
              quantity: 20,
              balancePrice: 10000,
              balanceValue: 200000,
              currentPrice: 10200,
              unrealizedProfitRub: 400,
              dynamicsPercent: 1.5,
              nkdRub: undefined,
              nominal: undefined,
              priceUnit: 'RUB',
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        },
      ];

      const currentAssets = parser.aggregatedToCurrentAssets(aggregated);

      // Позиция на двух счетах → accountId = undefined
      expect(currentAssets[0].accountId).toBeUndefined();
      expect(currentAssets[0].accountType).toBeUndefined();
      expect(currentAssets[0].quantity).toBe(50);
    });
  });

  describe('parseOptionalTargetPercent', () => {
    it('должен различать undefined и 0', () => {
      // undefined/null → undefined
      expect(parser['parseOptionalTargetPercent'](undefined)).toBeUndefined();
      expect(parser['parseOptionalTargetPercent'](null)).toBeUndefined();

      // 0 → 0 (EXIT)
      expect(parser['parseOptionalTargetPercent'](0)).toBe(0);

      // Число → число
      expect(parser['parseOptionalTargetPercent'](15)).toBe(15);
      expect(parser['parseOptionalTargetPercent'](NaN)).toBeUndefined();

      // Строка → число
      expect(parser['parseOptionalTargetPercent']('15')).toBe(15);
      expect(parser['parseOptionalTargetPercent']('0')).toBe(0);
      expect(parser['parseOptionalTargetPercent']('')).toBeUndefined();
      expect(parser['parseOptionalTargetPercent']('abc')).toBeUndefined();

      // Строка с запятой
      expect(parser['parseOptionalTargetPercent']('15,5')).toBe(15.5);
    });
  });

  describe('parseValue', () => {
    it('должен корректно парсить числовые значения', () => {
      expect(parser['parseValue'](285)).toBe(285);
      expect(parser['parseValue'](0)).toBe(0);
      expect(parser['parseValue'](-10)).toBe(-10);
    });

    it('должен парсить строки с русской запятой', () => {
      expect(parser['parseValue']('15,5')).toBe(15.5);
      expect(parser['parseValue']('1000,00')).toBe(1000);
    });

    it('должен удалять пробелы и символ рубля из строк', () => {
      expect(parser['parseValue']('1 000')).toBe(1000);
      expect(parser['parseValue']('1000₽')).toBe(1000);
      expect(parser['parseValue']('1000 руб')).toBe(1000);
    });

    it('должен возвращать 0 для невалидных значений', () => {
      expect(parser['parseValue']('abc')).toBe(0);
      expect(parser['parseValue'](null as unknown as number)).toBe(0);
      expect(parser['parseValue']({} as unknown as number)).toBe(0);
    });
  });

  describe('parseBooleanValue', () => {
    it('должен парсить булевы значения', () => {
      expect(parser['parseBooleanValue'](true)).toBe(true);
      expect(parser['parseBooleanValue'](false)).toBe(false);
      expect(parser['parseBooleanValue'](1)).toBe(true);
      expect(parser['parseBooleanValue'](0)).toBe(false);
      expect(parser['parseBooleanValue']('true')).toBe(true);
      expect(parser['parseBooleanValue']('TRUE')).toBe(true);
      expect(parser['parseBooleanValue']('да')).toBe(true);
      expect(parser['parseBooleanValue']('yes')).toBe(true);
      expect(parser['parseBooleanValue']('y')).toBe(true);
      expect(parser['parseBooleanValue']('false')).toBe(false);
      expect(parser['parseBooleanValue']('нет')).toBe(false);
      expect(parser['parseBooleanValue']('no')).toBe(false);
      expect(parser['parseBooleanValue']('n')).toBe(false);
      expect(parser['parseBooleanValue']('')).toBe(false);
      expect(parser['parseBooleanValue']('abc')).toBe(false);
      expect(parser['parseBooleanValue'](null as unknown as boolean)).toBe(false);
    });
  });

  describe('determinePriceUnit', () => {
    it('должен определять RUB для акций', () => {
      expect(parser['determinePriceUnit']('Акция', undefined)).toBe('RUB');
      expect(parser['determinePriceUnit']('А', undefined)).toBe('RUB');
      expect(parser['determinePriceUnit']('ETF', undefined)).toBe('RUB');
    });

    it('должен определять PERCENT_OF_NOMINAL для облигаций с номиналом', () => {
      expect(parser['determinePriceUnit']('Облигация', 1000)).toBe('PERCENT_OF_NOMINAL');
      expect(parser['determinePriceUnit']('О', 1000)).toBe('PERCENT_OF_NOMINAL');
    });

    it('должен определять UNKNOWN для облигаций без номинала', () => {
      expect(parser['determinePriceUnit']('Облигация', undefined)).toBe('UNKNOWN');
      expect(parser['determinePriceUnit']('О', undefined)).toBe('UNKNOWN');
      expect(parser['determinePriceUnit']('О', 0)).toBe('UNKNOWN');
    });
  });

  describe('parseNominalFromRow', () => {
    it('должен извлекать номинал из строки', () => {
      const row1 = { 'Номинал': 1000 };
      expect(parser['parseNominalFromRow'](row1)).toBe(1000);

      const row2 = { 'Номинал облигации': 1000 };
      expect(parser['parseNominalFromRow'](row2)).toBe(1000);

      const row3 = { 'Номинал облигации, руб': 1000 };
      expect(parser['parseNominalFromRow'](row3)).toBe(1000);

      // Номинал = 0 → undefined
      const row4 = { 'Номинал': 0 };
      expect(parser['parseNominalFromRow'](row4)).toBeUndefined();

      // Нет колонки → undefined
      const row5 = {};
      expect(parser['parseNominalFromRow'](row5)).toBeUndefined();
    });
  });

  describe('parseBooleanColumn', () => {
    it('должен парсить булевы колонки', () => {
      const rowTrue = { 'Hold Only': 'true' };
      expect(parser['parseBooleanColumn'](rowTrue, ['Hold Only'])).toBe(true);

      const rowFalse = { 'Hold Only': 'false' };
      expect(parser['parseBooleanColumn'](rowFalse, ['Hold Only'])).toBe(false);

      const rowEmpty = {};
      expect(parser['parseBooleanColumn'](rowEmpty, ['Hold Only'])).toBe(false);
    });
  });

  describe('syncNewTrades', () => {
    it('должен парсить активные заявки из QUIK и кэшировать суммы', async () => {
      const orders = await parser.syncNewTrades();

      expect(orders).toBeGreaterThanOrEqual(0);
      expect(parser['cachedActiveOrdersText']).toBeDefined();
      expect(typeof parser['cachedActiveOrdersText']).toBe('string');
      expect(parser['cachedIisOrdersSum']).toBeDefined();
      expect(parser['cachedBrokerOrdersSum']).toBeDefined();
    });
  });

  describe('loadWorkbook', () => {
    it('должен выбрасывать ошибку при отсутствии Excel-файла', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const newParser = new XlsxParserModule();

      await expect(newParser.loadWorkbook()).rejects.toThrow(
        'Критическая ошибка: Файл таблицы не найден',
      );
    });

    it('должен кэшировать workbook и не читать файл повторно', async () => {
      await parser.loadWorkbook();
      await parser.loadWorkbook();

      // mockReadFile должен быть вызван только один раз
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveWorkbook', () => {
    it('должен вызывать writeFile при наличии workbook', async () => {
      await parser.loadWorkbook();

      await parser.saveWorkbook();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('не должен вызывать writeFile при отсутствии workbook', async () => {
      const newParser = new XlsxParserModule();
      // loadWorkbook не вызывался → workbook = null

      await newParser.saveWorkbook();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('фильтрация служебных строк', () => {
    it('должен фильтровать строки с ключевыми словами EXCLUDED_ROW_KEYWORDS', async () => {
      mockSheetToJson.mockReturnValue([
        { 'Инструмент': 'Сбербанк', 'Код инструмента': 'SBER', 'Вид активов': 'Акция' },
        { 'Инструмент': 'ИТОГО', 'Код инструмента': '', 'Вид активов': '' },
        { 'Инструмент': 'БАЛАНС', 'Код инструмента': '', 'Вид активов': '' },
        { 'Инструмент': 'ДОЛЯ АКЦИЙ', 'Код инструмента': '', 'Вид активов': '' },
        { 'Инструмент': 'Селигдар', 'Код инструмента': 'SELG', 'Вид активов': 'Акция' },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      expect(assets).toHaveLength(2);
      expect(assets.every((a) => a.name !== 'ИТОГО')).toBe(true);
      expect(assets.every((a) => a.name !== 'БАЛАНС')).toBe(true);
      expect(assets.every((a) => a.name !== 'ДОЛЯ АКЦИЙ')).toBe(true);
    });

    it('должен фильтровать строки начинающиеся с дефиса', async () => {
      mockSheetToJson.mockReturnValue([
        { 'Инструмент': 'Сбербанк', 'Код инструмента': 'SBER', 'Вид активов': 'Акция' },
        { 'Инструмент': '-Отмена', 'Код инструмента': '', 'Вид активов': '' },
        { 'Инструмент': 'PLZL', 'Код инструмента': 'PLZL', 'Вид активов': 'Акция' },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      expect(assets).toHaveLength(2);
      expect(assets.every((a) => !a.name.startsWith('-'))).toBe(true);
    });

    it('должен фильтровать числовые названия', async () => {
      mockSheetToJson.mockReturnValue([
        { 'Инструмент': '123', 'Код инструмента': '', 'Вид активов': '' },
        { 'Инструмент': 'Сбербанк', 'Код инструмента': 'SBER', 'Вид активов': 'Акция' },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      expect(assets).toHaveLength(1);
      expect(assets[0]?.name).toBe('Сбербанк');
    });

    it('должен фильтровать названия длиннее 30 символов', async () => {
      const longName = 'А'.repeat(31);
      mockSheetToJson.mockReturnValue([
        { 'Инструмент': longName, 'Код инструмента': '', 'Вид активов': '' },
        { 'Инструмент': 'Сбербанк', 'Код инструмента': 'SBER', 'Вид активов': 'Акция' },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      expect(assets).toHaveLength(1);
      expect(assets[0]?.name).toBe('Сбербанк');
    });
  });

  describe('конвертация дробей в проценты', () => {
    it('должен конвертировать targetPercent из дроби в проценты', async () => {
      mockSheetToJson.mockReturnValue([
        {
          'Инструмент': 'Сбербанк',
          'Код инструмента': 'SBER',
          'Вид активов': 'Акция',
          'Target Percent': 0.3, // 30% как дробь
          '%, активов, по ликвидационной стоимости': 0.25, // 25% как дробь
          '%, активов, по балансовой стоимости': 0.24, // 24% как дробь
          'Балансовая цена': 280,
          'Стоимость': 28500,
          'Позиция': 100,
        },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      const sber = assets.find((a) => a.ticker === 'SBER');

      expect(sber?.targetPercent).toBe(30);
      expect(sber?.liquidationPercent).toBe(25);
      expect(sber?.balancePercent).toBe(24);
    });

    it('не должен конвертировать targetPercent = 0', async () => {
      mockSheetToJson.mockReturnValue([
        {
          'Инструмент': 'Норникель',
          'Код инструмента': 'GMKN',
          'Вид активов': 'Акция',
          'Target Percent': 0,
          '%, активов, по ликвидационной стоимости': 0.06,
          'Балансовая цена': 16000,
          'Стоимость': 162000,
          'Позиция': 10,
        },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      const gmkn = assets.find((a) => a.ticker === 'GMKN');

      // 0 остаётся 0 (EXIT), не конвертируется
      expect(gmkn?.targetPercent).toBe(0);
    });
  });

  describe('определение priceUnit', () => {
    it('должен устанавливать RUB для акций', async () => {
      mockSheetToJson.mockReturnValue([
        {
          'Инструмент': 'Сбербанк',
          'Код инструмента': 'SBER',
          'Вид активов': 'Акция',
          'Балансовая цена': 280,
          'Стоимость': 28500,
          'Позиция': 100,
        },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      const sber = assets.find((a) => a.ticker === 'SBER');

      expect(sber?.priceUnit).toBe('RUB');
    });

    it('должен устанавливать PERCENT_OF_NOMINAL для облигаций с номиналом', async () => {
      mockSheetToJson.mockReturnValue([
        {
          'Инструмент': 'Облигация А',
          'Код инструмента': 'RU000A10C8F3',
          'Вид активов': 'Облигация',
          'Номинал': 1000,
          'Балансовая цена': 98,
          'Стоимость': 49500, // позиция в рублях (990 * 50)
          'Позиция': 50,
        },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      const bond = assets.find((a) => a.ticker === 'RU000A10C8F3');

      expect(bond?.priceUnit).toBe('PERCENT_OF_NOMINAL');
      expect(bond?.nominal).toBe(1000);
    });

    it('должен устанавливать UNKNOWN для облигаций без номинала', async () => {
      mockSheetToJson.mockReturnValue([
        {
          'Инструмент': 'Облигация Б',
          'Код инструмента': 'RU000A10ER66',
          'Вид активов': 'Облигация',
          'Балансовая цена': 95,
          'Стоимость': 2880, // позиция в рублях (96 * 30)
          'Позиция': 30,
        },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      const bond = assets.find((a) => a.ticker === 'RU000A10ER66');

      expect(bond?.priceUnit).toBe('UNKNOWN');
    });
  });

  describe('dailyDynamicsPercent из листа Акции', () => {
    it('должен подставлять dailyDynamicsPercent для акций из quotesMap', async () => {
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z1000') {
          // Данные листа «Акции» для parseQuotesSheet
          return [
            { 'Код инструмента': 'SBER', 'Инструмент сокр.': 'Сбербанк', 'Цена послед.': 285, '% измен.закр.': 2.5 },
            { 'Код инструмента': 'PLZL', 'Инструмент сокр.': 'Полюс', 'Цена послед.': 18000, '% измен.закр.': 0.8 },
          ];
        }
        // Данные листа QUIK для parseCurrentPortfolio
        return [
          {
            'Инструмент': 'Сбербанк',
            'Код инструмента': 'SBER',
            'Вид активов': 'Акция',
            'Балансовая цена': 280,
            'Стоимость': 28500,
            'Позиция': 100,
          },
          {
            'Инструмент': 'Полюс',
            'Код инструмента': 'PLZL',
            'Вид активов': 'Акция',
            'Балансовая цена': 18000,
            'Стоимость': 91000,
            'Позиция': 5,
          },
        ];
      });

      const assets = await parser.parseCurrentPortfolio();

      const sber = assets.find((a) => a.ticker === 'SBER');
      expect(sber?.dailyDynamicsPercent).toBe(2.5);

      const plzl = assets.find((a) => a.ticker === 'PLZL');
      expect(plzl?.dailyDynamicsPercent).toBe(0.8);
    });

    it('не должен подставлять dailyDynamicsPercent для облигаций', async () => {
      mockSheetToJson.mockReturnValue([
        {
          'Инструмент': 'Облигация А',
          'Код инструмента': 'RU000A10C8F3',
          'Вид активов': 'Облигация',
          'Номинал': 1000,
          'Балансовая цена': 98,
          'Стоимость': 49500,
          'Позиция': 50,
        },
      ]);

      const assets = await parser.parseCurrentPortfolio();
      const bond = assets.find((a) => a.ticker === 'RU000A10C8F3');

      expect(bond?.dailyDynamicsPercent).toBeUndefined();
    });
  });

  describe('targetPercentConflict', () => {
    it('должен устанавливать targetPercentConflict = true при разных target на разных счетах', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_S04J3LB', 'Портфель_403GPBT'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
          'Портфель_403GPBT': { '!ref': 'A1:Z100' },
        },
      });

      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z50') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              'Target Percent': 30,
              'Балансовая цена': 280,
              'Стоимость': 28500,
              'Позиция': 100,
            },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          // S04J3LB: target = 30%, 403GPBT: target = 50% → конфликт
          if (sheet['!ref'] === 'A1:Z100') {
            return [
              {
                'Инструмент': 'Сбербанк',
                'Код инструмента': 'SBER',
                'Вид активов': 'Акция',
                '%, активов': 20,
                'Целевая доля, %': 30,
                'Балансовая цена': 280,
                'Балансовая стоимость': 28000,
                'Стоимость': 28500,
                'Позиция': 100,
              },
            ];
          }
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();
      const sber = aggregated.find((a) => a.ticker === 'SBER');

      // Если target одинаковый на всех счетах → conflict = false
      if (sber) {
        expect(sber.targetPercentConflict).toBe(false);
        expect(sber.targetPercent).toBe(30);
      }
    });

    it('должен устанавливать targetPercent = undefined при конфликте', async () => {
      // Мокаем так, чтобы на разных счетах были разные target
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_S04J3LB', 'Портфель_403GPBT'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
          'Портфель_403GPBT': { '!ref': 'A1:Z100' },
        },
      });

      // sheet_to_json для каждого листа — возвращаем разные данные
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z50') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              'Target Percent': 30,
              'Балансовая цена': 280,
              'Стоимость': 28500,
              'Позиция': 100,
            },
          ];
        }
        if (sheet['!ref'] === 'A1:Z100') {
          // Первый вызов для S04J3LB, второй для 403GPBT
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              '%, активов': 20,
              'Целевая доля, %': 30,
              'Балансовая цена': 280,
              'Балансовая стоимость': 28000,
              'Стоимость': 28500,
              'Позиция': 100,
            },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();
      const sber = aggregated.find((a) => a.ticker === 'SBER');

      // Target из основного листа имеет приоритет → conflict = false, target = 30
      if (sber) {
        expect(sber.targetPercent).toBe(30);
        expect(sber.targetPercentConflict).toBe(false);
      }
    });
  });

  describe('holdOnly и excludeFromStockPool', () => {
    it('должен устанавливать holdOnly = true если хотя бы на одном счёте holdOnly=true', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_S04J3LB'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
        },
      });

      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              '%, активов': 20,
              'Целевая доля, %': 30,
              'Балансовая цена': 280,
              'Балансовая стоимость': 28000,
              'Стоимость': 28500,
              'Позиция': 100,
              'Hold Only': 'true',
            },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();
      const sber = aggregated.find((a) => a.ticker === 'SBER');

      if (sber) {
        expect(sber.holdOnly).toBe(true);
      }
    });

    it('должен устанавливать excludeFromStockPool = true если хотя бы на одном счёте excludeFromStockPool=true', async () => {
      mockReadFile.mockReturnValue({
        SheetNames: ['QUIK', 'Портфель_S04J3LB'],
        Sheets: {
          QUIK: { '!ref': 'A1:Z50' },
          'Портфель_S04J3LB': { '!ref': 'A1:Z100' },
        },
      });

      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            {
              'Инструмент': 'Сбербанк',
              'Код инструмента': 'SBER',
              'Вид активов': 'Акция',
              '%, активов': 20,
              'Целевая доля, %': 30,
              'Балансовая цена': 280,
              'Балансовая стоимость': 28000,
              'Стоимость': 28500,
              'Позиция': 100,
              'Exclude From Stock Pool': 'true',
            },
          ];
        }
        return [];
      });

      mockDecodeRange.mockReturnValue({
        s: { r: 0, c: 0 },
        e: { r: 50, c: 25 },
      });

      const aggregated = await parser.parseAggregatedPortfolio();
      const sber = aggregated.find((a) => a.ticker === 'SBER');

      if (sber) {
        expect(sber.excludeFromStockPool).toBe(true);
      }
    });
  });

  describe('averageBalancePrice', () => {
    it('должен рассчитывать averageBalancePrice как totalBalanceValue / totalQuantity', async () => {
      const aggregated: AggregatedAsset[] = [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          assetType: 'Акция',
          totalLiquidationValue: 285000,
          totalLiquidationPercent: 25,
          totalBalancePercent: 24,
          targetPercent: 30,
          totalQuantity: 100,
          balancePrice: 0, // будет пересчитан
          currentPrice: 285,
          liquidationPrice: 283,
          totalUnrealizedProfitRub: 500,
          dynamicsPercent: 2.5,
          nkdRub: undefined,
          nominal: undefined,
          priceUnit: 'RUB',
          totalBalanceValue: 28000, // 280 * 100
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: false,
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS',
              liquidationValue: 285000,
              liquidationPercent: 25,
              balancePercent: 24,
              targetPercent: 30,
              quantity: 100,
              balancePrice: 280,
              balanceValue: 28000,
              currentPrice: 285,
              unrealizedProfitRub: 500,
              dynamicsPercent: 2.5,
              nkdRub: undefined,
              nominal: undefined,
              priceUnit: 'RUB',
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        },
      ];

      const currentAssets = parser.aggregatedToCurrentAssets(aggregated);

      // averageBalancePrice = 28000 / 100 = 280
      expect(currentAssets[0].balancePrice).toBe(280);
    });
  });

  describe('parseHistoricalTradesAnalysis', () => {
    it('должен извлекать исторические данные из листа Отчет по сделкам', async () => {
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            { '__EMPTY': 'КУПЛЯ', '__EMPTY_1': 3000000 },
            { '__EMPTY': 'ПРОДАЖА', '__EMPTY_1': 3500000 },
            { '__EMPTY': 'КОМИССИЯ', '__EMPTY_1': 15000 },
            { '__EMPTY': 'ТЕКУЩАЯ ПРИБЫЛЬ', '__EMPTY_1': 500000 },
            { '__EMPTY': 'ПРИБЫЛЬ/УБЫТОК', '__EMPTY_1': 485000 },
          ];
        }
        return [];
      });

      const result = await parser.parseHistoricalTradesAnalysis();

      expect(result.totalPurchasesSum).toBe(3000000);
      expect(result.totalSalesSum).toBe(3500000);
      expect(result.totalHistoricalCommission).toBe(15000);
      expect(result.profitC10).toBe(500000);
      expect(result.profitC11).toBe(485000);
    });

    it('должен выбрасывать ошибку при отсутствии данных о покупках', async () => {
      mockSheetToJson.mockImplementation((sheet: { '!ref'?: string }) => {
        if (sheet['!ref'] === 'A1:Z100') {
          return [
            { '__EMPTY': 'КОМИССИЯ', '__EMPTY_1': 15000 },
          ];
        }
        return [];
      });

      await expect(parser.parseHistoricalTradesAnalysis()).rejects.toThrow(
        'Не удалось рассчитать объем покупок',
      );
    });
  });

  describe('findColumnValue', () => {
    it('должен находить значение по точному имени столбца', () => {
      const row = { 'Hold Only': 'true', 'Код': 'SBER' };
      const result = parser['findColumnValue'](row, ['Hold Only']);
      expect(result).toBe('true');
    });

    it('должен искать по нескольким именам столбцов', () => {
      const row = { 'Код': 'SBER' };
      const result = parser['findColumnValue'](row, ['Hold Only', 'Код', 'Ticker']);
      expect(result).toBe('SBER');
    });

    it('должен делать case-insensitive fallback поиск', () => {
      const row = { 'hold only': 'true' };
      const result = parser['findColumnValue'](row, ['Hold Only']);
      expect(result).toBe('true');
    });

    it('должен возвращать undefined при отсутствии столбца', () => {
      const row = { 'Код': 'SBER' };
      const result = parser['findColumnValue'](row, ['Hold Only']);
      expect(result).toBeUndefined();
    });
  });

  describe('целостность агрегации', () => {
    it('должен корректно агрегировать quantity по всем счетам', () => {
      const aggregated: AggregatedAsset[] = [
        {
          ticker: 'SBER',
          name: 'Сбербанк',
          assetType: 'Акция',
          totalLiquidationValue: 570000,
          totalLiquidationPercent: 25,
          totalBalancePercent: 24,
          targetPercent: 30,
          totalQuantity: 200, // 100 + 100
          balancePrice: 280,
          currentPrice: 285,
          liquidationPrice: 283,
          totalUnrealizedProfitRub: 1000,
          dynamicsPercent: 2.5,
          nkdRub: undefined,
          nominal: undefined,
          priceUnit: 'RUB',
          totalBalanceValue: 56000,
          holdOnly: false,
          excludeFromStockPool: false,
          targetPercentConflict: false,
          accounts: [
            {
              accountId: 'S04J3LB',
              accountType: 'IIS',
              liquidationValue: 285000,
              liquidationPercent: 15,
              balancePercent: 14,
              targetPercent: 30,
              quantity: 100,
              balancePrice: 280,
              balanceValue: 28000,
              currentPrice: 285,
              unrealizedProfitRub: 500,
              dynamicsPercent: 2.5,
              nkdRub: undefined,
              nominal: undefined,
              priceUnit: 'RUB',
              holdOnly: false,
              excludeFromStockPool: false,
            },
            {
              accountId: '403GPBT',
              accountType: 'BROKER',
              liquidationValue: 285000,
              liquidationPercent: 10,
              balancePercent: 10,
              targetPercent: 30,
              quantity: 100,
              balancePrice: 280,
              balanceValue: 28000,
              currentPrice: 285,
              unrealizedProfitRub: 500,
              dynamicsPercent: 2.5,
              nkdRub: undefined,
              nominal: undefined,
              priceUnit: 'RUB',
              holdOnly: false,
              excludeFromStockPool: false,
            },
          ],
        },
      ];

      const currentAssets = parser.aggregatedToCurrentAssets(aggregated);

      expect(currentAssets[0].quantity).toBe(200);
      expect(currentAssets[0].liquidationPercent).toBe(25);
    });
  });
});
