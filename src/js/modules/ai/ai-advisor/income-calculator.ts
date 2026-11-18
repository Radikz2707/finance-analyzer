import XLSX from 'xlsx';
import * as fs from 'fs';
import { CurrentAsset } from '../../data/xlsx-parser/xlsx-parser.js';
import * as config from '../../data/xlsx-parser/xlsx-parser-config.js';
import { PortfolioConfig } from '../../../config/portfolio-config.js';
import {
  fetchDividendLtm,
  type DividendLtmResult,
  type DividendLtmStatus,
} from './dividend-ltm.js';

/** Семантика дивидендной колонки QUIK. */
export type DividendKind = 'LTM' | 'DECLARED' | 'UNKNOWN';
/**
 * Источник дивидендных данных:
 * - BROKER — заполненный лист Excel (приоритетный override);
 * - MOEX_ISS — автодогрузка LTM из ISS;
 * - SMARTLAB — резервная автодогрузка LTM со smart-lab.ru;
 * - EXCEL_DIVIDENDS — legacy-значение (совместимость);
 * - EXCEL_DECLARED — объявленные будущие выплаты из Excel.
 */
export type DividendSource =
  'BROKER' | 'MOEX_ISS' | 'SMARTLAB' | 'EXCEL_DIVIDENDS' | 'EXCEL_DECLARED';

/** Опции расчёта дохода. */
export interface IncomeCalculationOptions {
  /** Догружать LTM из MOEX ISS, когда Excel-дивиденды пусты. */
  moexLtm?: boolean;
  /** Инжекция загрузчика (тесты/офлайн). */
  fetchLtm?: (ticker: string, name?: string) => Promise<DividendLtmResult>;
}

export interface StockIncomeResult {
  name: string;
  ticker: string;
  quantity: number;
  /** Дивиденд на одну бумагу за период колонки, ₽. */
  rate: number;
  /** Сумма на всю позицию, до НДФЛ. */
  grossIncome: number;
  /** Сумма на всю позицию, после НДФЛ. */
  netIncome: number;
  /** Семантика источника: LTM (полученные) или DECLARED (объявленные). */
  kind?: DividendKind;
  source?: DividendSource;
  /** Дата Excel-файла, ISO. */
  asOf?: string;
}

export interface CalculatedIncome {
  totalNkd: number;
  /** Полученные дивиденды LTM, до налога. */
  totalDivs: number;
  /** Полученные дивиденды LTM, после НДФЛ. */
  totalDivsNet: number;
  stocks: StockIncomeResult[];
  /** Объявленные будущие дивиденды, до налога (не смешивать с totalDivs). */
  declaredDivs?: number;
  /** Объявленные будущие дивиденды, после НДФЛ. */
  declaredDivsNet?: number;
  declaredStocks?: StockIncomeResult[];
  dividendKind?: DividendKind | 'MIXED';
  dividendSource?: DividendSource | 'MIXED' | null;
  excelAsOf?: string | null;
  dividendWarnings?: string[];
  /**
   * Статус подтверждения LTM-дивидендов для визуального слоя:
   * - OK — суммы подтверждены источником;
   * - EMPTY — источники ответили, но выплат в окне нет;
   * - UNAVAILABLE — источники недоступны (показывать «недоступно», не 0 ₽);
   * - MIXED — часть тикеров подтверждена, часть нет;
   * - null — автодогрузка не запрашивалась (данные Excel / опция выключена).
   */
  dividendDataStatus?: DividendLtmStatus | 'MIXED' | null;
}

const STOCK_TYPES = new Set(['А', 'АКЦИЯ', 'АКЦИИ', 'A', 'STOCK', 'STOCKS']);
const BOND_TYPES = new Set(['О', 'ОБЛ', 'ОБЛИГАЦИЯ', 'BOND', 'BONDS']);

