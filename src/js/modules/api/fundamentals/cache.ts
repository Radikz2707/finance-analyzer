/**
 * Единый TTL-кэш для фундаментальных данных (MOEX ISS + smart-lab.ru).
 *
 * - TTL по умолчанию 24 часа (настраивается 1–72 ч).
 * - В Node/CLI кэш сохраняется в data/cache/fundamentals-cache.json.
 * - В браузере/Electron-renderer остаётся memory-кэш (файловая система
 *   может быть недоступна) — поведение не меняется.
 * - Кэш защищает от повторных запросов к smart-lab.ru: не чаще одного
 *   запроса на тикер за TTL (по умолчанию — сутки).
 */

import path from 'node:path';
import { resolveAppDataDir } from '../../shared/app-paths.js';
import { getFundamentalsConfig } from './config.js';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
  storedAt: string;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

const CACHE_VERSION = 1 as const;
const CACHE_FILE_NAME = 'fundamentals-cache.json';

let memory = new Map<string, CacheEntry>();
let fileLoaded = false;
let persistQueue: Promise<void> = Promise.resolve();

/** Можно ли писать файловый кэш (Node, не vitest, не renderer). */
function canPersist(): boolean {
  if (typeof window !== 'undefined') return false;
  if (typeof process === 'undefined') return false;
  if (process.env?.VITEST) return false;
  return typeof process.cwd === 'function';
}

function getCacheFilePath(): string {
  return path.join(resolveAppDataDir(), 'cache', CACHE_FILE_NAME);
}

async function readCacheFile(): Promise<CacheFile | null> {
  if (!canPersist()) return null;
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(getCacheFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed?.version !== CACHE_VERSION || !parsed.entries) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function ensureFileLoaded(): Promise<void> {
  if (fileLoaded || !canPersist()) return;
  fileLoaded = true;
  const file = await readCacheFile();
  if (!file) return;
  const now = Date.now();
  for (const [key, entry] of Object.entries(file.entries)) {
    if (!entry || typeof entry.expiresAt !== 'number') continue;
    if (entry.expiresAt <= now) continue;
    memory.set(key, entry);
  }
}

function schedulePersist(): void {
  if (!canPersist()) return;
  const snapshot: CacheFile = {
    version: CACHE_VERSION,
    entries: Object.fromEntries(memory.entries()),
  };
  persistQueue = persistQueue
    .then(async () => {
      const fs = await import('node:fs/promises');
      const filePath = getCacheFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(snapshot), 'utf8');
    })
    .catch(() => {
      // Кэш не критичен для работы: ошибки записи игнорируем.
    });
}

/** Прочитать значение из кэша (null — нет или истекло). */
export async function getCached<T>(key: string): Promise<T | null> {
  await ensureFileLoaded();
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value as T;
}

/** Записать значение в кэш. */
export async function setCached<T>(
  key: string,
  value: T,
  ttlMs?: number,
): Promise<void> {
  await ensureFileLoaded();
  const ttl = ttlMs ?? getFundamentalsConfig().cacheTtlMs;
  memory.set(key, {
    value,
    expiresAt: Date.now() + ttl,
    storedAt: new Date().toISOString(),
  });
  schedulePersist();
}

/** Удалить одно значение. */
export async function deleteCached(key: string): Promise<void> {
  await ensureFileLoaded();
  memory.delete(key);
  schedulePersist();
}

/** Полностью очистить кэш (memory + файл). */
export async function clearFundamentalsCache(): Promise<void> {
  memory.clear();
  fileLoaded = true;
  if (canPersist()) {
    try {
      const fs = await import('node:fs/promises');
      await fs.rm(getCacheFilePath(), { force: true });
    } catch {
      // ignore
    }
  }
}

/** Сброс только памяти — для тестов. */
export function __resetFundamentalsCacheForTests(): void {
  memory = new Map();
  fileLoaded = false;
  persistQueue = Promise.resolve();
}

/** Путь к файлу кэша (для диагностики). */
export function getFundamentalsCachePath(): string | null {
  return canPersist() ? getCacheFilePath() : null;
}
