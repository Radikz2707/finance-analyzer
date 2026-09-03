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

      // Синхронизируем имя ГТЛК строго по вашему скриншоту
      if (name.toUpperCase().includes('ГТЛК')) {
        name = 'sГТЛК2P-14';
      }

      // Безопасное чтение долей из колонок
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

      let targetPct = this.parseValue(
        row['Целевая доля, %'] || row['Целевая доля,  %'] || row['S'] || 0,
      );
      if (targetPct > 0 && targetPct <= 1) {
        targetPct = Math.round(targetPct * 100 * 100) / 100;
      }

      const nkd = this.parseValue(row['НКД'] || row['Накопленный купон']);
      const quantity = this.parseValue(row['Количество'] || row['Кол-во']);

      assets.push({
        name,
        targetPercent: targetPct > 0 ? targetPct : 0,
        liquidationPercent: liqPercent > 0 ? liqPercent : 0,
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
      stocksPercent: 52,
      bondsPercent: 48,
      stocksDeficitRub: 0,
      bondsDeficitRub: 0,
      iisOrdersSum: this.cachedIisOrdersSum,
      brokerOrdersSum: this.cachedBrokerOrdersSum,
      activeOrdersListText: this.cachedActiveOrdersText,
    };

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

  private parseValue(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
}
