import axios from 'axios';

export interface CbrRateData {
  rate: number;
  date: string;
  source: string;
  lastUpdated: string;
}

interface FinamApiResponse {
  keyRate?: number;
  cbrRate?: number;
  rate?: number;
}

// Кэш в памяти: ставка + время последнего получения
let cachedRate: CbrRateData | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

/**
 * Получить ключевую ставку ЦБ РФ с нескольких источников.
 * Использует кэширование на 24 часа для избежания лишних запросов.
 *
 * Источники (по приоритету):
 * 1. cbr-credit.ru (XML) — быстрый и стабильный
 * 2. cbr.ru (HTML-парсинг) — официальный источник
 * 3. fallback — захардкоженное значение (текущая известная ставка)
 */
export async function getCbrKeyRate(): Promise<CbrRateData> {
  // Проверяем кэш
  if (cachedRate && Date.now() - new Date(cachedRate.lastUpdated).getTime() < CACHE_TTL_MS) {
    return cachedRate;
  }

  try {
    // Источник 1: cbr-credit.ru XML API
    const rate = await fetchFromCbrCredit();
    if (rate) {
      cachedRate = rate;
      return rate;
    }
  } catch {
    // Переходим к следующему источнику
  }

  try {
    // Источник 2: cbr.ru HTML парсинг
    const rate = await fetchFromCbrRu();
    if (rate) {
      cachedRate = rate;
      return rate;
    }
  } catch {
    // Переходим к следующему источнику
  }

  try {
    // Источник 3: api.finam.ru
    const rate = await fetchFromFinam();
    if (rate) {
      cachedRate = rate;
      return rate;
    }
  } catch {
    // Переходим к fallback
  }

  // Fallback: известная текущая ставка (обновляется вручную)
  const fallbackRate: CbrRateData = {
    rate: 14.0,
    date: '2026-07-27',
    source: 'fallback (ручная актуализация)',
    lastUpdated: new Date().toISOString(),
  };

  console.warn(
    '⚠️ [ЦБ-СТАВКА] Не удалось получить данные из внешних источников. ' +
      'Используется fallback: ' +
      fallbackRate.rate +
      '%',
  );

  cachedRate = fallbackRate;
  return fallbackRate;
}

/**
 * Источник 1: cbr-credit.ru XML API
 * Возвращает XML с текущей ключевой ставкой
 */
async function fetchFromCbrCredit(): Promise<CbrRateData | null> {
  const url =
    'https://www.cbr-credit.ru/scripts/XML_daily.asp?date1=&date2=&val_name=CBRATE';

  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'finance-analyzer/1.0' },
  });

  const xml = response.data;

  // Парсим XML: <val CURRENCY="RUB.948" Name="Ключевая ставка ЦБ РФ" Value="21"/>
  const valueMatch = xml.match(/Name="Ключевая ставка ЦБ РФ"[^>]*Value="([^"]+)"/);
  const dateMatch = xml.match(/date="(\d{2}\.\d{2}\.\d{4})"/);

  if (valueMatch) {
    const rate = parseFloat(valueMatch[1]);
    const date = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('ru-RU');

    return {
      rate,
      date,
      source: 'cbr-credit.ru',
      lastUpdated: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Источник 2: cbr.ru — официальный сайт ЦБ РФ
 * Парсит HTML-страницу с ключевой ставкой
 */
async function fetchFromCbrRu(): Promise<CbrRateData | null> {
  const url = 'https://www.cbr.ru/';

  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'finance-analyzer/1.0' },
  });

  const html = response.data;

  // Ищем ключевую ставку в JSON-данных страницы или в специальных тегах
  // ЦБ размещает данные в формате: {"keyRate": 21}
  const jsonMatch = html.match(/"keyRate"\s*:\s*(\d+\.?\d*)/);
  if (jsonMatch) {
    const rate = parseFloat(jsonMatch[1]);
    return {
      rate,
      date: new Date().toLocaleDateString('ru-RU'),
      source: 'cbr.ru',
      lastUpdated: new Date().toISOString(),
    };
  }

  // Паттерн: "Ключевая ставка" + значение в формате 14,00%
  const rateTextMatch = html.match(
    /Ключевая ставка[^"]*"([^"]+)"/,
  );
  if (rateTextMatch) {
    const rateStr = rateTextMatch[1].replace('%', '').replace(',', '.');
    const rate = parseFloat(rateStr);
    if (!isNaN(rate) && rate > 0 && rate < 100) {
      return {
        rate,
        date: new Date().toLocaleDateString('ru-RU'),
        source: 'cbr.ru',
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  // Альтернативный паттерн: ищем "Ключевая ставка" и значение рядом (14,00%)
  const altMatch = html.match(
    /Ключевая ставка[\s\S]{0,60}?\b(\d{1,2},\d{2})%/,
  );
  if (altMatch) {
    const rate = parseFloat(altMatch[1].replace(',', '.'));
    if (!isNaN(rate) && rate > 0 && rate < 100) {
      // Ищем дату "с ДД.ММ.ГГГГ" рядом
      const dateMatch = html.match(/с\s+(\d{2}\.\d{2}\.\d{4})/);
      const date = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('ru-RU');
      return {
        rate,
        date,
        source: 'cbr.ru',
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  return null;
}

/**
 * Источник 3: API Финам
 * Получает данные о ключевой ставке через API
 */
async function fetchFromFinam(): Promise<CbrRateData | null> {
  const url = 'https://api.finam.ru/api/v1/marketinfo/get?code=RTS';

  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'finance-analyzer/1.0' },
  });

  // Проверяем, есть ли в ответе данные о ставке
  if (response.data && typeof response.data === 'object') {
    // Проверяем известные поля
    const rate =
      (response.data as FinamApiResponse).keyRate ||
      (response.data as FinamApiResponse).cbrRate ||
      (response.data as FinamApiResponse).rate;

    if (rate && typeof rate === 'number' && rate > 0 && rate < 100) {
      return {
        rate,
        date: new Date().toLocaleDateString('ru-RU'),
        source: 'finam.ru',
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  return null;
}

/**
 * Очистить кэш (для тестирования)
 */
export function clearCbrRateCache(): void {
  cachedRate = null;
}

/**
 * Получить отформатированную строку для отображения
 */
export function formatCbrRateDisplay(rateData: CbrRateData): string {
  return (
    'Ключевая ставка ЦБ: <strong>' +
    rateData.rate +
    '%</strong> ' +
    '(от ' +
    rateData.date +
    ')<br>' +
    '<span style="font-size:10px;color:#8b949e;">Источник: ' +
    rateData.source +
    '</span>'
  );
}
