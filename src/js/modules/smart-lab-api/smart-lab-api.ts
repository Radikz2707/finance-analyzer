/**
 * SmartLabApi — получение справочных данных по облигациям с Smart-Lab.
 *
 * Используется как дополнительный источник данных для облигаций,
 * которые отсутствуют в MOEX (например, интервальные ПИФы, новые выпуски).
 *
 * Парсит страницы облигаций с https://smart-lab.ru/q/bonds/{ISIN}/
 */

// ──────────────────────────────────────────────
// 1. Types
// ──────────────────────────────────────────────

/** Тип купона облигации */
export type CouponType = 'FIXED' | 'FLOATER' | 'MICROFIX' | 'ZERO_COUPON';

/** Структурированные данные по облигации из Smart-Lab */
export interface SmartLabBond {
  /** Имя/тикер облигации */
  ticker: string;
  /** ISIN */
  isin: string;
  /** Дата погашения */
  maturityDate?: string;
  /** Доходность в % */
  yield?: number;
  /** Цена в % от номинала */
  price?: number;
  /** Цена в руб */
  priceRUB?: number;
  /** Изменение цены за день в % */
  dailyChange?: number;
  /** Объём торгов в млн руб */
  volume?: number;
  /** Объём в штуках */
  volumeShares?: number;
  /** Лет до погашения */
  yearsToMaturity?: number;
  /** Дата размещения */
  placementDate?: string;
  /** Дата оферты */
  offerDate?: string;
  /** Дюрация в днях */
  durationDays?: number;
  /** Номинал в руб */
  nominal?: number;
  /** Валюта */
  currency?: string;
  /** Тип облигации */
  bondType?: string;
  /** Кредитный рейтинг */
  rating?: string;
  /** Текущая доходность купона в % */
  currentCouponYield?: number;
  /** Купон в руб */
  couponAmount?: number;
  /** Годовой купон в руб */
  annualCoupon?: number;
  /** Частота купона в год */
  couponFrequency?: number;
  /** G-спред в базисных пунктах */
  gSpread?: number;
  /** Только для квалифицированных инвесторов */
  isQualifiedOnly?: boolean;
  /** Дата следующей выплаты */
  nextCouponDate?: string;
  /** НКД в руб */
  nkd?: number;
  /** Длительность купона в днях */
  couponDuration?: number;
  /** Ставка купона в % */
  couponRate?: number;
  /** Эмитент */
  issuer?: string;
  /** Сектор */
  sector?: string;
  /** Режим торгов */
  tradingMode?: string;
  /** Статус */
  status?: string;
  /** Уровень листинга */
  listingLevel?: string;
  /** Размер лота */
  lotSize?: number;
  /** Шаг цены */
  priceStep?: number;
  /** Объем выпуска в млн руб */
  issueVolume?: number;
  /** Объем в обращении в млн руб */
  outstandingVolume?: number;
}

// ──────────────────────────────────────────────
// 2. Smart-Lab API Client
// ──────────────────────────────────────────────

/** Базовый URL Smart-Lab */
const SMARTLAB_BASE = 'https://smart-lab.ru';

/** Таймаут запросов (мс) */
const REQUEST_TIMEOUT = 15000;

/**
 * Выполнить запрос к Smart-Lab.
 * Возвращает HTML-страницу.
 */
