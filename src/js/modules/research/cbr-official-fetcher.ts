/**
 * Официальный фетчер ключевой ставки ЦБ РФ.
 *
 * Источник: cbr.ru/hd_base/KeyRate/
 *
 * Особенности:
 * - SOAP KeyRateXML — приоритетный источник (официальный XML-канал ЦБ)
 * - hd_base/KeyRate с браузерными заголовками — резерв
 * - User-Agent: браузерный (cbr.ru блокирует без него).
 * - Timeout: 10 секунд.
 * - Retry: при 403/429 — повтор с паузой 2с, до 2 попыток.
 * - Fallback: MOEX ISS (статистика ставок).
 */

import { MacroResearch, ResearchValue } from './types.js';

const CBR_SOAP_URL =
  'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx';
const CBR_HD_URL = 'https://www.cbr.ru/hd_base/KeyRate/';
const CBR_TIMEOUT_MS = 10_000;
const CBR_MAX_RETRIES = 2;
const CBR_RETRY_DELAY_MS = 2_000;

/**
 * SOAP-запрос для получения ключевой ставки.
 *
 * ЦБ возвращает XML в кодировке windows-1251.
 * При ошибке сервис возвращает 200 OK с пустым <KeyRate><Error />.
 */
async function fetchCbrKeyRateSoap(): Promise<
  | { rate: number; date: string; source: string }
  | { error: string }