function normalizeType(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

function isStockType(value: unknown): boolean {
  return STOCK_TYPES.has(normalizeType(value));
}

function isBondType(value: unknown): boolean {
  return BOND_TYPES.has(normalizeType(value));
}

/**
 * Вспомогательная функция очистки строки от лишних символов валюты и пробелов.
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

function headerText(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
  return cell && cell.v !== undefined
    ? String(cell.v).trim().toLowerCase()
    : '';
}

function isDividendHeader(header: string): boolean {
  return (
    header.includes('дивиденд') ||
    header.includes('dividend') ||
    header.includes('div') ||
    header.includes('див')
  );
}

/**
 * Определить семантику дивидендной колонки по заголовку.
 * - «объявл» / declared → будущие объявленные выплаты;
 * - «ltm» / «получен» / «выплач» → полученные за последние 12 месяцев;
 * - иначе — UNKNOWN (не угадываем молча).
 */
function classifyDividendHeader(
  header: string,
): 'DECLARED' | 'LTM' | 'UNKNOWN' | null {
  if (!isDividendHeader(header)) return null;
  if (
    header.includes('объявл') ||
    header.includes('declared') ||
    header.includes('будущ')
  ) {
    return 'DECLARED';
  }
  if (
    header.includes('ltm') ||
    header.includes('получ') ||
    header.includes('выплач') ||
    header.includes('received')
  ) {
    return 'LTM';
  }
  return 'UNKNOWN';
}

function resolvePositionalDividendColumn(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  typeCol: number,
  nkdCol: number,
  couponCol: number,
): { col: number | null; ambiguous: boolean; candidates: number[] } {
  const anchor = nkdCol >= 0 ? nkdCol : couponCol;
  if (anchor < 0) {
    return { col: null, ambiguous: false, candidates: [] };
  }

  const candidates: number[] = [];
  for (let col = anchor + 1; col <= range.e.c; col++) {
    let bondNonZero = 0;
    let stockNonZero = 0;

    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      const typeCell =
        typeCol >= 0
          ? sheet[XLSX.utils.encode_cell({ r: row, c: typeCol })]
          : undefined;
      const type = normalizeType(typeCell?.v);
      if (!isBondType(type) && !isStockType(type)) continue;

      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      const value = parseCleanFloat(cell?.v);

      if (isBondType(type) && value !== 0) {
        bondNonZero++;
      }
      if (isStockType(type) && value > 0) {
        stockNonZero++;
      }
    }

    // Позиционный fallback допустим только если ВСЕ облигационные строки
    // строго 0/пусто, а по акциям есть хотя бы одно положительное значение.
    if (bondNonZero === 0 && stockNonZero > 0) {
      candidates.push(col);
    }
  }

  return {
    col: candidates.length === 1 ? candidates[0]! : null,
    ambiguous: candidates.length > 1,
    candidates,
  };
}

/**
 * Основная функция расчета доходности портфеля.
 * Все данные (дивиденды, НКД) берутся ТОЛЬКО из Excel-файла.
 *
 * Семантика дивидендной колонки QUIK: LTM, сумма на всю позицию, до НДФЛ.
 * Для объявленных будущих выплат используется отдельная колонка и отдельные
 * поля, чтобы не смешивать форвардные объявления с полученным доходом.
 */
