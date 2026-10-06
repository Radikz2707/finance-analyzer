/**
 * Интеграционные smoke-тесты реальных API (MOEX ISS / CBR / Finam / Google News RSS).
 *
 * НЕ выполняются в обычном прогоне (`npm run test:run`): каждый тест обёрнут
 * в `it.skipIf(shouldSkip(name))`, где `shouldSkip` возвращает true, пока
 * переменная окружения `RUN_INTEGRATION` не равна '1'.
 *
 * Запуск: `npm run test:integration`
 *   (= cross-env RUN_INTEGRATION=1 vitest run src/js/modules/integration-tests)
 *
 * Философия smoke-теста:
 * - assert'ы ТОЛЬКО на ФОРМУ ответа (поля, типы, непустые массивы), НЕ на цены;
 * - недоступность сети / API → тест падает с ясной причиной (smoke сигнализирует);
 * - каждый сетевой вызов — с таймаутом (fetchWithTimeout), тест — до 30 с;
 * - Google News RSS может быть заблокирован на территории РФ → retry 1× и
 *   понятное сообщение в случае финальной недоступности.
 *
 * ВАЖНО: используются ГЛОБАЛЬНЫЕ API vitest (globals: true) — как в остальных
 * тестах проекта (явный import из 'vitest' ломает runner при CLI-фильтрах).
 *
 * Не импортируем moex-api/finam-api history-provider'ы напрямую: их импорт
 * тянет `db-manager` (side-effect: создаёт data/finance.db). Вместо этого
 * дёргаем те же эндпоинты через fetch с проверкой формата, а «живые» классы
 * используем там, где они безопасны (fetcher'ы research-слоя без side-effect'ов).
 */

import { MacroFetcher } from '../research/providers/macro-fetcher.js';
import { CbrOfficialFetcher } from '../research/providers/cbr-official-fetcher.js';
import {
  NewsFetcher,
  type FetchResult,
} from '../research/providers/news-fetcher.js';
import { MarketDataProvider } from '../research/providers/market-provider.js';
import { MacroResearchProvider } from '../research/providers/macro-provider.js';
import { NewsResearchProvider } from '../research/providers/news-provider.js';
import type {
  ResearchAsset,
  ResearchContext,
  ResearchProvider,
} from '../research/providers/types.js';
import { hasValue } from '../research/helpers.js';

// ──────────────────────────────────────────────
// Контроль пропуска: RUN_INTEGRATION=1 включает тесты
// ──────────────────────────────────────────────

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1';
const SKIP_HINT = 'запустите npm run test:integration (RUN_INTEGRATION=1)';

/** Возвращает true, если тест нужно пропустить (интеграция выключена) */
function shouldSkip(_name: string): boolean {
  return !RUN_INTEGRATION;
}

if (!RUN_INTEGRATION) {
  console.warn(
    `[integration] Smoke-тесты реальных API пропущены — ${SKIP_HINT}`,
  );
}

// ──────────────────────────────────────────────
// Helpers: сетевые запросы с таймаутом и понятными ошибками
// ──────────────────────────────────────────────

/** fetch с таймаутом; при сбое бросает Error с ясной причиной */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} для ${url}`,
      );
    }
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timeout ${timeoutMs}ms при запросе ${url}`, {
        cause: err,
      });
    }
    throw err instanceof Error ? err : new Error(String(err), { cause: err });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** sleep для retry между попытками */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Таблица ISS (candles / marketdata): columns + data */
interface IssTable {
  columns?: string[];
  data?: unknown[][];
}

/** Ответ MOEX ISS (используем только нужные блоки) */
interface IssResponse {
  candles?: IssTable;
  marketdata?: IssTable;
}

/** Типовой актив STOCK для research-провайдеров */
const stockAsset: ResearchAsset = {
  ticker: 'SBER',
  name: 'ПАО Сбербанк',
  assetType: 'STOCK',
  issuer: 'ПАО Сбербанк',
  currency: 'RUB',
  market: 'MOEX',
};

