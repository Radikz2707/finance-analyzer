import * as XLSX from 'xlsx';
import * as fs from 'fs';

// Константы путей к файлам
const FILE_PATH =
  'C:\\Users\\Радик\\Documents\\Бухгалтерия Радика\\Отчет\\Данные новые.xlsx';
// ORDERS_PATH временно скрыт, пока вы не начнете использовать его в syncNewTrades
// const ORDERS_PATH = 'C:\\dev\\finance-analyzer\\data\\orders.csv';

/**
 * Интерфейс макроцелей портфеля
 */
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

/**
 * Интерфейс текущего актива
 */
export interface CurrentAsset {
  name: string;
  targetPercent: number;
  liquidationPercent: number;
  balancePercent: number;
  unrealizedProfitRub: number;
  dynamicsPercent: number;
}

/**
 * Модуль для парсинга Excel-отчетов
 */
export class XlsxParserModule {
  private workbook: XLSX.WorkBook | null = null;

  constructor() {}

  /**
   * Загружает рабочую книгу Excel в память
   */
  public async loadWorkbook(): Promise<void> {
    try {
      if (fs.existsSync(FILE_PATH)) {
        this.workbook = XLSX.readFile(FILE_PATH);
      } else {
        throw new Error(`Файл не найден по пути: ${FILE_PATH}`);
      }
    } catch (error) {
      console.error('Ошибка при загрузке Excel файла:', error);
      throw error;
    }
  }

  /**
   * Сохраняет изменения в рабочую книгу Excel
   */
  public async saveWorkbook(): Promise<void> {
    try {
      if (this.workbook) {
        XLSX.writeFile(this.workbook, FILE_PATH);
      } else {
        throw new Error(
          'Рабочая книга не загружена. Сначала вызовите loadWorkbook().',
        );
      }
    } catch (error) {
      console.error('Ошибка при сохранении Excel файла:', error);
      throw error;
    }
  }

  /**
   * Синхронизирует новые сделки из CSV-файла
   */
  public async syncNewTrades(): Promise<number> {
    return 0;
  }

  /**
   * Парсит текущие активы из открытого Excel-файла
   */
  public async parseCurrentPortfolio(): Promise<CurrentAsset[]> {
    if (!this.workbook) {
      await this.loadWorkbook();
    }

    const assets: CurrentAsset[] = [];
    return assets;
  }

  /**
   * Парсит глобальные макроцели распределения
   */
  public async parseMacroGoals(): Promise<MacroGoals> {
    if (!this.workbook) {
      await this.loadWorkbook();
    }

    const macro: MacroGoals = {
      totalBalance: 0,
      freeCash: 0,
      stocksPercent: 0,
      bondsPercent: 0,
      stocksDeficitRub: 0,
      bondsDeficitRub: 0,
      iisOrdersSum: 0,
      brokerOrdersSum: 0,
      activeOrdersListText: '',
    };

    return macro;
  }

  /**
   * Вспомогательный метод для валидации значений (закомментирован, чтобы не спамить ошибку tsc)
   */
  /*
  private parseValue(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
  */
}
