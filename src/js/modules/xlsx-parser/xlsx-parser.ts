import XLSX from 'xlsx';
import * as fs from 'fs';
import { QuikOrder, parseQuikOrdersFile } from './quik-orders-parser';

const FILE_PATH =
  'C:/Users/Радик/Documents/Бухгалтерия Радика/Отчет/Данные новые.xlsx';
const ORDERS_PATH = 'C:/dev/finance-analyzer/data/orders.csv';

export interface MacroGoals {
  totalBalance: number;
  freeCash: number;
  stocksPercent: number;
  bondsPercent: number;
  stocksDeficitRub: number;
  bondsDeficitRub: number;
  iisOrdersSum: number;
  brokerOrdersSum: number;
  activeOrdersListText: string;
}

export interface CurrentAsset {
  name: string;
  targetPercent: number;
  liquidationPercent: number;
  balancePercent: number;
  unrealizedProfitRub: number;
  dynamicsPercent: number;
  nkdRub?: number;
  nominal?: number;
  quantity?: number;
}

export class XlsxParserModule {
  private workbook: XLSX.WorkBook | null = null;
  private cachedActiveOrdersText: string = 'Заявки отсутствуют';
  private cachedIisOrdersSum: number = 0;
  private cachedBrokerOrdersSum: number = 0;
  private cachedFreeCashFromQuikSheet: number = 0;
  public parsedActiveOrders: QuikOrder[] = [];

  constructor() {}

  public async loadWorkbook(): Promise<void> {
    if (this.workbook) return;
    if (!fs.existsSync(FILE_PATH)) {
      throw new Error('Критическая ошибка: Файл таблицы не найден');
    }
    this.workbook = XLSX.readFile(FILE_PATH);
  }

  public async saveWorkbook(): Promise<void> {
    if (this.workbook) XLSX.writeFile(this.workbook, FILE_PATH);
  }

  public async syncNewTrades(): Promise<number> {
    const result = parseQuikOrdersFile(ORDERS_PATH);
    this.parsedActiveOrders = result.orders;
    this.cachedIisOrdersSum = result.iisSum;
    this.cachedBrokerOrdersSum = result.brokerSum;
    this.cachedActiveOrdersText = result.ordersListText;
    return this.parsedActiveOrders.length;
  }

  public async parseCurrentPortfolio(): Promise<CurrentAsset[]> {
    await this.loadWorkbook();
    const assets: CurrentAsset[] = [];
    const sheetName = this.workbook?.SheetNames.find((name) => name === 'QUIK');
    if (!sheetName || !this.workbook) return [];

    const sheet = this.workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    rows.forEach((row) => {
      let name = String(row['Инструмент'] || '').trim();
      if (
        !name ||
        name.toUpperCase().includes('ИТОГО') ||
        name.toUpperCase().includes('БАЛАНС')
      )
        return;

      if (name.startsWith('-') || !isNaN(Number(name)) || name.length > 30)
        return;

      if (name === 'Рубль1' || name === 'Рубль') {
        this.cachedFreeCashFromQuikSheet = this.parseValue(
          row['Стоимость'] ||
            row['Ликвидационная стоимость'] ||
            row['Балансовая стоимость'],
        );
        return;
      }

      if (name.toUpperCase().includes('ГТЛК')) {
        name = 'sГТЛК2P-14';
      }

      let liqPercent = this.parseValue(
        row['%, активов, по ликвидационной стоимости'] || row['Доля'],
      );
      if (liqPercent > 0 && liqPercent <= 1) {
        liqPercent = Math.round(liqPercent * 100 * 100) / 100;
      }

      let balPercent = this.parseValue(
        row['%, активов, по балансовой стоимости'],
      );
      if (balPercent > 0 && balPercent <= 1) {
        balPercent = Math.round(balPercent * 100 * 100) / 100;
      }

      let targetPct = this.parseValue(row['Целевая доля, %'] || row['S'] || 0);
      if (targetPct > 0 && targetPct <= 1) {
        targetPct = Math.round(targetPct * 100 * 100) / 100;
      }

      const nkd = this.parseValue(row['НКД'] || row['Накопленный купон']);

      const quantityKey = Object.keys(row).find((k) =>
        k.toUpperCase().includes('КОЛ'),
      );
      const quantity = quantityKey ? this.parseValue(row[quantityKey]) : 0;

      if (targetPct !== 0) {
        const isDrasticMismatch = Math.abs(targetPct - liqPercent) > 1;

        if (quantity > 0 && liqPercent <= 0) {
          console.warn(
            "⚠️ [Parser Warning]: Аномалия данных для актива '" +
              name +
              "'. " +
              'В таблице Количество = ' +
              quantity +
              ', а Доля ликв. = ' +
              liqPercent +
              '%.',
          );
        }

        if (quantity <= 0 && liqPercent > 0 && isDrasticMismatch) {
          console.warn(
            "⚠️ [Parser Warning]: Аномалия данных для актива '" +
              name +
              "'. " +
              'Позиция пуста (0 шт), но доля в таблице составляет ' +
              liqPercent +
              '%.',
          );
        }
      }

      assets.push({
        name,
        targetPercent: targetPct,
        liquidationPercent: liqPercent,
        balancePercent: balPercent > 0 ? balPercent : liqPercent,
        unrealizedProfitRub: this.parseValue(row['Нереализованная прибыль']),
        dynamicsPercent: this.parseValue(row['Динамика актива']),
        nkdRub: nkd,
        nominal: 1000,
        quantity: quantity,
      });
    });

    return assets;
  }