export async function calculatePortfolioIncome(
  assets?: CurrentAsset[],
  options: IncomeCalculationOptions = {},
): Promise<CalculatedIncome> {
  if (assets) {
    void assets;
  }

  let totalNkd = 0;
  let totalDivs = 0;
  let totalDivsNet = 0;
  let declaredDivs = 0;
  let declaredDivsNet = 0;
  const stocksResults: StockIncomeResult[] = [];
  const declaredStocks: StockIncomeResult[] = [];
  const dividendWarnings: string[] = [];
  // Акции, для которых Excel не дал LTM — кандидаты на догрузку из MOEX ISS.
  const pendingLtm: Array<{
    ticker: string;
    name: string;
    quantity: number;
  }> = [];

  if (!fs.existsSync(config.EXCEL_FILE_PATH)) {
    throw new Error('Файл не найден по пути: ' + config.EXCEL_FILE_PATH);
  }

  const workbook = XLSX.readFile(config.EXCEL_FILE_PATH);
  const sheet = workbook.Sheets[config.QUIK_SHEET_NAME];

  if (!sheet || !sheet['!ref']) {
    throw new Error(
      'Лист «' + config.QUIK_SHEET_NAME + '» не найден или пуст в Excel-файле.',
    );
  }

  const excelAsOf = fs.statSync(config.EXCEL_FILE_PATH).mtime.toISOString();
  const range = XLSX.utils.decode_range(sheet['!ref']);

  const findColumn = (
    predicate: (header: string) => boolean,
    fallback: number,
  ): number => {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const header = headerText(sheet, range.s.r, col);
      if (header && predicate(header)) return col;
    }
    return fallback;
  };

  const COL_TICKER = findColumn(
    (h) => h.includes('код инструмента') || h === 'тикер' || h === 'код',
    0,
  );
  const COL_TYPE = findColumn((h) => h.includes('вид актив') || h === 'тип', 1);
  const COL_NAME = findColumn(
    (h) => h === 'инструмент' || h.includes('название') || h === 'имя',
    2,
  );
  const COL_QTY = findColumn(
    (h) =>
      h.includes('позиция') || h.includes('кол-во') || h.includes('количество'),
    3,
  );
  const COL_NKD = findColumn(
    (h) => h.includes('нкд') || h.includes('накопл') || h.includes('nkd'),
    -1,
  );
  const COL_COUPON = findColumn(
    (h) => h.includes('купон') || h.includes('coupon'),
    -1,
  );

  // ── Дивидендные колонки: сначала по заголовкам ──────────────────────────
  const dividendHeaders: Array<{
    col: number;
    header: string;
    kind: 'DECLARED' | 'LTM' | 'UNKNOWN';
  }> = [];

  for (let col = range.s.c; col <= range.e.c; col++) {
    const header = headerText(sheet, range.s.r, col);
    const kind = classifyDividendHeader(header);
    if (kind) {
      dividendHeaders.push({ col, header, kind });
    }
  }

  const declaredCols = dividendHeaders.filter(
    (item) => item.kind === 'DECLARED',
  );
  const ltmCols = dividendHeaders.filter((item) => item.kind === 'LTM');
  const unknownCols = dividendHeaders.filter((item) => item.kind === 'UNKNOWN');

  let COL_DIVIDENDS = -1;
  let COL_DECLARED = -1;
  let headerAmbiguous = false;

  if (declaredCols.length === 1) {
    COL_DECLARED = declaredCols[0]!.col;
  } else if (declaredCols.length > 1) {
    headerAmbiguous = true;
    dividendWarnings.push(
      `ambiguous declared dividend columns: ${declaredCols
        .map((item) => item.header)
        .join(', ')}`,
    );
  }

  if (ltmCols.length === 1) {
    COL_DIVIDENDS = ltmCols[0]!.col;
  } else if (ltmCols.length > 1) {
    headerAmbiguous = true;
    dividendWarnings.push(
      `ambiguous LTM dividend columns: ${ltmCols
        .map((item) => item.header)
        .join(', ')}`,
    );
  }

  if (COL_DIVIDENDS < 0 && COL_DECLARED < 0 && !headerAmbiguous) {
    if (unknownCols.length === 1) {
      // Единственная generic-колонка «Дивиденды» трактуется как LTM,
      // но это явно фиксируется в логе и предупреждении.
      COL_DIVIDENDS = unknownCols[0]!.col;
      dividendWarnings.push(
        `semantics assumed LTM for header "${unknownCols[0]!.header}"`,
      );
    } else if (unknownCols.length > 1) {
      dividendWarnings.push(
        `ambiguous generic dividend columns: ${unknownCols
          .map((item) => item.header)
          .join(', ')}`,
      );
    } else {
      const positional = resolvePositionalDividendColumn(
        sheet,
        range,
        COL_TYPE,
        COL_NKD,
        COL_COUPON,
      );
      if (positional.col !== null) {
        COL_DIVIDENDS = positional.col;
        dividendWarnings.push(
          `positional fallback: column ${positional.col} right of coupon/NKD`,
        );
      } else if (positional.ambiguous) {
        dividendWarnings.push(
          `ambiguous positional dividend columns: ${positional.candidates.join(', ')}`,
        );
      } else {
        dividendWarnings.push('dividend column not found');
      }
    }
  }

  if (COL_DIVIDENDS < 0 && COL_DECLARED < 0) {
    console.warn(
      '⚠️ [DIVIDENDS] Столбец с дивидендами не найден в Excel. ' +
        'Добавьте заголовок "Дивиденды LTM" / "Полученные дивиденды" ' +
        'или "Объявленные дивиденды" в первую строку листа QUIK.',
    );
  } else {
    console.log(
      `[QUIK_DIVIDENDS] ltmCol=${COL_DIVIDENDS >= 0 ? COL_DIVIDENDS : 'none'} ` +
        `declaredCol=${COL_DECLARED >= 0 ? COL_DECLARED : 'none'} ` +
        `warnings=${dividendWarnings.join(' | ') || 'none'}`,
    );
  }

  if (COL_NKD < 0) {
    console.warn(
      '⚠️ [NKD] Столбец с НКД не найден в Excel. ' +
        'Добавьте заголовок "НКД" или "NKD" в первую строку листа QUIK.',
    );
  }

  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex++) {
    const tickerCell =
      sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_TICKER })];
    const assetTypeCell =
      sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_TYPE })];
    const realNameCell =
      sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_NAME })];
    const qtyCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_QTY })];
    const nkdCell =
      COL_NKD >= 0
        ? sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_NKD })]
        : undefined;
    const ltmCell =
      COL_DIVIDENDS >= 0
        ? sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_DIVIDENDS })]
        : undefined;
    const declaredCell =
      COL_DECLARED >= 0
        ? sheet[XLSX.utils.encode_cell({ r: rowIndex, c: COL_DECLARED })]
        : undefined;

    let ticker =
      tickerCell && tickerCell.v !== undefined
        ? String(tickerCell.v).trim().toUpperCase()
        : '';
    const assetType = normalizeType(assetTypeCell?.v);
    const name =
      realNameCell && realNameCell.v !== undefined
        ? String(realNameCell.v).trim()
        : '';
    const qty =
      qtyCell && qtyCell.v !== undefined ? parseCleanFloat(qtyCell.v) : 0;

    // Служебные строки ниже таблицы (сводки, проценты, P&L) часто имеют
    // пустые тикер и имя, но непустой assetType.
    if (ticker === '' && name === '') {
      continue;
    }

    if (
      ticker.includes('ИТОГ') ||
      ticker.includes('Итог') ||
      name.toUpperCase().includes('ИТОГ') ||
      name.toUpperCase().includes('ИТО') ||
      name.toUpperCase().includes('БАЛАНС') ||
      name.toUpperCase().includes('ДОЛЯ АКЦИЙ') ||
      name.toUpperCase().includes('ДОЛЯ ОБЛИГА') ||
      /^\d+$/.test(ticker) ||
      (assetType === '' &&
        (/\d/.test(name) || name.toUpperCase().includes('ИТОГ')))
    ) {
      continue;
    }

    // НКД по облигациям — как раньше, сумма по позиции.
    if (isBondType(assetType)) {
      if (nkdCell && nkdCell.v !== undefined) {
        const rowNkd = parseCleanFloat(nkdCell.v);
        if (rowNkd > 0) {
          totalNkd += rowNkd;
        }
      }
      continue;
    }

    if (!isStockType(assetType) || qty <= 0) {
      continue;
    }

    // Семантика QUIK: значение — LTM-сумма на всю позицию, до НДФЛ.
    const ltmGross =
      ltmCell && ltmCell.v !== undefined ? parseCleanFloat(ltmCell.v) : 0;
    if (ltmGross > 0) {
      const net = ltmGross * (1 - PortfolioConfig.tax.dividendNdflRate);
      totalDivs += ltmGross;
      totalDivsNet += net;

      if (ticker === 'Х5' || ticker === 'X5') {
        ticker = 'FIVE';
      }

      stocksResults.push({
        name: name || ticker,
        ticker,
        quantity: qty,
        rate: Math.round((ltmGross / qty) * 100) / 100,
        grossIncome: Math.round(ltmGross * 100) / 100,
        netIncome: Math.round(net * 100) / 100,
        kind: 'LTM',
        source: 'BROKER',
        asOf: excelAsOf,
      });

      console.log(
        `[DIVIDENDS] ticker=${ticker} kind=LTM gross=${ltmGross} ` +
          `qty=${qty} perShare=${(ltmGross / qty).toFixed(2)}`,
      );
    } else if (qty > 0) {
      // Excel не дал LTM — кандидат на автодогрузку из MOEX ISS.
      // X5 в QUIK может приходить как «Х5» — для ISS это FIVE.
      const pendingTicker =
        ticker === 'Х5' || ticker === 'X5' ? 'FIVE' : ticker;
      pendingLtm.push({ ticker: pendingTicker, name, quantity: qty });
    }

    // Объявленные будущие выплаты — отдельная плитка, не в totalDivs.
    const declaredGross =
      declaredCell && declaredCell.v !== undefined
        ? parseCleanFloat(declaredCell.v)
        : 0;
    if (declaredGross > 0) {
      const net = declaredGross * (1 - PortfolioConfig.tax.dividendNdflRate);
      declaredDivs += declaredGross;
      declaredDivsNet += net;

      declaredStocks.push({
        name: name || ticker,
        ticker,
        quantity: qty,
        rate: Math.round((declaredGross / qty) * 100) / 100,
        grossIncome: Math.round(declaredGross * 100) / 100,
        netIncome: Math.round(net * 100) / 100,
        kind: 'DECLARED',
        source: 'EXCEL_DECLARED',
        asOf: excelAsOf,
      });

      console.log(
        `[DIVIDENDS] ticker=${ticker} kind=DECLARED gross=${declaredGross} ` +
          `qty=${qty} perShare=${(declaredGross / qty).toFixed(2)}`,
      );
    }
  }

  // ── LTM из MOEX ISS / smart-lab: только там, где Excel не дал выплат ───
  const enableMoexLtm = options.moexLtm ?? false;
  let dividendDataStatus: DividendLtmStatus | 'MIXED' | null = null;
  if (enableMoexLtm && pendingLtm.length > 0) {
    const loader = options.fetchLtm ?? fetchDividendLtm;
    const ltmResults = await Promise.all(
      pendingLtm.map((item) => loader(item.ticker, item.name)),
    );

    const statuses: DividendLtmStatus[] = [];

    for (let index = 0; index < ltmResults.length; index++) {
      const result = ltmResults[index]!;
      const item = pendingLtm[index]!;
      const status: DividendLtmStatus =
        result.status ?? (result.ltmPerShare !== null ? 'OK' : 'UNAVAILABLE');
      statuses.push(status);

      if (result.ltmPerShare === null || result.ltmPerShare <= 0) {
        // Контракт метрики: нет истории → «нет подтверждённых данных», не 0.
        // UNAVAILABLE (сеть/формат) и EMPTY (источник ответил, выплат нет)
        // различаются в тексте — это видно и в логе, и в плитке.
        dividendWarnings.push(
          status === 'EMPTY'
            ? `${item.ticker}: нет подтверждённых дивидендов LTM за 13 мес (MOEX ISS, smart-lab)`
            : `${item.ticker}: дивиденды LTM недоступны — источники не ответили (MOEX ISS, smart-lab)`,
        );
        console.log(
          `[DIVIDENDS_LTM_SKIPPED] ticker=${item.ticker} status=${status} ` +
            `iss=${result.diagnostics?.iss ?? 'n/a'} ` +
            `smartlab=${result.diagnostics?.smartLab ?? 'n/a'} ` +
            `slSecid=${result.diagnostics?.smartLabSecid ?? 'n/a'}`,
        );
        continue;
      }

      const gross = result.ltmPerShare * item.quantity;
      const net = gross * (1 - PortfolioConfig.tax.dividendNdflRate);
      totalDivs += gross;
      totalDivsNet += net;

      stocksResults.push({
        name: item.name || item.ticker,
        ticker: item.ticker,
        quantity: item.quantity,
        rate: Math.round(result.ltmPerShare * 100) / 100,
        grossIncome: Math.round(gross * 100) / 100,
        netIncome: Math.round(net * 100) / 100,
        kind: 'LTM',
        source: result.source === 'SMARTLAB' ? 'SMARTLAB' : 'MOEX_ISS',
        asOf: result.asOf ?? undefined,
      });

      console.log(
        `[DIVIDENDS_LTM_APPLIED] ticker=${item.ticker} ` +
          `perShare=${result.ltmPerShare} qty=${item.quantity} ` +
          `gross=${gross.toFixed(2)} asOf=${result.asOf ?? 'n/a'} ` +
          `source=${result.source}`,
      );
    }

    const hasOk = statuses.includes('OK');
    const hasNonOk = statuses.some((item) => item !== 'OK');
    dividendDataStatus = hasOk
      ? hasNonOk
        ? 'MIXED'
        : 'OK'
      : statuses.includes('EMPTY')
        ? 'EMPTY'
        : 'UNAVAILABLE';
  }

  if (
    (COL_DIVIDENDS >= 0 || COL_DECLARED >= 0) &&
    stocksResults.length === 0 &&
    declaredStocks.length === 0
  ) {
    dividendWarnings.push('dividend column found but all values are 0/empty');
  }

  const hasLtm = stocksResults.length > 0;
  const hasDeclared = declaredStocks.length > 0;
  const dividendKind: DividendKind | 'MIXED' =
    hasLtm && hasDeclared
      ? 'MIXED'
      : hasLtm
        ? 'LTM'
        : hasDeclared
          ? 'DECLARED'
          : 'UNKNOWN';
  const ltmSources = new Set(
    stocksResults
      .map((stock) => stock.source)
      .filter((source): source is DividendSource => Boolean(source)),
  );
  const dividendSource: DividendSource | 'MIXED' | null =
    hasLtm && hasDeclared
      ? 'MIXED'
      : hasLtm
        ? ltmSources.size === 1
          ? [...ltmSources][0]!
          : 'MIXED'
        : hasDeclared
          ? 'EXCEL_DECLARED'
          : null;

  console.log(
    `[DIVIDENDS_TILE] nkd=${totalNkd.toFixed(2)} gross=${totalDivs.toFixed(2)} ` +
      `net=${totalDivsNet.toFixed(2)} totalNet=${(totalNkd + totalDivsNet).toFixed(2)} ` +
      `declaredGross=${declaredDivs.toFixed(2)} declaredNet=${declaredDivsNet.toFixed(2)} ` +
      `source=${dividendSource ?? 'none'} status=${dividendDataStatus ?? 'none'} ` +
      `asOf=${excelAsOf}`,
  );

  return {
    totalNkd: Math.round(totalNkd * 100) / 100,
    totalDivs: Math.round(totalDivs * 100) / 100,
    totalDivsNet: Math.round(totalDivsNet * 100) / 100,
    stocks: stocksResults,
    declaredDivs: Math.round(declaredDivs * 100) / 100,
    declaredDivsNet: Math.round(declaredDivsNet * 100) / 100,
    declaredStocks,
    dividendKind,
    dividendSource,
    excelAsOf,
    dividendWarnings,
    dividendDataStatus,
  };
}

