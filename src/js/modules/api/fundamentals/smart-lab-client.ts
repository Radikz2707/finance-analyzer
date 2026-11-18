/**
 * Сетевой клиент smart-lab.ru с анти-блокировкой и кэшем.
 *
 * Правила:
 * - не чаще одного запроса на страницу тикера за TTL кэша (по умолчанию сутки);
 * - пауза между запросами к smart-lab.ru (настраивается);
 * - собственный User-Agent;
 * - при 403/429 источник временно отключается, отчёт собирается на MOEX ISS.
 */

import { getFundamentalsConfig } from './config.js';
import { getCached, setCached } from './cache.js';
import {
  parseSmartLabDividends,
  parseSmartLabFinancials,
} from './smart-lab-parser.js';
import type { SmartLabDividends, SmartLabFinancials } from './types.js';

const SMARTLAB_BASE = 'https://smart-lab.ru';
const BLOCK_COOLDOWN_MS = 6 * 60 * 60 * 1000;

let lastRequestAt = 0;
let blockedUntil = 0;
let requestQueue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Сброс состояния анти-блокировки (для тестов). */
export function __resetSmartLabClientForTests(): void {
  lastRequestAt = 0;
  blockedUntil = 0;
  requestQueue = Promise.resolve();
}

/**
 * Сериализовать запросы к smart-lab.ru.
 * Без этого два параллельных вызова (финансы + дивиденды) обходили бы паузу.
 */
function scheduleRequest<T>(task: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(task, task);
  requestQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function waitForSlot(): Promise<void> {
  const config = getFundamentalsConfig();
  const now = Date.now();
  if (blockedUntil > now) {
    throw new Error('smart-lab.ru временно недоступен (anti-bot cooldown)');
  }
  const elapsed = now - lastRequestAt;
  const delay = Math.max(0, config.smartLabMinIntervalMs - elapsed);
  if (delay > 0) await sleep(delay);
  lastRequestAt = Date.now();
}

/** Загрузить HTML-страницу smart-lab.ru. */
export async function fetchSmartLabPage(url: string): Promise<string | null> {
  const config = getFundamentalsConfig();
  if (!config.smartLabEnabled) return null;

  return scheduleRequest(async () => {
    try {
      await waitForSlot();
    } catch (error) {
      console.warn(
        `[smart-lab.ru] ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.requestTimeoutMs,
    );
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
          'User-Agent': config.userAgent,
        },
      });

      if (response.status === 403 || response.status === 429) {
        blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
        console.warn(
          `[smart-lab.ru] HTTP ${response.status}: источник временно отключён на 6 ч`,
        );
        return null;
      }

      if (!response.ok) {
        console.warn(`[smart-lab.ru] HTTP ${response.status} для ${url}`);
        return null;
      }

      return await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[smart-lab.ru] Ошибка запроса ${url}: ${message}`);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

function financialsCacheKey(ticker: string): string {
  return `smartlab:financials:v1:${ticker}`;
}

function dividendsCacheKey(ticker: string): string {
  return `smartlab:dividends:v1:${ticker}`;
}

/** Финансовые мультипликаторы и история с smart-lab.ru. */
export async function fetchSmartLabFinancials(
  ticker: string,
): Promise<SmartLabFinancials | null> {
  const config = getFundamentalsConfig();
  if (!config.smartLabEnabled) return null;

  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return null;

  const cached = await getCached<SmartLabFinancials>(
    financialsCacheKey(normalized),
  );
  if (cached) return cached;

  const html = await fetchSmartLabPage(`${SMARTLAB_BASE}/q/${normalized}/f/y/`);
  if (!html) return null;

  const parsed = parseSmartLabFinancials(html, normalized);
  // Ошибочный парсинг кэшируем ненадолго, чтобы не долбить источник.
  const ttl = parsed.parseOk
    ? config.cacheTtlMs
    : Math.min(60 * 60 * 1000, config.cacheTtlMs);
  await setCached(financialsCacheKey(normalized), parsed, ttl);
  return parsed;
}

/** Дивидендная история и текущая доходность с smart-lab.ru. */
export async function fetchSmartLabDividends(
  ticker: string,
): Promise<SmartLabDividends | null> {
  const config = getFundamentalsConfig();
  if (!config.smartLabEnabled) return null;

  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return null;

  const cached = await getCached<SmartLabDividends>(
    dividendsCacheKey(normalized),
  );
  if (cached) return cached;

  const html = await fetchSmartLabPage(
    `${SMARTLAB_BASE}/q/${normalized}/dividend/`,
  );
  if (!html) return null;

  const parsed = parseSmartLabDividends(html, normalized);
  const ttl = parsed.parseOk
    ? config.cacheTtlMs
    : Math.min(60 * 60 * 1000, config.cacheTtlMs);
  await setCached(dividendsCacheKey(normalized), parsed, ttl);
  return parsed;
}