async function fetchSmartLab(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'FinanceAnalyzer/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Smart-Lab API error: ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Парсить таблицу облигаций из HTML Smart-Lab.
 * Таблица находится в .quotes-table или table с классом bonds.
 */
function parseBondsTable(html: string): SmartLabBond[] {
  const bonds: SmartLabBond[] = [];

  // Извлекаем таблицу котировок облигаций
  // Smart-Lab использует структуру: table > tbody > tr > td
  const tableRegex = /<table[^>]*class="[^"]*quotes-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i;
  const tableMatch = html.match(tableRegex);

  if (!tableMatch) {
    // Пробуем альтернативный паттерн
    const altRegex = /<table[^>]*>([\s\S]*?)<\/table>/i;
    const altMatch = html.match(altRegex);
    if (!altMatch) return bonds;

    // Парсим все строки таблицы
    const rows = altMatch[1]?.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length < 5) continue; // Минимум 5 колонок

      const bond = parseBondRow(cells);
      if (bond) {
        bonds.push(bond);
      }
    }
  } else {
    // Парсим строки из найденной таблицы
    const rows = tableMatch[1]?.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
    for (const row of rows) {
      // Пропускаем заголовки
      if (row.includes('<th')) continue;

      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length < 5) continue;

      const bond = parseBondRow(cells);
      if (bond) {
        bonds.push(bond);
      }
    }
  }

  return bonds;
}

/**
 * Парсить одну строку таблицы облигаций.
 * Колонки: Время, Имя, Погашение, Доходн, Цена, Объем, Купон, НКД, Дюр-я, Дата купона, Оферта
 */
function parseBondRow(cells: string[]): SmartLabBond | null {
  const getText = (idx: number): string => {
    if (idx >= cells.length || !cells[idx]) return '';
    return cells[idx].replace(/<[^>]*>/g, '').trim();
  };

  const ticker = getText(1); // Имя
  if (!ticker) return null;

  // Парсим дату погашения
  const maturityText = getText(2);
  const maturityDate = parseDate(maturityText);

  // Парсим доходность
  const yieldText = getText(3);
  const yield_ = parsePercent(yieldText);

  // Парсим цену
  const priceText = getText(4);
  const price = parseNumber(priceText);

  // Парсим объём
  const volumeText = getText(5);
  const volume = parseMillion(volumeText);

  // Парсим купон
  const couponText = getText(6);
  const couponAmount = parseNumber(couponText);

  // Парсим НКД
  const nkdText = getText(7);
  const nkd = parseNumber(nkdText);

  // Парсим дюрацию
  const durationText = getText(8);
  const durationDays = parseNumber(durationText);

  // Парсим дату купона
  const couponDateText = getText(9);
  const nextCouponDate = parseDate(couponDateText);

  // Парсим дату оферты
  const offerDateText = getText(10);
  const offerDate = parseDate(offerDateText);

   return {
     ticker,
     isin: '',
     maturityDate,
     yield: yield_,
     price,
     volume,
     couponAmount,
     nkd,
     durationDays,
     nextCouponDate,
     offerDate,
   };
}

/**
 * Парсить число из строки.
 */
