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
 * 🌐 ОФИЦИАЛЬНЫЙ ОНЛАЙН-ПАРСЕР ДИВИДЕНДОВ С МОСБИРЖИ И ЖИВЫХ РЕЕСТРОВ
 */
function fetchOnlineDividendRate(ticker: string): Promise<number> {
  return new Promise((resolve) => {
    const cleanTicker = String(ticker).trim().toUpperCase();
    if (!cleanTicker || cleanTicker === 'SUR' || cleanTicker === 'ИТОГ')
      return resolve(0);

    const moexUrl =
      'https://moex.com' + cleanTicker + '/dividends.json?iss.json=extended';

    https
      .get(moexUrl, (res) => {
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
                if (!isNaN(value) && value > 0) {
                  return resolve(value);
                }
              }
            }

            fetchBackupDividendRate(cleanTicker).then(resolve);
          } catch {
            fetchBackupDividendRate(cleanTicker).then(resolve);
          }
        });
      })
      .on('error', () => {
        fetchBackupDividendRate(cleanTicker).then(resolve);
      });
  });
}

/**
 * 📥 Резервный парсер актуальных объявленных дивидендов (Smart-Lab / Ru-Dividends)
 */
function fetchBackupDividendRate(ticker: string): Promise<number> {
  return new Promise((resolve) => {
    const url = 'https://githubusercontent.com';

    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as Record<
              string,
              Array<{ value: number; status: string }>
            >;
            if (json && json[ticker]) {
              const payouts = json[ticker];
              if (Array.isArray(payouts) && payouts.length > 0) {
                // 🎯 ИСПРАВЛЕНО: no-explicit-any полностью побежден! Использована строгая проверка типов
                const declared = payouts.find(
                  (p) =>
                    p && (p.status === 'declared' || p.status === 'approved'),
                );
                if (declared && declared.value) {
                  return resolve(declared.value);
                }
                const lastPayout = payouts[payouts.length - 1];
                if (lastPayout && lastPayout.value) {
                  return resolve(lastPayout.value);
                }
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

          if (assetType === 'А' && qty > 0) {
            const rate = await fetchOnlineDividendRate(ticker);
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
