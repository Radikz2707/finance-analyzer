import XLSX from 'xlsx';
import * as fs from 'fs';
import { CurrentAsset } from '../xlsx-parser/xlsx-parser.js';

export interface StockIncomeResult {
  name: string;
  ticker: string;
  quantity: number;
  rate: number;
  grossIncome: number;
  netIncome: number;
}

export interface CalculatedIncome {
  totalNkd: number;
  totalDivs: number;
  totalDivsNet: number;
  stocks: StockIncomeResult[];
}

const EXCEL_FILE_PATH =
  'C:/Users/Радик/Documents/Бухгалтерия Радика/Отчет/Данные новые.xlsx';

/**
 * Вспомогательная функция очистки строки от лишних символов валюты и пробелов
 */
function parseCleanFloat(value: unknown): number {
  if (value === undefined || value === null) return 0;

  const str = String(value).trim();
  const isNegative = str.startsWith('(') && str.endsWith(')');

  const cleanStr = str
    .replace(/\s+/g, '')
    .replace(/[()₽РP]/g, '')
    .replace(',', '.');

  const parsed = parseFloat(cleanStr) || 0;
  return isNegative ? -parsed : parsed;
}

/**
 * Основная функция расчета доходности портфеля
 */
export async function calculatePortfolioIncome(
  assets?: CurrentAsset[],
): Promise<CalculatedIncome> {
  if (assets) {
    void assets;
  }

  let totalNkd = 0;
  let totalDivs = 0;
  let totalDivsNet = 0;
  const stocksResults: StockIncomeResult[] = [];

  try {
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error('Файл не найден по пути: ' + EXCEL_FILE_PATH);
    }

    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const sheet = workbook.Sheets['QUIK'];

    if (sheet && sheet['!ref']) {
      const range = XLSX.utils.decode_range(sheet['!ref']);

      // Фиксированные индексы колонок таблицы QUIK с учетом скрытого столбца А (индекс 0)
      const COL_TICKER = 1; // B
      const COL_TYPE = 2; // C
      const COL_NAME = 3; // D
      const COL_QTY = 4; // E
      const COL_NKD = 12; // M
      const COL_DIVIDENDS = 19; // T — объявленные дивиденды (ручной ввод)

      console.log('[PARSER START] Начинаем построчный обход листа QUIK...');

      for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex++) {
        const tickerCell =
          sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_TICKER })];
        const assetTypeCell =
          sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_TYPE })];
        const realNameCell =
          sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_NAME })];
        const qtyCell =
          sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_QTY })];
        const nkdCell =
          sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_NKD })];
        const dividendCell =
          sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_DIVIDENDS })];

        let ticker =
          tickerCell && tickerCell.v !== undefined
            ? String(tickerCell.v).trim().toUpperCase()
            : '';
        const assetType =
          assetTypeCell && assetTypeCell.v !== undefined
            ? String(assetTypeCell.v).trim().toUpperCase()
            : '';
        const name =
          realNameCell && realNameCell.v !== undefined
            ? String(realNameCell.v).trim()
            : '';
        const qty =
          qtyCell && qtyCell.v !== undefined ? parseCleanFloat(qtyCell.v) : 0;

        if (ticker === '' && name === '' && assetType === '') {
          continue;
        }

        console.log(
          '[ROW ' +
            rowIndex +
            '] Тикер: ' +
            ticker +
            ' | Тип: ' +
            assetType +
            ' | Имя: ' +
            name +
            ' | Кол-во: ' +
            qty,
        );

        if (
          ticker.includes('ИТОГ') ||
          name.toUpperCase().includes('ИТОГ') ||
          /^\d+$/.test(ticker)
        ) {
          continue;
        }

        // Автоматика НКД по облигациям
        if (assetType === 'О' || assetType === 'ОБЛ') {
          if (nkdCell && nkdCell.v !== undefined) {
            const rowNkd = parseCleanFloat(nkdCell.v);
            if (rowNkd > 0) {
              totalNkd += rowNkd;
            }
          }
        }

        // Автоматика дивидендов по акциям
        if (assetType === 'А' && qty > 0) {
          const dividendRate = dividendCell && dividendCell.v !== undefined
            ? parseCleanFloat(dividendCell.v)
            : 0;

          console.log(
            '[DIVIDENDS] ' + ticker + ' | dividendCell.v=' + dividendCell?.v +
            ' | parsed=' + dividendRate + ' | qty=' + qty,
          );

          if (dividendRate <= 0) {
            continue;
          }

          const gross = qty * dividendRate;
          const net = gross * 0.87;

          totalDivs += gross;
          totalDivsNet += net;

          if (ticker === 'Х5' || ticker === 'X5') {
            ticker = 'FIVE';
          }

          stocksResults.push({
            name: name || ticker,
            ticker,
            quantity: qty,
            rate: dividendRate,
            grossIncome: Math.round(gross * 100) / 100,
            netIncome: Math.round(net * 100) / 100,
          });
        }
      }
    }
  } catch (error) {
    console.error('Ошибка при расчете портфеля:', error);
  }

  console.log(
    '[PARSER END] Расчет завершен. Итоговый НКД: ' + totalNkd + ' руб.',
  );

  return {
    totalNkd: Math.round(totalNkd * 100) / 100,
    totalDivs: Math.round(totalDivs * 100) / 100,
    totalDivsNet: Math.round(totalDivsNet * 100) / 100,
    stocks: stocksResults,
  };
}