// ═══════════════════════════════════════════════
// MOEX ISS (открытый API, без ключей)
// ═══════════════════════════════════════════════

describe('API smoke: MOEX ISS (открытый API, без ключей)', () => {
  it.skipIf(shouldSkip('MOEX history SBER'))(
    'MOEX ISS: история цен SBER (candles → массив свечей с датой/ценой)',
    async () => {
      const url =
        'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/SBER/candles.json?interval=24';
      const response = await fetchWithTimeout(url);
      const body = (await response.json()) as IssResponse;

      expect(body.candles, 'MOEX ISS: в ответе нет блока candles').toBeTruthy();
      const columns = body.candles!.columns ?? [];
      const rows = body.candles!.data ?? [];

      const dateIdx = columns.indexOf('begin');
      const closeIdx = columns.indexOf('close');
      expect(dateIdx, 'MOEX ISS: нет колонки begin').toBeGreaterThanOrEqual(0);
      expect(closeIdx, 'MOEX ISS: нет колонки close').toBeGreaterThanOrEqual(0);
      expect(rows.length, 'MOEX ISS: пустой массив свечей').toBeGreaterThan(0);

      const firstRow = rows[0]!;
      const dateRaw = firstRow[dateIdx];
      const closeRaw = firstRow[closeIdx];
      expect(typeof dateRaw, 'MOEX ISS: begin не строка').toBe('string');
      expect(
        String(dateRaw ?? ''),
        'MOEX ISS: begin не дата YYYY-MM-DD',
      ).toMatch(/^\d{4}-\d{2}-\d{2}/);
      const close = Number(closeRaw);
      expect(
        Number.isFinite(close) && close > 0,
        `MOEX ISS: close не положительное число (${String(closeRaw)})`,
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(shouldSkip('MOEX marketdata SBER'))(
    'MOEX ISS: текущая цена SBER (marketdata) → MarketDataProvider',
    async () => {
      // Не фильтруем columns: LASTCHANGEPCT может отсутствовать в marketdata
      const url =
        'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/SBER.json' +
        '?iss.meta=off&iss.only=marketdata';
      const response = await fetchWithTimeout(url);
      const body = (await response.json()) as IssResponse;

      expect(body.marketdata, 'MOEX ISS: нет блока marketdata').toBeTruthy();
      const columns = body.marketdata!.columns ?? [];
      const rows = body.marketdata!.data ?? [];

      const lastIdx = columns.indexOf('LAST');
      // LASTCHANGEPCT опционален: у SBER в marketdata его может не быть
      const changeIdx = columns.indexOf('LASTCHANGEPCT');
      expect(lastIdx, 'MOEX ISS: нет колонки LAST').toBeGreaterThanOrEqual(0);
      expect(
        rows.length,
        'MOEX ISS: пустая таблица marketdata',
      ).toBeGreaterThan(0);

      const lastRaw = rows[0]![lastIdx];
      const last = Number(lastRaw);
      expect(
        Number.isFinite(last) && last > 0,
        `MOEX ISS: LAST не положительное число (${String(lastRaw)})`,
      ).toBe(true);

      // Прогоняем ЖИВУЮ котировку MOEX через реальный MarketDataProvider
      const provider = new MarketDataProvider();
      const context: ResearchContext = {
        researchTimestamp: new Date().toISOString(),
        marketQuotes: {
          SBER: {
            currentPrice: last,
            dailyDynamicsPercent: Number(rows[0]![changeIdx] ?? 0) || 0,
            shortName: 'Сбербанк',
          },
        },
        macroData: {},
        newsData: [],
        sources: [{ name: 'MOEX', fetchedAt: new Date().toISOString() }],
      };
      const snapshot = await provider.research(stockAsset, context);

      const currentPrice = snapshot.marketResearch?.currentPrice;
      expect(
        currentPrice,
        'MarketDataProvider: currentPrice отсутствует',
      ).toBeDefined();
      expect(
        hasValue(currentPrice!),
        'MarketDataProvider: currentPrice не VALUE после live-котировки MOEX',
      ).toBe(true);
      expect(currentPrice!.value).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════
// CBR: курсы валют и ключевая ставка (без ключей)
// ═══════════════════════════════════════════════

describe('API smoke: CBR (официальные источники, без ключей)', () => {
  it.skipIf(shouldSkip('CBR XML daily'))(
    'CBR: официальный XML курса USD/RUB (XML → число)',
    async () => {
      const url = 'https://www.cbr.ru/scripts/XML_daily.asp';
      const response = await fetchWithTimeout(url, {}, 20_000);
      const xml = await response.text();

      expect(xml.length, 'CBR XML: пустой ответ').toBeGreaterThan(0);
      // Внутри блока <Valute> для USD: <CharCode>USD</CharCode> ... <Value>92,3456</Value>
      const usdMatch = xml.match(
        /CharCode>USD<\/CharCode>[\s\S]*?<Value>([\d\s.,]+)<\/Value>/,
      );
      expect(usdMatch, 'CBR XML: блок USD / тег Value не найден').toBeTruthy();

      const rawRate = usdMatch![1]!.replace(',', '.').replace(/\s/g, '');
      const rate = parseFloat(rawRate);
      expect(
        Number.isFinite(rate) && rate > 0,
        `CBR XML: курс не число (${rawRate})`,
      ).toBe(true);
    },
    30_000,
  );

  it.skipIf(shouldSkip('CBR MacroFetcher'))(
    'CBR: MacroFetcher (cbr-xml-daily mirror) отдаёт курс USD',
    async () => {
      const fetcher = new MacroFetcher();
      const result = await fetcher.fetch();

      expect(
        result.success,
        `CBR MacroFetcher: success=false — ${result.diagnostic ?? 'без диагностики'}`,
      ).toBe(true);
      expect(
        result.usdRate,
        'CBR MacroFetcher: usdRate отсутствует',
      ).toBeDefined();
      expect(
        result.usdRate!,
        'CBR MacroFetcher: usdRate не положительное число',
      ).toBeGreaterThan(0);
      expect(
        result.date,
        'CBR MacroFetcher: дата публикации пустая',
      ).toBeTruthy();
    },
    30_000,
  );

  it.skipIf(shouldSkip('CBR official keyRate'))(
    'CBR: официальная ключевая ставка (cbr.ru KeyRate/Infl → число)',
    async () => {
      const fetcher = new CbrOfficialFetcher();
      const result = await fetcher.fetch();

      expect(
        result.success,
        `CBR Official: success=false — ${result.diagnostic ?? 'без диагностики'}`,
      ).toBe(true);
      const rate = result.keyRate ?? result.inflation;
      expect(
        rate,
        'CBR Official: ни keyRate, ни inflation не распарсены из HTML-страниц ЦБ',
      ).toBeDefined();
      expect(
        rate!,
        'CBR Official: ставка не положительное число',
      ).toBeGreaterThan(0);
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════
// Finam: только с FINAM_API_KEY
// ═══════════════════════════════════════════════

describe('API smoke: Finam (требуется FINAM_API_KEY)', () => {
  const finamKey = process.env.FINAM_API_KEY?.trim() ?? '';

  it.skipIf(shouldSkip('Finam config'))(
    'Finam: статус ключа — ' +
      (finamKey
        ? 'FINAM_API_KEY задан'
        : 'FINAM_API_KEY НЕ задан (сетевой тест пропущен)'),
    () => {
      // Не сетевой тест: показывает состояние конфигурации в отчёте.
      expect(true).toBe(true);
    },
  );

  it.skipIf(!finamKey)(
    'Finam: история SBER через POST /api/v1/history-price (с ключом)',
    async () => {
      const fmt = (d: Date): string => d.toISOString().slice(0, 10);
      const to = new Date();
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const response = await fetchWithTimeout(
        'https://api.finam.ru/api/v1/history-price',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + finamKey,
          },
          body: JSON.stringify({
            instrument_group: 'tmo', // MOEX
            instrument_name: 'SBER',
            period: 'D',
            period_length: 1,
            date_from: fmt(from),
            date_to: fmt(to),
            portfolio: 'DEMO',
          }),
        },
        20_000,
      );
      const body = (await response.json()) as {
        candles?: Array<Record<string, unknown>>;
      };

      expect(
        Array.isArray(body.candles),
        `Finam: поле candles не массив (ответ: ${JSON.stringify(body).slice(0, 200)})`,
      ).toBe(true);

      if (body.candles!.length > 0) {
        const first = body.candles![0]!;
        expect(typeof first['time'], 'Finam: свеча без поля time').toBe(
          'string',
        );
        expect(
          typeof first['close'],
          'Finam: свеча без числового поля close',
        ).toBe('number');
      }
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════
// Google News RSS (news-provider)
// ═══════════════════════════════════════════════

describe('API smoke: Google News RSS (news-provider)', () => {
  // Google News RSS блокируется на территории РФ (Роскомнадзор).
  // По умолчанию тест честно падает с причиной (smoke сигнализирует).
  // Флажок NEWS_ALLOW_BLOCKED_SKIP=1 — опциональный пропуск для машин вне доступа.
  const allowBlockedNewsSkip = process.env.NEWS_ALLOW_BLOCKED_SKIP === '1';

  it.skipIf(shouldSkip('Google News RSS') || allowBlockedNewsSkip)(
    'News: Google News RSS отдаёт ≥1 элемента (retry 1×)',
    async () => {
      const fetcher = new NewsFetcher();
      let outcome: FetchResult | null = null;
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= 2 && !outcome; attempt++) {
        try {
          const result = await fetcher.fetch('SBER OR Сбербанк');
          if (result.success && result.items.length > 0) {
            outcome = result;
          } else {
            lastError = new Error(
              `success=${result.success}, items=${result.items.length}, ` +
                `diagnostic=${result.diagnostic ?? '-'}, http=${result.httpStatus ?? '-'}`,
            );
          }
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
        if (!outcome) {
          await sleep(1_000);
        }
      }

      expect(
        outcome,
        'Google News RSS недоступен: ' +
          (lastError?.message ?? 'нет данных') +
          '. Возможна блокировка Google News на территории РФ; retry 1× выполнен.',
      ).not.toBeNull();

      const first = outcome!.items[0]!;
      expect(first.title.length, 'News: элемент без заголовка').toBeGreaterThan(
        0,
      );
      expect(first.link.length, 'News: элемент без ссылки').toBeGreaterThan(0);
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════
// Контракт ResearchProvider (без сети)
// ═══════════════════════════════════════════════

describe('API smoke: контракт ResearchProvider (без сети)', () => {
  it.skipIf(shouldSkip('ResearchProvider contract'))(
    'Все research-провайдеры реализуют контракт (supports/research)',
    () => {
      const providers: Array<{ name: string; provider: ResearchProvider }> = [
        { name: 'MarketDataProvider', provider: new MarketDataProvider() },
        {
          name: 'MacroResearchProvider',
          provider: new MacroResearchProvider(),
        },
        { name: 'NewsResearchProvider', provider: new NewsResearchProvider() },
      ];

      for (const { name, provider } of providers) {
        expect(typeof provider.supports, `${name}: supports отсутствует`).toBe(
          'function',
        );
        expect(typeof provider.research, `${name}: research отсутствует`).toBe(
          'function',
        );
      }

      const cashAsset: ResearchAsset = {
        ticker: 'RUB',
        name: 'Рубль',
        assetType: 'CASH',
        issuer: '',
        currency: 'RUB',
        market: 'MOEX',
      };

      expect(new MarketDataProvider().supports(stockAsset)).toBe(true);
      expect(new MarketDataProvider().supports(cashAsset)).toBe(true);
      expect(new MacroResearchProvider().supports(stockAsset)).toBe(true);
      expect(new NewsResearchProvider().supports(stockAsset)).toBe(true);
      expect(new NewsResearchProvider().supports(cashAsset)).toBe(false); // только STOCK
    },
  );
});
