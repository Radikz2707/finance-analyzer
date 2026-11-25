/**
 * Ключевая ставка ЦБ РФ — получение с приоритетом источников.
 *
 * Приоритет:
 * 1. SOAP-канал ЦБ: https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx,
 *    метод KeyRateXML — ответ в windows-1251, валидация обязательна.
 * 2. hd_base/KeyRate с браузерными заголовками — текущий фетчер.
 * 3. CBK_RATE_OVERRIDE — env-переменная, последний уровень.
 */

import { append } from './diagnostic-log-collector.js';

// ─── Типы ────────────────────────────────────────────────────────────────

export interface CbrRateData {
  rate: number;
  date: string;
  source: string;
  lastUpdated: string;
  isFresh: boolean;
}

// ─── Кэш ─────────────────────────────────────────────────────────────────

let cachedRate: CbrRateData | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

// ─── 1. SOAP KeyRateXML ──────────────────────────────────────────────────

const CBR_SOAP_URL = 'https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx';

/**
 * SOAP-запрос для получения ключевой ставки.
 *
 * ЦБ возвращает XML в кодировке windows-1251.
 * При ошибке сервис возвращает 200 OK с пустым <KeyRate><Error />.
 */
async function fetchCbrKeyRateSoap(): Promise<
  { rate: number; date: string } | { error: string }
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
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

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
      `[CBR_FETCH] SOAP status=${response.status} url=${CBR_SOAP_URL}`,
    );

    if (!response.ok) {
      return { error: `SOAP HTTP ${response.status} ${response.statusText}` };
    }

    // CBR возвращает windows-1251 — читаем как текст, парсим байтами.
    const rawBytes = new Uint8Array(await response.arrayBuffer());
    let xmlText: string;
    try {
      // decoder.decode() корректно обрабатывает windows-1251
      const decoder = new TextDecoder('windows-1251', { fatal: false });
      xmlText = decoder.decode(rawBytes);
    } catch {
      // Если windows-1251 не поддерживается, пробуем latin1
      const decoder = new TextDecoder('latin1');
      xmlText = decoder.decode(rawBytes);
    }

    // Валидация: проверяем наличие <Error /> — значит сервис вернул ошибку
    const errorMatch = xmlText.match(/<Error[^>]*>([^<]*)<\/Error>/i);
    if (errorMatch?.[1]?.trim()) {
      return { error: `SOAP Error: ${errorMatch[1].trim()}` };
    }

    // Парсим ставку: <KeyRate>14.0</KeyRate>
    const rateMatch = xmlText.match(/<KeyRate[^>]*>([\d.,]+)<\/KeyRate>/i);
    if (!rateMatch?.[1]) {
      return { error: 'SOAP XML не содержит <KeyRate>' };
    }

    const rate = parseFloat(rateMatch[1].replace(',', '.'));
    if (isNaN(rate) || rate <= 0 || rate > 100) {
      return { error: `SOAP невалидная ставка: ${rateMatch[1]}` };
    }

    // Парсим дату: <Date>2026-11-24</Date>
    const dateMatch = xmlText.match(/<Date[^>]*>(\d{4}-\d{2}-\d{2})<\/Date>/i);
    const date = dateMatch?.[1] ?? new Date().toISOString().slice(0, 10);

    return { rate, date };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `SOAP запрос: ${msg}` };
  }
}

// ─── 2. hd_base/KeyRate с браузерными заголовками ────────────────────────

const CBR_HD_URL = 'https://www.cbr.ru/hd_base/KeyRate/';

async function fetchCbrKeyRateHdBase(): Promise<
  { rate: number; date: string } | { error: string }
> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    Referer: 'https://www.cbr.ru/',
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

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
            await new Promise((r) => setTimeout(r, 2_000));
            continue;
          }
          return { error: `HTTP ${response.status} после ${attempt} попыток` };
        }
        return { error: `HTTP ${response.status}` };
      }

      const html = await response.text();

      // cbr.ru отдаёт таблицу <tr><td>17.11.2026</td><td>14,00</td></tr>
      // без знака «%». Берём все строки и выбираем самую свежую дату.
      const rowPattern =
        /<tr[^>]*>\s*<td[^>]*>\s*(\d{2}\.\d{2}\.\d{4})\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<\/tr>/gi;
      const rows = [...html.matchAll(rowPattern)];
      let best: { rate: number; date: string; time: number } | null = null;
      for (const row of rows) {
        const dateRaw = row[1] ?? '';
        const rateRaw = row[2] ?? '';
        const rate = parseFloat(rateRaw.replace(',', '.'));
        if (!Number.isFinite(rate) || rate <= 0 || rate >= 100) continue;
        const date = parseCbrDate(dateRaw);
        const time = new Date(date).getTime();
        if (!best || (Number.isFinite(time) && time > best.time)) {
          best = { rate, date, time: Number.isFinite(time) ? time : 0 };
        }
      }
      if (best) {
        return { rate: best.rate, date: best.date };
      }

      // Резервный формат: <td>14,0%</td>.
      const percentMatch = html.match(
        /Ключевая ставка.*?<td>\s*([\d.,]+)\s*%/i,
      );
      if (percentMatch?.[1]) {
        const rate = parseFloat(percentMatch[1].replace(',', '.'));
        if (Number.isFinite(rate) && rate > 0 && rate < 100) {
          const dateMatch = html.match(
            /<meta[^>]*name=["']date["'][^>]*content=["']([^"']+)["']/i,
          );
          const dateRaw = dateMatch?.[1];
          const date = dateRaw
            ? parseCbrDate(dateRaw)
            : new Date().toISOString().slice(0, 10);
          return { rate, date };
        }
      }

      return { error: 'Не удалось распарсить ставку из HTML' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2_000));
        continue;
      }
      return { error: msg };
    }
  }

  return { error: 'Исчерпаны все попытки' };
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