  public async parseMacroGoals(): Promise<MacroGoals> {
    await this.loadWorkbook();
    const sheetName = this.workbook?.SheetNames.find(
      (name) => name === 'Средства',
    );

    const defaultMacro: MacroGoals = {
      totalBalance: 644474,
      freeCash:
        this.cachedFreeCashFromQuikSheet > 0
          ? this.cachedFreeCashFromQuikSheet
          : 106.59,
      stocksPercent: 55,
      bondsPercent: 45,
      stocksDeficitRub: 0,
      bondsDeficitRub: 0,
      iisOrdersSum: this.cachedIisOrdersSum,
      brokerOrdersSum: this.cachedBrokerOrdersSum,
      activeOrdersListText: this.cachedActiveOrdersText,
    };

    try {
      const goalsSheet = this.workbook?.Sheets['Цели'];
      if (goalsSheet) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          goalsSheet,
          { defval: '' },
        );

        rows.forEach((row) => {
          const values = Object.values(row);
          const hasStocks = values.some(
            (v) => String(v).trim().toUpperCase() === 'АКЦИИ',
          );
          const hasBonds = values.some(
            (v) => String(v).trim().toUpperCase() === 'ОБЛИГАЦИИ',
          );

          if (hasStocks || hasBonds) {
            const percent = values.find(
              (v) =>
                typeof v === 'number' ||
                (typeof v === 'string' && !isNaN(parseFloat(v))),
            );

            if (percent !== undefined) {
              if (hasStocks) {
                defaultMacro.stocksPercent = this.parseValue(percent);
              } else {
                defaultMacro.bondsPercent = this.parseValue(percent);
              }
            }
          }
        });
      }
    } catch {
      console.warn(
        '⚠️ Ошибка умного поиска целей на листе Excel, применены дефолты 55/45.',
      );
    }

    if (!sheetName || !this.workbook) return defaultMacro;

    const sheet = this.workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    rows.forEach((row) => {
      const keys = Object.keys(row);
      keys.forEach((key) => {
        const cellValue = String(row[key]).toUpperCase();
        if (
          cellValue.includes('ОБЩИЙ БАЛАНС') ||
          cellValue.includes('СТОИМОСТЬ ПОРТФЕЛЯ')
        ) {
          const nextKey = keys[keys.indexOf(key) + 1];
          if (nextKey)
            defaultMacro.totalBalance = this.parseValue(row[nextKey]);
        }
        if (
          cellValue.includes('СВОБОДНЫЙ КЭШ') ||
          cellValue.includes('ОСТАТОК РУБ') ||
          cellValue.includes('СРЕДСТВА')
        ) {
          const nextKey = keys[keys.indexOf(key) + 1];
          if (nextKey) {
            const parsedCash = this.parseValue(row[nextKey]);
            if (parsedCash > 0) defaultMacro.freeCash = parsedCash;
          }
        }
      });
    });

    return defaultMacro;
  }

  public async parseInvestedFunds(): Promise<{ totalNet: number }> {
    await this.loadWorkbook();
    let totalDeposits = 0;
    let totalWithdrawals = 0;

    const exactName = this.workbook?.SheetNames.find(
      (name) => name.toLowerCase().trim() === 'средства',
    );

    if (!exactName || !this.workbook) return { totalNet: 0 };

    const sheet = this.workbook.Sheets[exactName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

    // Бежим строго по физическим строкам таблицы со 2-й строки до начала итоговой плашки
    for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex++) {
      // Читаем первую ячейку строки, чтобы вовремя остановиться перед ячейкой "Итог"
      const checkCellRef = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
      const checkCell = sheet[checkCellRef];
      if (checkCell && String(checkCell.v).toUpperCase().includes('ИТОГ')) {
        break;
      }

      // Индекс 3 — это столбец D (ввод средств), Индекс 4 — это столбец E (вывод средств)
      const depositCellRef = XLSX.utils.encode_cell({ r: rowIndex, c: 3 });
      const withdrawalCellRef = XLSX.utils.encode_cell({ r: rowIndex, c: 4 });

      const depositCell = sheet[depositCellRef];
      const withdrawalCell = sheet[withdrawalCellRef];

      if (depositCell && depositCell.v !== undefined) {
        totalDeposits += this.parseValue(depositCell.v);
      }
      if (withdrawalCell && withdrawalCell.v !== undefined) {
        totalWithdrawals += this.parseValue(withdrawalCell.v);
      }
    }

    return { totalNet: totalDeposits - totalWithdrawals };
  }

  public async parseHistoricalTradesAnalysis(): Promise<{
    tradesCount: number;
    totalPurchasesSum: number;
    totalSalesSum: number;
    totalHistoricalCommission: number;
  }> {
    await this.loadWorkbook();
    const exactName = this.workbook?.SheetNames.find(
      (name) => name.toLowerCase().trim() === 'все сделки',
    );

    if (!exactName || !this.workbook) {
      return {
        tradesCount: 0,
        totalPurchasesSum: 0,
        totalSalesSum: 0,
        totalHistoricalCommission: 0,
      };
    }

    const sheet = this.workbook.Sheets[exactName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

    let totalPurchasesSum = 0;
    let totalSalesSum = 0;
    let totalCommissionSum = 0;
    let activeTradesCount = 0;
    let isTableStarted = false;

    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
      const cellA = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 0 })];
      if (!cellA || cellA.v === undefined) continue;

      const cellValueStr = String(cellA.v).trim().toUpperCase();

      // Пропускаем техническую шапку брокера
      if (!isTableStarted) {
        if (cellValueStr === '1' || cellValueStr === '№, П/П') {
          isTableStarted = true;
          if (cellValueStr === '№, П/П') continue;
        } else {
          continue;
        }
      }

      if (cellValueStr.includes('ИТОГ')) break;

      activeTradesCount++;

      // 1. Собираем комиссии по всем строкам без исключения (столбец P, индекс 15)
      const commCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 15 })];
      if (commCell && commCell.v !== undefined) {
        totalCommissionSum += this.parseValue(commCell.v);
      }

      // 2. Разделяем финансовые потоки Купли и Продажи (столбец H, индекс 7)
      const opCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 7 })];
      if (!opCell || opCell.v === undefined) continue;

      const opType = String(opCell.v).toUpperCase().trim();
      const volumeCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 11 })]; // Столбец N (Объём)

      if (volumeCell && volumeCell.v !== undefined) {
        const volume = this.parseValue(volumeCell.v);

        if (opType === 'КУПЛЯ' || opType === 'BUY') {
          totalPurchasesSum += volume;
        } else if (opType === 'ПРОДАЖА' || opType === 'SELL') {
          totalSalesSum += volume;
        }
      }
    }

    return {
      tradesCount: activeTradesCount,
      totalPurchasesSum: Math.round(totalPurchasesSum * 100) / 100,
      totalSalesSum: Math.round(totalSalesSum * 100) / 100,
      totalHistoricalCommission: Math.round(totalCommissionSum * 100) / 100,
    };
  }

  private parseValue(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
}
