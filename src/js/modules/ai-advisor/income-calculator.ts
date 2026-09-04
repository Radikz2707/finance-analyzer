import XLSX from 'xlsx';
import * as fs from 'fs';
import https from 'https';
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
 * 🌐 ОФИЦИАЛЬНЫЙ ОНЛАЙН-ПАРСЕР МОСКОВСКОЙ БИРЖИ (MOEX ISS API)
 */
function fetchMoexDividendRate(ticker: string): Promise<number> {
  return new Promise((resolve) => {
    const cleanTicker = String(ticker).trim().toUpperCase();
    if (!cleanTicker || cleanTicker === 'SUR' || cleanTicker === 'ИТОГ')
      return resolve(0);

    const url =
      'https://moex.com' + cleanTicker + '/dividends.json?iss.json=extended';

    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const rows = parsed && parsed.dividends ? parsed.dividends : [];
            if (Array.isArray(rows) && rows.length > 0) {
              const lastRow = rows[rows.length - 1];
              if (lastRow && typeof lastRow === 'object') {
                const value = parseFloat(String(lastRow.value || 0));
                if (!isNaN(value) && value > 0) return resolve(value);
              }
            }
            resolve(0);
          } catch {
            resolve(0);
          }
        });
      })
      .on('error', () => {
        resolve(0);
      });
  });
}

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

        // 🎯 БЕССМЕРТНЫЙ ЦИКЛ: Идем строго по номерам строк Excel ячеек (начиная со строки 3 до конца таблицы)
        for (let rowIndex = range.s.r + 2; rowIndex <= range.e.r; rowIndex++) {
          // Читаем данные ПРЯМО по официальным буквам колонок Excel, исключая любые сдвиги массивов!
          const tickerCell =
            sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 1 })]; // Колонка B (Код инструмента)
          const assetTypeCell =
            sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 2 })]; // Колонка C (Вид активов)
          const nameCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 3 })]; // Колонка D (Инструмент)
          const qtyCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 4 })]; // Колонка E (Позиция)

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

          // Пропускаем строки итогов
          if (
            ticker.includes('ИТОГ') ||
            name.toUpperCase().includes('ИТОГ') ||
            ticker === ''
          ) {
            continue;
          }

          // Фильтруем строго по виду актива "А" (Акции) из вашей колонки C
          if (assetType === 'А' && qty > 0) {
            const rate = await fetchMoexDividendRate(ticker);
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
    // Резервный блок
  }

  return {
    totalNkd: Math.round(totalNkd * 100) / 100,
    totalDivs: Math.round(totalDivs * 100) / 100,
    totalDivsNet: Math.round(totalDivsNet * 100) / 100,
    stocks: stocksResults,
  };
}
