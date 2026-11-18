/**
 * Конфигурация источников фундаментальных данных.
 *
 * Одна настройка `FUNDAMENTALS_SMARTLAB_ENABLED=false` переводит систему
 * в режим «только MOEX ISS»: smart-lab.ru не опрашивается, недостающие
 * поля честно помечаются как недоступные.
 */

export interface FundamentalsConfig {
  /** Опрашивать smart-lab.ru. */
  smartLabEnabled: boolean;
  /** Минимальный интервал между запросами к smart-lab.ru, мс. */
  smartLabMinIntervalMs: number;
  /** TTL кэша (1–3 суток). */
  cacheTtlMs: number;
  /** Порог расхождения источников (0.2 = 20%). */
  conflictThreshold: number;
  /** Таймаут HTTP-запроса, мс. */
  requestTimeoutMs: number;
  /** User-Agent для запросов. */
  userAgent: string;
}

const DEFAULT_CACHE_TTL_HOURS = 24;
const MIN_CACHE_TTL_HOURS = 1;
const MAX_CACHE_TTL_HOURS = 72;
const DEFAULT_SMARTLAB_INTERVAL_MS = 1500;
const DEFAULT_CONFLICT_THRESHOLD = 0.2;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

function readBool(name: string, fallback: boolean): boolean {
  const value = readEnv(name);
  if (value === undefined || value === '') return fallback;
  const normalized = value.toLowerCase();
  if (['0', 'false', 'no', 'off', 'нет'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on', 'да'].includes(normalized)) return true;
  return fallback;
}

function readNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = readEnv(name);
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Текущая конфигурация (читается при каждом вызове — удобно для тестов). */
export function getFundamentalsConfig(): FundamentalsConfig {
  const ttlHours = readNumber(
    'FUNDAMENTALS_CACHE_TTL_HOURS',
    DEFAULT_CACHE_TTL_HOURS,
    MIN_CACHE_TTL_HOURS,
    MAX_CACHE_TTL_HOURS,
  );

  return {
    smartLabEnabled: readBool('FUNDAMENTALS_SMARTLAB_ENABLED', true),
    smartLabMinIntervalMs: readNumber(
      'FUNDAMENTALS_SMARTLAB_INTERVAL_MS',
      DEFAULT_SMARTLAB_INTERVAL_MS,
      0,
      60_000,
    ),
    cacheTtlMs: ttlHours * 60 * 60 * 1000,
    conflictThreshold: readNumber(
      'FUNDAMENTALS_CONFLICT_THRESHOLD',
      DEFAULT_CONFLICT_THRESHOLD,
      0.01,
      1,
    ),
    requestTimeoutMs: readNumber(
      'FUNDAMENTALS_REQUEST_TIMEOUT_MS',
      DEFAULT_REQUEST_TIMEOUT_MS,
      1000,
      60_000,
    ),
    userAgent:
      'FinanceAnalyzer/2.1 (+https://github.com/finance-analyzer; fundamentals)',
  };
}

/** Проверка, включён ли smart-lab (для быстрых проверок в коде). */
export function isSmartLabEnabled(): boolean {
  return getFundamentalsConfig().smartLabEnabled;
}
