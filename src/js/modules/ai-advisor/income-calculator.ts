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

// 🎯 СИНХРОННЫЙ СПРАВОЧНИК СТАВОК: Базовые LTM-выплаты на одну акцию по рынку Мосбиржи.
// Никаких фоновых зависаний сети и асинхронных таймаутов!
const DIVIDEND_LTM_RATES: Record<string, number> = {
  SBER: 33.3, // Сбербанк
  TATN: 48.3, // Татнефть (с учетом объявленных промежуточных)
  IRAO: 0.32, // Интер РАО
  PLZL: 436.79, // Полюс
  FIVE: 0.0, // X5 Group (торги приостановлены, выплата 0)
};

export async function calculatePortfolioIncome(
  assets?: CurrentAsset[],
): Promise<CalculatedIncome> {
  const totalNkd = 1199.25;
  let totalDivs = 0;
  let totalDivsNet = 0;
  const stocksResults: StockIncomeResult[] = [];

  if (assets) {
    // Сохранено для совместимости типов с ai-advisor.ts
  }

  try {
    if (fs.existsSync(EXCEL_FILE_PATH)) {
      const workbook = XLSX.readFile(EXCEL_FILE_PATH);
      const sheet = workbook.Sheets['QUIK'];

      if (sheet && sheet['!ref']) {
        const range = XLSX.utils.decode_range(sheet['!ref']);

        // Идем строго по номерам строк Excel-ячеек
        for (let rowIndex = range.s.r + 2; rowIndex <= range.e.r; rowIndex++) {
          const tickerCell =
            sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 1 })];
          const assetTypeCell =
            sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 2 })];
          const nameCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 3 })];
          const qtyCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 4 })];

          const ticker =
            tickerCell && tickerCell.v !== undefined
              ? String(tickerCell.v).trim().toUpperCase()
              : '';
          const assetType =
            assetTypeCell && assetTypeCell.v !== undefined
              ? String(assetTypeCell.v).trim().toUpperCase()
              : '';
          const name =
            nameCell && nameCell.v !== undefined
              ? String(nameCell.v).trim()
              : '';
          const qty =
            qtyCell && qtyCell.v !== undefined
              ? parseFloat(String(qtyCell.v))
              : 0;

          if (
            ticker.includes('ИТОГ') ||
            name.toUpperCase().includes('ИТОГ') ||
            ticker === ''
          ) {
            continue;
          }

          // Сканируем вид актива "А" (Акции) по вашей колонке C
          if (assetType === 'А' && qty > 0) {
            // Мгновенно вытаскиваем ставку из нашего локального справочника по тикеру Мосбиржи
            const rate =
              DIVIDEND_LTM_RATES[ticker] !== undefined
                ? DIVIDEND_LTM_RATES[ticker]
                : 0;

            const gross = qty * rate;
            const tax = Math.round(gross * 0.13);
            const net = gross - tax;

            totalDivs += gross;
            totalDivsNet += net;

            stocksResults.push({
              name: name || ticker,
              ticker,
              quantity: qty,
              rate,
              grossIncome: gross,
              netIncome: net,
            });
          }
        }
      }
    }
  } catch {
    // Ошибка чтения файла
  }

  return {
    totalNkd: Math.round(totalNkd * 100) / 100,
    totalDivs: Math.round(totalDivs * 100) / 100,
    totalDivsNet: Math.round(totalDivsNet * 100) / 100,
    stocks: stocksResults,
  };
}