export interface ExcelDividendYieldMeta {
  source: DividendSource;
  asOf: string | null;
  kind: DividendKind;
}

export interface ExcelDividendYields {
  yields: Record<string, number>;
  meta: Record<string, ExcelDividendYieldMeta>;
  warnings: string[];
}

/**
 * Построить дивидендные доходности из Excel для якоря.
 *
 * Формула: (LTM/declared сумма на позицию / количество) / текущая цена × 100.
 * Аномалии < 0.5% или > 100% при gross > 0 не попадают в карту и получают
 * статус PARSE_ERROR в логе.
 */
export function buildExcelDividendYields(
  income: CalculatedIncome,
  assets: Array<{ ticker: string; currentPrice: number }>,
): ExcelDividendYields {
  const yields: Record<string, number> = {};
  const meta: Record<string, ExcelDividendYieldMeta> = {};
  const warnings: string[] = [];
  const byTicker = new Map(
    assets.map((asset) => [asset.ticker.trim().toUpperCase(), asset]),
  );

  const addLayer = (
    stocks: StockIncomeResult[] | undefined,
    source: DividendSource,
    kind: DividendKind,
  ): void => {
    for (const stock of stocks ?? []) {
      const ticker = stock.ticker.trim().toUpperCase();
      const asset = byTicker.get(ticker);
      if (
        !asset ||
        !Number.isFinite(asset.currentPrice) ||
        asset.currentPrice <= 0
      ) {
        continue;
      }
      if (!Number.isFinite(stock.quantity) || stock.quantity <= 0) continue;
      if (!Number.isFinite(stock.grossIncome) || stock.grossIncome <= 0) {
        continue;
      }

      const perShare = stock.grossIncome / stock.quantity;
      const yieldPercent = (perShare / asset.currentPrice) * 100;

      // Источник конкретной строки важнее слоя: MOEX_ISS не должен
      // превращаться в BROKER при построении якоря.
      const rowSource = stock.source ?? source;

      if (yieldPercent < 0.5 || yieldPercent > 100) {
        const message =
          `[DIVIDEND_YIELD_ANOMALY] ticker=${ticker} value=${yieldPercent.toFixed(2)} ` +
          `gross=${stock.grossIncome} qty=${stock.quantity} price=${asset.currentPrice} ` +
          `status=PARSE_ERROR source=${rowSource}`;
        warnings.push(message);
        console.warn(message);
        continue;
      }

      yields[ticker] = Math.round(yieldPercent * 100) / 100;
      meta[ticker] = {
        source: rowSource,
        asOf: stock.asOf ?? income.excelAsOf ?? null,
        kind,
      };
      console.log(
        `[DIVIDEND_YIELDS] source=${rowSource} ticker=${ticker} ` +
          `value=${yields[ticker]} asOf=${meta[ticker].asOf ?? 'n/a'} kind=${kind}`,
      );
    }
  };

  // Сначала объявленные, затем LTM: полученные данные приоритетнее форвардных.
  addLayer(income.declaredStocks, 'EXCEL_DECLARED', 'DECLARED');
  addLayer(income.stocks, 'BROKER', 'LTM');

  return { yields, meta, warnings };
}