// ─── 3. CBK_RATE_OVERRIDE (env) — последний уровень ──────────────────────

function readEnvOverride(): CbrRateData | null {
  const overrideRate = process.env.CBK_RATE_OVERRIDE;
  if (!overrideRate) return null;

  const atIdx = overrideRate.lastIndexOf('@');
  let rawRate: string;
  let overrideDate: string | undefined;

  if (atIdx > 0) {
    rawRate = overrideRate.slice(0, atIdx).trim();
    overrideDate = overrideRate.slice(atIdx + 1).trim();
  } else {
    rawRate = overrideRate.trim();
  }

  const rate = parseFloat(rawRate);
  if (isNaN(rate) || rate <= 0 || rate > 100) return null;

  return {
    rate,
    date: overrideDate || new Date().toLocaleDateString('ru-RU'),
    source: `ручная настройка (CBK_RATE_OVERRIDE${overrideDate ? ', дата ' + overrideDate : ''})`,
    lastUpdated: new Date().toISOString(),
    isFresh: true,
  };
}

// ─── Основной метод ──────────────────────────────────────────────────────

/**
 * Получить ключевую ставку ЦБ РФ.
 *
 * Приоритет источников:
 * 1. SOAP KeyRateXML (официальный канал ЦБ)
 * 2. hd_base/KeyRate с браузерными заголовками
 * 3. CBK_RATE_OVERRIDE (env) — последний уровень
 */
export async function getCbrKeyRate(): Promise<CbrRateData> {
  // 1. Кэш в памяти (5 минут)
  if (
    cachedRate &&
    Date.now() - new Date(cachedRate.lastUpdated).getTime() < CACHE_TTL_MS
  ) {
    append(
      'CBR_FETCH',
      `final source=${cachedRate.source} rate=${cachedRate.rate} isFresh=${cachedRate.isFresh} cache=hit`,
    );
    return cachedRate;
  }

  // 2. SOAP KeyRateXML — основной источник
  const soapResult = await fetchCbrKeyRateSoap();
  if ('rate' in soapResult) {
    cachedRate = {
      rate: soapResult.rate,
      date: soapResult.date,
      source: 'KeyRateXML (cbr.ru)',
      lastUpdated: new Date().toISOString(),
      isFresh: true,
    };
    console.log(
      '[ЦБ-СТАВКА] rate=' +
        cachedRate.rate.toFixed(2) +
        ' fresh=true source=KeyRateXML',
    );
    append(
      'CBR_FETCH',
      `final source=${cachedRate.source} rate=${cachedRate.rate} isFresh=${cachedRate.isFresh}`,
    );
    return cachedRate;
  }

  console.log(
    '[ЦБ-СТАВКА] SOAP KeyRateXML: ' + soapResult.error + ' — фолбэк на hd_base',
  );

  // 3. hd_base/KeyRate — резерв
  const hdResult = await fetchCbrKeyRateHdBase();
  if ('rate' in hdResult) {
    cachedRate = {
      rate: hdResult.rate,
      date: hdResult.date,
      source: 'hd_base/KeyRate (cbr.ru)',
      lastUpdated: new Date().toISOString(),
      isFresh: true,
    };
    console.log(
      '[ЦБ-СТАВКА] rate=' +
        cachedRate.rate.toFixed(2) +
        ' fresh=true source=hd_base',
    );
    append(
      'CBR_FETCH',
      `final source=${cachedRate.source} rate=${cachedRate.rate} isFresh=${cachedRate.isFresh}`,
    );
    return cachedRate;
  }

  console.log(
    '[ЦБ-СТАВКА] hd_base/KeyRate: ' + hdResult.error + ' — фолбэк на override',
  );

  // 4. CBK_RATE_OVERRIDE — последний уровень
  const envOverride = readEnvOverride();
  if (envOverride) {
    cachedRate = envOverride;
    console.log(
      '[ЦБ-СТАВКА] rate=' +
        cachedRate.rate.toFixed(2) +
        ' fresh=true source=CBK_RATE_OVERRIDE',
    );
    append(
      'CBR_FETCH',
      `final source=${cachedRate.source} rate=${cachedRate.rate} isFresh=${cachedRate.isFresh}`,
    );
    return cachedRate;
  }

  // 5. Fallback: последняя известная ставка
  const fallbackRate: CbrRateData = {
    rate: 14.0,
    date: '2026-09-08',
    source: 'fallback (cbr.ru недоступен, данные устарели)',
    lastUpdated: new Date().toISOString(),
    isFresh: false,
  };
  cachedRate = fallbackRate;
  console.warn(
    '[ЦБ-СТАВКА] ⚠️ Fallback: ставка 14.0% от 2026-09-08 — данные устарели, ' +
      `cbr.ru недоступен. lastUpdated=${cachedRate.lastUpdated}`,
  );
  append(
    'CBR_FETCH',
    `final source=${cachedRate.source} rate=${cachedRate.rate} isFresh=${cachedRate.isFresh}`,
  );
  return cachedRate;
}

// ─── Утилиты ─────────────────────────────────────────────────────────────

/** Очистить кэш (для тестирования) */
export function clearCbrRateCache(): void {
  cachedRate = null;
}

/** Получить отформатированную строку для отображения */
export function formatCbrRateDisplay(rateData: CbrRateData): string {
  return (
    'Ключевая ставка ЦБ: ' +
    rateData.rate +
    '% ' +
    '(от ' +
    rateData.date +
    ') ' +
    'Источник: ' +
    rateData.source
  );
}

/** Получить текущее значение кэша (для тестирования) */
export function getCachedRate(): CbrRateData | null {
  return cachedRate;
}
