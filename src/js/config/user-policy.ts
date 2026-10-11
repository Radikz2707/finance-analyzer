/**
 * Пользовательская инвестиционная политика.
 *
 * НЕ хардкодится в коде: загружается из файла данных приложения
 * (data/user-policy.json в dev; %APPDATA%/finance-analyzer/user-policy.json
 * в упакованном приложении), с возможностью переопределения через env
 * PORTFOLIO_NO_SELL_TICKERS (список через запятую).
 *
 * Используется:
 * - interactive-orders: REDUCE/EXIT для no-sell тикеров → HOLD;
 * - prompt-templates: правило «не продавать» в системный промпт AI.
 */

import * as fs from 'fs';
import * as path from 'path';

import { resolveAppDataDir } from '../modules/app-paths.js';

export interface UserPolicy {
  /**
   * Тикеры, которые пользователь НЕ продаёт. Снижение их доли в портфеле
   * достигается только увеличением долей других активов (размыванием).
   */
  noSellTickers: string[];
}

const DEFAULT_POLICY: UserPolicy = { noSellTickers: [] };

let cached: UserPolicy | null = null;

function normalizeTickers(raw: string[]): string[] {
  return Array.from(
    new Set(raw.map((t) => t.trim().toUpperCase()).filter((t) => t.length > 0)),
  );
}

function policyFilePath(): string {
  return path.join(resolveAppDataDir(), 'user-policy.json');
}

function parsePolicyFile(): UserPolicy {
  try {
    const raw = fs.readFileSync(policyFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<UserPolicy>;
    if (Array.isArray(parsed.noSellTickers)) {
      return { noSellTickers: normalizeTickers(parsed.noSellTickers) };
    }
  } catch {
    // Файла нет или он повреждён — используем дефолт (не ошибка).
  }
  return { ...DEFAULT_POLICY };
}

/**
 * Актуальная политика (с кэшем). Приоритет: env PORTFOLIO_NO_SELL_TICKERS
 * → файл user-policy.json → пустая политика.
 */
export function loadUserPolicy(): UserPolicy {
  if (cached) return cached;
  let policy = parsePolicyFile();

  const env = process.env.PORTFOLIO_NO_SELL_TICKERS;
  if (env && env.trim() !== '') {
    policy = {
      noSellTickers: normalizeTickers(env.split(',')),
    };
  }

  cached = policy;
  return policy;
}

/** Сбросить кэш (для тестов и после редактирования файла в рантайме) */
export function resetUserPolicyCache(): void {
  cached = null;
}

/** Путь к файлу политики (для подсказок в UI/логах) */
export function userPolicyFilePath(): string {
  return policyFilePath();
}
