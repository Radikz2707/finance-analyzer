/**
 * BondApi — получение справочных данных по облигациям с MOEX ISS API.
 *
 * Бесплатный API без регистрации и ключей:
 * https://iss.moex.com/iss/
 *
 * Поддерживает:
 * - Загрузку справочника всех облигаций (TQOB)
 * - Получение эмитента, купона, типа облигации
 * - Маппинг ISIN → полные данные выпуска
 * - Кэширование данных
 */

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Тип купона облигации */
export type CouponType = 'FIXED' | 'FLOATER' | 'MICROFIX' | 'ZERO_COUPON';

/** Структурированные данные по облигации из MOEX */
export interface BondInfo {
  /** ISIN облигации */
  isin: string;
  /** Наименование выпуска */
  issueName: string;
  /** Наименование эмитента */
  issuerName: string;
  /** Номинал (RUB) */
  nominal: number;
  /** Купонная ставка в % годовых */
  couponRatePct: number;
  /** Тип купона */
  couponType: CouponType;
  /** Частота купонов в год (2 = полугодие, 4 = квартал) */
  couponFrequency: number;
  /** Дата погашения (YYYY-MM-DD) */
  maturityDate: string;
  /** Ближайшая дата выплаты купона (YYYY-MM-DD) */
  nextCouponDate: string;
  /** Спред к ключевой ставке в % (для флоатеров) */
  floatSpreadPct: number;
  /** Базовый индекс для флоатера (RU SR, Key Rate, etc.) */
  floatIndex: string;
  /** Есть опцион досрочного погашения */
  hasOption: boolean;
  /** Дата исполнения опциона (если есть) */
  callDate: string;
  /** Амортизационный график */
  hasAmortization: boolean;
  /** ИCBRR рейтинг (внутренний рейтинг МОEX) */
  icbrrRating: string;
  /** Сектор экономики */
  sector: string;
}

// ──────────────────────────────────────────────
// 2. MOEX ISS API Client
// ──────────────────────────────────────────────

/** Базовый URL MOEX ISS API */
const MOEX_ISS_BASE = 'https://iss.moex.com/iss';

/** Таймаут запросов к MOEX (мс) */
const REQUEST_TIMEOUT = 15000;

/**
 * Выполнить запрос к MOEX ISS API.
 */