function parseNumber(str: string): number | undefined {
  if (!str || str === '—') return undefined;
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * Парсить процент из строки (например, "16.6%").
 */
function parsePercent(str: string): number | undefined {
  if (!str || str === '—') return undefined;
  const cleaned = str.replace(/%/g, '').replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * Парсить число в миллионах из строки (например, "3 314,7").
 */
function parseMillion(str: string): number | undefined {
  if (!str || str === '—') return undefined;
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * Парсить дату из строки (например, "2038-10-06" или "06.10.2038").
 */
function parseDate(str: string): string | undefined {
  if (!str || str === '—') return undefined;

  // Формат YYYY-MM-DD
  const isoMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Формат DD.MM.YYYY
  const ruMatch = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (ruMatch) {
    return `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
  }

  return undefined;
}

// ──────────────────────────────────────────────
// 3. Main API Functions
// ──────────────────────────────────────────────

/**
 * Загрузить данные по конкретной облигации с Smart-Lab.
 *
 * @param isin — ISIN облигации (например, RU000A10GC20)
 * @returns данные облигации или null
 */
export async function fetchSmartLabBondByIsin(isin: string): Promise<SmartLabBond | null> {
  try {
    const normalizedIsin = isin.trim().toUpperCase();
    console.log(`[SmartLabApi] Загрузка данных по облигации ${normalizedIsin}...`);

    const html = await fetchSmartLab(`${SMARTLAB_BASE}/q/bonds/${normalizedIsin}/`);
    const bond = parseBondPage(html, normalizedIsin);

    if (bond) {
      console.log(`[SmartLabApi] ✅ Загружены данные: ${bond.ticker} (доходность: ${bond.yield}%), цена: ${bond.price}%`);
    } else {
      console.warn(`[SmartLabApi] ⚠️ Не удалось распарсить страницу для ${normalizedIsin}`);
    }

    return bond;
  } catch (error) {
    console.error(`[SmartLabApi] ❌ Ошибка загрузки ${isin}:`, error);
    return null;
  }
}

/**
 * Парсить страницу облигации с Smart-Lab.
 */
function parseBondPage(html: string, isin: string): SmartLabBond | null {
  const bond: SmartLabBond = { ticker: '', isin };

  // Извлекаем название облигации из заголовка
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const title = titleMatch[1].replace(/\s+/g, ' ').trim();
    // Формат: "Облигация ВИС ФИНАНС БО-П17 с фиксированным купоном  (RU000A10GC20) Доходность, Цена"
    const nameMatch = title.match(/Облигация\s+(.+?)\s+с\s+(.+?)\s+\((.+?)\)/i);
    if (nameMatch) {
      bond.ticker = nameMatch[1]?.trim() || '';
      bond.bondType = nameMatch[2]?.trim() || '';
    } else {
      bond.ticker = title.replace(/\s*с\s+.*$/, '').replace(/\s*Доходность.*$/, '').trim();
    }
  }

  // Парсим данные из структуры quotes-simple-table__row
  // Формат: <div class="quotes-simple-table__row" title="...">
  //           <div class="quotes-simple-table__item">Название</div>
  //           <div class="quotes-simple-table__item">Значение</div>
  //         </div>

  const extractFromRow = (label: string): string => {
    // Ищем row с указанным label, используя гибкий паттерн
    // label может содержать спецсимволы и HTML-теги внутри div
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<div[^>]*class="[^"]*quotes-simple-table__row[^"]*"[^>]*>[\\s\\S]*?<div[^>]*class="[^"]*quotes-simple-table__item[^"]*"[^>]*>[\\s\\S]*?${escapedLabel}[\\s\\S]*?</div>[\\s\\S]*?<div[^>]*class="[^"]*quotes-simple-table__item[^"]*"[^>]*>[\\s\\S]*?([^<]+?)<`,
      'i',
    );
    const match = html.match(regex);
    return match?.[1] ? match[1].replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ').trim() : '';
  };

  // Основные характеристики
  const priceText = extractFromRow('Котировка облигации') || extractFromRow('Котировка');
  bond.price = parseNumber(priceText);

  const yieldText = extractFromRow('Доходность');
  bond.yield = parsePercent(yieldText);

  const dailyChangeText = extractFromRow('Изм за день');
  bond.dailyChange = parsePercent(dailyChangeText);

  const volumeText = extractFromRow('Объем день, млн') || extractFromRow('Объем за день') || extractFromRow('Объем, млн') || extractFromRow('Объем') || extractFromRow('Объем за сегодня');
  bond.volume = parseMillion(volumeText);
  if (bond.volume) {
    console.log(`[SmartLabApi] ✅ Volume для ${bond.ticker}: ${bond.volume} млн руб`);
  }

  const volumeSharesText = extractFromRow('Объем день, штук');
  bond.volumeShares = parseNumber(volumeSharesText);

  const yearsText = extractFromRow('Лет до погашения');
  bond.yearsToMaturity = parseNumber(yearsText);

  const placementText = extractFromRow('Дата размещения');
  bond.placementDate = parseDate(placementText);

  const maturityText = extractFromRow('Дата погашения');
  bond.maturityDate = parseDate(maturityText);

  const offerText = extractFromRow('Дата оферты');
  bond.offerDate = offerText === '—' || offerText === '' ? undefined : parseDate(offerText);

  const durationText = extractFromRow('Дюрация, дней');
  bond.durationDays = parseNumber(durationText);

  const nominalText = extractFromRow('Номинал');
  bond.nominal = parseNumber(nominalText);

  const currencyText = extractFromRow('Валюта');
  bond.currency = currencyText || 'RUB';

  let ratingText = extractFromRow('Кредитный рейтинг') || extractFromRow('Рейтинг') || extractFromRow('рейтинг') || extractFromRow('ICBRR') || extractFromRow('рейтинг ICBRR') || extractFromRow('рейтинг МОEX');
  
  // Fallback 1: ищем «Кредитный рейтинг» через простой regex по всему HTML
  if (!ratingText) {
    const ratingFallback1 = html.match(/Кредитный\s+рейтинг[\s\S]{0,200}?>([^<]+)/i);
    if (ratingFallback1?.[1]) {
      ratingText = ratingFallback1[1].replace(/&[^;]+;/g, '').trim();
    }
  }
  
  // Fallback 2: ищем паттерн "Кредитный рейтинг" + значение в скобках или после двоеточия
  if (!ratingText) {
    const ratingFallback2 = html.match(/Кредитный\s+рейтинг[^>]*>([^<]*)/i);
    if (ratingFallback2?.[1]) {
      const cleaned = ratingFallback2[1].replace(/&[^;]+;/g, '').replace(/[\s]+/g, ' ').trim();
      if (cleaned && cleaned.length > 0 && cleaned !== '—') {
        ratingText = cleaned;
      }
    }
  }
  
  // Fallback 3: ищем评级 (рейтинг) с значением типа "A+", "BBB", "AAA" и т.д.
  if (!ratingText) {
    const ratingFallback3 = html.match(/Кредитный\s+рейтинг[\s\S]{0,300}?>\s*<[^>]*>\s*([A-Z]{1,4}\+?|-)/i);
    if (ratingFallback3?.[1]) {
      ratingText = ratingFallback3[1].trim();
    }
  }
  
  bond.rating = ratingText && ratingText !== '—' ? ratingText : undefined;
  if (bond.rating) {
    console.log(`[SmartLabApi] ✅ Rating для ${bond.ticker}: ${bond.rating}`);
  } else {
    console.log(`[SmartLabApi] ⚠️ Rating не найден для ${bond.ticker}`);
    // Debug: выводим часть HTML для отладки
    const ratingHtmlMatch = html.match(/Кредитный\s+рейтинг[\s\S]{0,500}/i);
    if (ratingHtmlMatch) {
      console.log('[SmartLabApi] 🔍 HTML вокруг "Кредитный рейтинг":', ratingHtmlMatch[0].substring(0, 300));
    }
  }

  const currentCouponText = extractFromRow('Текущ. дох. купона');
  bond.currentCouponYield = parsePercent(currentCouponText);

  const couponText = extractFromRow('Купон, руб');
  bond.couponAmount = parseNumber(couponText);

  const annualCouponText = extractFromRow('Годовой купон, руб');
  bond.annualCoupon = parseNumber(annualCouponText);

  const frequencyText = extractFromRow('Частота купона, раз в год');
  bond.couponFrequency = parseNumber(frequencyText);

  const gSpreadText = extractFromRow('G-спред');
  bond.gSpread = parseNumber(gSpreadText);

  const qualifiedText = extractFromRow('Только для квалов');
  bond.isQualifiedOnly = qualifiedText.toLowerCase().includes('да');

  const nextCouponText = extractFromRow('Дата след. выплаты');
  bond.nextCouponDate = parseDate(nextCouponText);

  const nkdText = extractFromRow('НКД');
  bond.nkd = parseNumber(nkdText);

  const couponDurationText = extractFromRow('Длительность купона, дней');
  bond.couponDuration = parseNumber(couponDurationText);

  const couponRateText = extractFromRow('Ставка купона');
  bond.couponRate = parsePercent(couponRateText);

  const sectorText = extractFromRow('Сектор');
  bond.sector = sectorText || undefined;

  const tradingModeText = extractFromRow('Режим торгов');
  bond.tradingMode = tradingModeText?.replace('&nbsp;', '') || undefined;

  const statusText = extractFromRow('Статус');
  bond.status = statusText || undefined;

  const listingLevelText = extractFromRow('Уровень листинга');
  bond.listingLevel = listingLevelText || undefined;

  const lotSizeText = extractFromRow('Размер лота');
  bond.lotSize = parseNumber(lotSizeText);

  const priceStepText = extractFromRow('Шаг цены');
  bond.priceStep = parseNumber(priceStepText);

  const issueVolumeText = extractFromRow('Объем выпуска, млн');
  bond.issueVolume = parseMillion(issueVolumeText);

  const outstandingVolumeText = extractFromRow('Объем в обращении, млн');
  bond.outstandingVolume = parseMillion(outstandingVolumeText);

  // Извлекаем эмитента из таблицы характеристик
  const issuerMatch = html.match(/Название[\s\S]{0,200}?>([^<]+)</i);
  if (issuerMatch?.[1]) {
    bond.issuer = issuerMatch[1].replace(/&amp;/g, '&').trim();
  }

  return bond;
}

/**
 * Загрузить котировки облигаций с Smart-Lab.
 *
 * @returns массив облигаций с котировками
 */
export async function fetchSmartLabBonds(): Promise<SmartLabBond[]> {
  try {
    console.log('[SmartLabApi] Загрузка котировок облигаций с Smart-Lab...');

    const html = await fetchSmartLab(`${SMARTLAB_BASE}/bonds/`);
    const bonds = parseBondsTable(html);

    console.log(`[SmartLabApi] ✅ Загружено ${bonds.length} облигаций`);
    return bonds;
  } catch (error) {
    console.error('[SmartLabApi] ❌ Ошибка загрузки:', error);
    return [];
  }
}

/**
 * Найти облигацию по тикеру/ISIN.
 *
 * @param bonds — массив облигаций
 * @param search — тикер или ISIN для поиска
 * @returns найденная облигация или null
 */
export function findBondByTicker(
  bonds: SmartLabBond[],
  search: string,
): SmartLabBond | null {
  const normalized = search.trim().toUpperCase();

  for (const bond of bonds) {
    const tickerUpper = bond.ticker.toUpperCase();
    if (
      tickerUpper === normalized ||
      tickerUpper.includes(normalized) ||
      normalized.includes(tickerUpper)
    ) {
      return bond;
    }
  }

  return null;
}

/**
 * Обогащение данных из Excel данными с Smart-Lab.
 *
 * @param excelBonds — Map<ISIN, BondReferenceData> из Excel
 * @returns обогащённый Map с дополнительными полями
 */
export async function enrichBondsFromSmartLab(
  excelBonds: Map<string, import('../xlsx-parser/xlsx-parser.js').BondReferenceData>,
): Promise<Map<string, import('../xlsx-parser/xlsx-parser.js').BondReferenceData & { smartlab: SmartLabBond | null }>> {
  const smartlabBonds = await fetchSmartLabBonds();

  const enriched = new Map<string, import('../xlsx-parser/xlsx-parser.js').BondReferenceData & { smartlab: SmartLabBond | null }>();

  for (const [isin, bond] of excelBonds) {
    // Ищем по ISIN и по имени
    const smartlabBond = findBondByTicker(smartlabBonds, isin);
    enriched.set(isin, {
      ...bond,
      smartlab: smartlabBond || null,
    });
  }

  console.log(`[SmartLabApi] 🔄 Обогащено ${enriched.size} позиций`);
  return enriched;
}

// ──────────────────────────────────────────────
// 4. Экспорт
// ──────────────────────────────────────────────

export default {
  fetchSmartLabBonds,
  findBondByTicker,
  enrichBondsFromSmartLab,
};
