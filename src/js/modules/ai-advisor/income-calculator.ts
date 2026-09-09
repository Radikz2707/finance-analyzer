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
 * Резервные ставки дивидендов LTM по основным российским акциям
 * Актуализированы: сентябрь 2026 (источник: Т-Инвестиции)
 *
 * Для добавления новой акции:
 * 1. Найдите последнюю выплату на tinvest.tbank.ru/stocks/{TICKER}/dividends
 * 2. Добавьте тикер в этот словарь с суммой всех выплат за последние 12 месяцев
 */
const FALLBACK_DIVIDENDS: Record<string, number> = {
  SBER: 37.64, // Сбербанк — последняя выплата 17.07.2026
  IRAO: 0.32, // ИнтерРАО — последняя выплата 08.06.2026 (0,32 ₽)
  'FIVE': 0, // X5 Retail Group — не платит дивиденды
  PLZL: 265.7, // Полюс — сумма всех выплат за LTM (платит 4-6 раз/год)
  GMKN: 33.5, // Норникель
  TATN: 28.0, // Татнефть
  SNGS: 13.2, // Славнефть
  ROSN: 56.5, // Роснефть
  MTSS: 6.5, // МТС
  VTBR: 0, // ВТБ — не платил
  AFLT: 21.8, // Аэрофлот
  YNDX: 0, // Яндекс — не платил
  HEAD: 0, // HeadHunter — не платил
  AHMK: 0, // АХМК — не платил
  CHMF: 48.5, // Северсталь
  MAGN: 100.0, // ММК
  VTGB: 0, // ВТБ — не платил
};

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

      // Динамический поиск столбца с дивидендами по заголовку
      let COL_DIVIDENDS = -1;
      for (let col = range.s.c; col <= range.e.c; col++) {
        const headerCell = sheet[XLSX.utils.encode_cell({ r: 0, c: col })];
        if (headerCell && headerCell.v !== undefined) {
          const header = String(headerCell.v).toLowerCase();
          if (
            header.includes('дивиденд') ||
            header.includes('dividend') ||
            header.includes('див')
          ) {
            COL_DIVIDENDS = col;
            break;
          }
        }
      }

      console.log('[PARSER START] Начинаем построчный обход листа QUIK...');

      if (COL_DIVIDENDS < 0) {
        console.warn(
          '⚠️ [DIVIDENDS] Столбец с дивидендами не найден в Excel. ' +
            'Добавьте заголовок "Дивиденды" или "Dividend" в первую строку листа QUIK.',
        );
      }

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
          COL_DIVIDENDS >= 0
            ? sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_DIVIDENDS })]
            : undefined;

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

        // Фильтр служебных строк Excel (ИТОГО, сводные данные, пустые строки)
        if (
          ticker.includes('ИТОГ') ||
          ticker.includes('Итог') ||
          name.toUpperCase().includes('ИТОГ') ||
          name.toUpperCase().includes('ИТО') ||
          name.toUpperCase().includes('БАЛАНС') ||
          name.toUpperCase().includes('ДОЛЯ АКЦИЙ') ||
          name.toUpperCase().includes('ДОЛЯ ОБЛИГА') ||
          /^\d+$/.test(ticker) ||
          (assetType === '' && (/\d/.test(name) || name.toUpperCase().includes('ИТОГ')))
        ) {
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
          let dividendRate = dividendCell && dividendCell.v !== undefined
            ? parseCleanFloat(dividendCell.v)
            : 0;

          console.log(
            '[DIVIDENDS] ' + ticker + ' | excelDiv=' + (dividendCell?.v ?? 'N/A') +
            ' | parsed=' + dividendRate + ' | qty=' + qty,
          );

          // Если значение из Excel = 0, используем резервную ставку
          if (dividendRate <= 0 && FALLBACK_DIVIDENDS[ticker] > 0) {
            dividendRate = FALLBACK_DIVIDENDS[ticker];
            console.log(
              '  ↳ [FALLBACK] Использована резервная ставка: ' + dividendRate + ' ₽',
            );
          }

          if (dividendRate <= 0) {
            console.log(
              '  ↳ [SKIP] Дивиденды не объявлены или равны 0 для ' + ticker,
            );
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