> {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <KeyRateXML xmlns="https://www.cbr.ru/" />
  </soap:Body>
</soap:Envelope>`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CBR_TIMEOUT_MS);

    const response = await fetch(CBR_SOAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/xml',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        Referer: 'https://www.cbr.ru/',
      },
      body: soapBody,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log(
      `[CBR_FETCH] SOAP attempt=1 status=${response.status} ` +
        `url=${CBR_SOAP_URL}`,
    );

    if (!response.ok) {
      return { error: `SOAP HTTP ${response.status} ${response.statusText}` };
    }

    // CBR возвращает windows-1251 — читаем как текст, парсим байтами.
    const rawBytes = new Uint8Array(await response.arrayBuffer());
    let xmlText: string;
    try {
      const decoder = new TextDecoder('windows-1251', { fatal: false });
      xmlText = decoder.decode(rawBytes);
    } catch {
      const decoder = new TextDecoder('latin1');
      xmlText = decoder.decode(rawBytes);
    }

    // Валидация: проверяем наличие <Error /> — значит сервис вернул ошибку
    const errorMatch = xmlText.match(/<Error[^>]*>([^<]*)<\/Error>/i);
    if (errorMatch?.[1]?.trim()) {
      return { error: `SOAP Error: ${errorMatch[1].trim()}` };
    }

    // Парсим ставку: <KeyRate>14.0</KeyRate>
    const rateMatch = xmlText.match(
      /<KeyRate[^>]*>([\d.,]+)<\/KeyRate>/i,
    );
    if (!rateMatch?.[1]) {
      return { error: 'SOAP XML не содержит <KeyRate>' };
    }

    const rate = parseFloat(rateMatch[1].replace(',', '.'));
    if (isNaN(rate) || rate <= 0 || rate > 100) {
      return { error: `SOAP невалидная ставка: ${rateMatch[1]}` };
    }

    // Парсим дату: <Date>2026-11-24</Date>
    const dateMatch = xmlText.match(
      /<Date[^>]*>(\d{4}-\d{2}-\d{2})<\/Date>/i,
    );
    const date = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10);

    return { rate, date, source: 'KeyRateXML (cbr.ru)' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `SOAP запрос: ${msg}` };
  }
}

/** Парсинг даты из строки cbr.ru (ДД.ММ.ГГГГ или ISO). */
function parseCbrDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
}

/** Запрос к cbr.ru hd_base/KeyRate с браузерными заголовками. */
async function fetchCbrKeyRateHdBase(): Promise<
  | { rate: number; date: string; source: string }
  | { error: string }
> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    Referer: 'https://www.cbr.ru/',
  };

  for (let attempt = 1; attempt <= CBR_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CBR_TIMEOUT_MS);

      const response = await fetch(CBR_HD_URL, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(
        `[CBR_FETCH] hd_base attempt=${attempt} status=${response.status} ` +
          `url=${CBR_HD_URL}`,
      );

      if (!response.ok) {
        if (response.status === 403 || response.status === 429) {
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, CBR_RETRY_DELAY_MS));
            continue;
          }
          return { error: `HTTP ${response.status} после ${attempt} попыток` };
        }
        return { error: `HTTP ${response.status}` };
      }

      const html = await response.text();

      // Парсим: <td>14,0%</td> в строке «Ключевая ставка»
      const rateMatch = html.match(
        /Ключевая ставка.*?<td>([\d,]+)%/i,
      );

      if (rateMatch?.[1]) {
        const rate = parseFloat(rateMatch[1].replace(',', '.'));
        if (!isNaN(rate) && rate > 0 && rate < 100) {
          const dateMatch = html.match(
            /<meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["']/i,
          );
          const dateRaw = dateMatch?.[1];
          const date = dateRaw
            ? parseCbrDate(dateRaw)
            : new Date().toISOString().slice(0, 10);
          return { rate, date, source: 'hd_base/KeyRate (cbr.ru)' };
        }
      }

      return { error: 'Не удалось распарсить ставку из HTML' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, CBR_RETRY_DELAY_MS));
        continue;
      }
      return { error: msg };
    }
  }

  return { error: 'Исчерпаны все попытки' };
}

/**
 * Fallback: MOEX ISS — статистика ставок.
 */
async function fetchMoexRatesFallback(): Promise<
  | { rate: number; date: string; source: string }
  | null
> {
  try {
    // MOEX ISS: statid=1346 — средневзвешенные ставки по депозитам
    const url =
      'https://iss.moex.com/iss/statistics/standart.json?statid=1346';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CBR_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const json = await response.json() as Record<string, unknown>;
    const statistic = json?.statistic as unknown[] | undefined;
    const statItem = statistic?.[0] as Record<string, unknown> | undefined;
    if (!statItem) return null;

    const rows = statItem.data as unknown[][] | undefined;
    const columns = statItem.columns as Array<{ name?: string }> | undefined;
    if (!rows || rows.length === 0 || !columns) return null;

    // Ищем колонку со ставкой
    const rateColIndex = columns.findIndex((c) =>
      c.name?.toLowerCase().includes('rate') ||
      c.name?.toLowerCase().includes('ставка'),
    );
    const dateColIndex = columns.findIndex((c) =>
      c.name?.toLowerCase().includes('date') ||
      c.name?.toLowerCase().includes('дата'),
    );

    if (rateColIndex < 0) return null;

    const lastRow = rows[rows.length - 1] as unknown[] | undefined;
    if (!lastRow) return null;
    const rateValue = parseFloat(
      String(lastRow[rateColIndex]).replace(',', '.'),
    );
    if (isNaN(rateValue) || rateValue <= 0) return null;

    const dateValue =
      dateColIndex >= 0
        ? String(lastRow[dateColIndex])
        : new Date().toISOString().slice(0, 10);

    return {
      rate: rateValue,
      date: dateValue,
      source: 'MOEX ISS',
    };
  } catch {
    return null;
  }
}

/**
 * Получить ключевую ставку ЦБ РФ.
 *
 * Приоритет:
 * 1. SOAP KeyRateXML (официальный XML-канал ЦБ)
 * 2. hd_base/KeyRate с браузерными заголовками
 * 3. MOEX ISS fallback
 */
export class CbrOfficialFetcher {
  async fetch(): Promise<MacroResearch> {
    let keyRate: ResearchValue<number> = { status: 'NO_DATA' };

    // 1. SOAP KeyRateXML — приоритетный источник
    const soapResult = await fetchCbrKeyRateSoap();
    if ('rate' in soapResult) {
      keyRate = {
        status: 'VALUE',
        value: soapResult.rate,
        source: soapResult.source,
      };
      console.log(
        `[CBR_FETCH] SOAP OK: rate=${soapResult.rate} source=${soapResult.source}`,
      );
    } else {
      console.log(
        `[CBR_FETCH] SOAP: ${soapResult.error} — фолбэк на hd_base`,
      );
    }

    // 2. hd_base/KeyRate — резерв
    if (keyRate.status !== 'VALUE') {
      const hdResult = await fetchCbrKeyRateHdBase();
      if ('rate' in hdResult) {
        keyRate = {
          status: 'VALUE',
          value: hdResult.rate,
          source: hdResult.source,
        };
        console.log(
          `[CBR_FETCH] hd_base OK: rate=${hdResult.rate} source=${hdResult.source}`,
        );
      } else {
        console.log(
          `[CBR_FETCH] hd_base: ${hdResult.error} — фолбэк на MOEX`,
        );
      }
    }

    // 3. Fallback: MOEX ISS
    if (keyRate.status !== 'VALUE') {
      const moexResult = await fetchMoexRatesFallback();
      if (moexResult) {
        keyRate = {
          status: 'VALUE',
          value: moexResult.rate,
          source: moexResult.source,
        };
      } else {
        console.log('[CBR_FETCH] MOEX ISS fallback: нет данных');
      }
    }

    return {
      keyRate,
      inflation: { status: 'NO_DATA' },
      inflationTrend: { status: 'NO_DATA' },
      fx: { status: 'NO_DATA' },
      oil: { status: 'NO_DATA' },
      commodityRegime: { status: 'NO_DATA' },
      liquidityRegime: { status: 'NO_DATA' },
      economicCycle: { status: 'NO_DATA' },
      rateRegime: { status: 'NO_DATA' },
    };
  }
}