async function fetchMoex(path: string, params: Record<string, string> = {}): Promise<Record<string, unknown>[]> {
  const url = new URL(`${MOEX_ISS_BASE}${path}`);
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`MOEX API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as unknown as Record<string, unknown>[];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Преобразовать данные из MOEX в BondInfo.
 */
function parseBondFromMoex(
  columns: string[],
  row: unknown[],
): BondInfo | null {
  const get = (col: string): unknown => {
    const idx = columns.indexOf(col);
    return idx >= 0 ? row[idx] : null;
  };

  const isin = String(get('securities.id') || '').trim();
  if (!isin || !isin.startsWith('RU00')) return null;

  // Определяем тип купона
  const couponKind = String(get('securities.couponKind') || '').trim().toLowerCase();
  let couponType: CouponType = 'FIXED';
  
  if (couponKind.includes('float') || couponKind.includes('пла')) {
    couponType = 'FLOATER';
  } else if (couponKind.includes('micro')) {
    couponType = 'MICROFIX';
  } else if (couponKind.includes('zero') || couponKind.includes('бesc')) {
    couponType = 'ZERO_COUPON';
  }

  // Парсим числовые значения
  const parseNum = (val: unknown): number => {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  };

  // Парсим дату
  const parseDate = (val: unknown): string => {
    if (!val) return '';
    const d = new Date(val as number);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0] as string;
  };

  return {
    isin,
    issueName: (String(get('securities.name') || '') || '').trim(),
    issuerName: (String(get('securities.issueName') || '') || '').trim(),
    nominal: parseNum(get('securities.nominal')),
    couponRatePct: parseNum(get('securities.couponRate')),
    couponType,
    couponFrequency: parseNum(get('securities.couponFrequency')) || 2,
    maturityDate: parseDate(get('securities.maturityRegDate')) || '',
    nextCouponDate: parseDate(get('securities.nextCouponDate')) || '',
    floatSpreadPct: parseNum(get('securities.floatSpread')),
    floatIndex: String(get('securities.floatIndex') || '').trim(),
    hasOption: Boolean(get('securities.hasOption')),
    callDate: parseDate(get('securities.callDate')) || '',
    hasAmortization: Boolean(get('securities.hasAmortization')),
    icbrrRating: String(get('securities.icbrrRating') || '').trim(),
    sector: String(get('securities.sector') || '').trim(),
  };
}

// ──────────────────────────────────────────────
// 3. Main API Functions
// ──────────────────────────────────────────────

/**
 * Загрузить справочник всех облигаций с TQOB.
 * 
 * Использует endpoint:
 * /iss/engines/stock/markets/bonds/boards/TQOB/securities.json
 */
export async function fetchBondCatalog(): Promise<BondInfo[]> {
  try {
    console.log('[BondApi] Загрузка справочника облигаций с MOEX ISS...');
    
    const data = await fetchMoex('/iss/engines/stock/markets/bonds/boards/TQOB/securities.json', {
      'group': 'securities',
    });

    if (!data || !Array.isArray(data)) {
      console.warn('[BondApi] Ошибка: пустой ответ от MOEX');
      return [];
    }

    const bonds: BondInfo[] = [];

    for (const item of data) {
      const columns = (item as Record<string, { columns: string[] }>)?.securities?.columns;
      const rows = (item as Record<string, { data: unknown[][] }>)?.securities?.data;

      if (!columns || !rows || !Array.isArray(rows)) continue;

      for (const row of rows) {
        const bond = parseBondFromMoex(columns, row as unknown[]);
        if (bond) {
          bonds.push(bond);
        }
      }
    }

    console.log(`[BondApi] ✅ Загружено ${bonds.length} облигаций`);
    return bonds;
  } catch (error) {
    console.error('[BondApi] ❌ Ошибка загрузки справочника:', error);
    return [];
  }
}

/**
 * Загрузить данные по конкретной облигации по ISIN.
 */
export async function fetchBondByIsin(isin: string): Promise<BondInfo | null> {
  try {
    const data = await fetchMoex('/iss/securities.json', {
      'securities.id': isin,
    });

    if (!data || data.length === 0) return null;

    const item = data[0] as Record<string, { columns: string[]; data: unknown[][] }>;
    const columns = item?.securities?.columns;
    const rows = item?.securities?.data;

    if (!columns || !rows || rows.length === 0) return null;

    return parseBondFromMoex(columns, rows[0] as unknown[]);
  } catch (error) {
    console.error(`[BondApi] Ошибка загрузки ${isin}:`, error);
    return null;
  }
}

/**
 * Загрузить данные по списку ISIN.
 * 
 * @param isins — список ISIN-кодов
 * @returns Map<ISIN, BondInfo>
 */
export async function fetchBondsByIsins(isins: string[]): Promise<Map<string, BondInfo>> {
  const result = new Map<string, BondInfo>();

  // Сначала пробуем загрузить весь справочник (быстрее)
  const catalog = await fetchBondCatalog();
  
  if (catalog.length > 0) {
    for (const bond of catalog) {
      if (isins.includes(bond.isin)) {
        result.set(bond.isin, bond);
      }
    }

    console.log(`[BondApi] ✅ Найдено ${result.size} из ${isins.length} запрошенных облигаций`);
    return result;
  }

  // Fallback: запрашиваем по одной
  console.log('[BondApi] ⚠️ Справочник пуст, запрашиваем по одной...');
  
  for (const isin of isins) {
    const bond = await fetchBondByIsin(isin);
    if (bond) {
      result.set(isin, bond);
    }
  }

  return result;
}

/**
 * Создать маппинг ISIN → эмитент для всех облигаций.
 * Используется для обогащения данных из Excel.
 */
export async function buildIssuerMap(): Promise<Map<string, string>> {
  const catalog = await fetchBondCatalog();
  const map = new Map<string, string>();

  for (const bond of catalog) {
    if (bond.issuerName) {
      map.set(bond.isin, bond.issuerName);
    }
  }

  console.log(`[BondApi] 📋 Создан маппинг эмитентов: ${map.size} облигаций`);
  return map;
}

/**
 * Обогащение данных из Excel данными с MOEX.
 * 
 * @param excelBonds — Map<ISIN, BondReferenceData> из Excel
 * @returns обогащённый Map с дополнительными полями
 */
export async function enrichBondsFromMoex(
  excelBonds: Map<string, import('../xlsx-parser/xlsx-parser.js').BondReferenceData>,
): Promise<Map<string, import('../xlsx-parser/xlsx-parser.js').BondReferenceData & { moex: BondInfo | null }>> {
  const isins = Array.from(excelBonds.keys());
  const moexData = await fetchBondsByIsins(isins);

  const enriched = new Map<string, import('../xlsx-parser/xlsx-parser.js').BondReferenceData & { moex: BondInfo | null }>();

  for (const [isin, bond] of excelBonds) {
    enriched.set(isin, {
      ...bond,
      moex: moexData.get(isin) || null,
    });
  }

  console.log(`[BondApi] 🔄 Обогащено ${enriched.size} позиций`);
  return enriched;
}

// ──────────────────────────────────────────────
// 4. Экспорт
// ──────────────────────────────────────────────

export default {
  fetchBondCatalog,
  fetchBondByIsin,
  fetchBondsByIsins,
  buildIssuerMap,
  enrichBondsFromMoex,
};
