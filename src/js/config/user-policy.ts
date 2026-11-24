/**
 * Пользовательская инвестиционная политика.
 *
 * НЕ хардкодится в коде: загружается из файла данных приложения
 * (data/user-policy.json в dev; %APPDATA%/finance-analyzer/user-policy.json
 * в упакованном приложении), с возможностью переопределения через env
 * PORTFOLIO_NO_SELL_TICKERS / PORTFOLIO_NO_SELL_ASSET_TYPES (список через запятую).
 *
 * Тикерные запреты задаёт ТОЛЬКО пользователь (файл или env). В коде нет
 * «дефолтного» списка тикеров: иначе политика жила бы в исходниках, а не в
 * конфиге. Если список не задан, действуют только запреты по типам активов,
 * а в отчёт попадает предупреждение — тихого no-op быть не должно.
 *
 * Используется:
 * - interactive-orders: REDUCE/EXIT для no-sell тикеров → HOLD;
 * - strategy-validator: продажа no-sell актива → STRATEGY_CONFLICT;
 * - prompt-templates: правило «не продавать» в системный промпт AI.
 */

import * as fs from 'fs';
import * as path from 'path';

import { resolveAppDataDir } from '../modules/shared/app-paths.js';

export interface UserPolicy {
  /**
   * Тикеры, которые пользователь НЕ продаёт. Снижение их доли в портфеле
   * достигается только увеличением долей других активов (размыванием).
   */
  noSellTickers: string[];
  /**
   * Типы активов, которые пользователь НЕ продаёт (например, облигации).
   * Сравнение регистронезависимое; поддерживаются обозначения Excel
   * («О», «Облигация») и внутренние классы («BOND»).
   */
  noSellAssetTypes: string[];
}

/** Откуда взята действующая политика. */
export type UserPolicySource = 'env' | 'file' | 'defaults' | 'empty';

/** Результат загрузки политики вместе с диагностикой. */
export interface UserPolicyLoadResult {
  /** Действующая политика (с дополнением значений по умолчанию). */
  policy: UserPolicy;
  /** Путь к файлу политики. */
  filePath: string;
  /** Существует ли файл политики. */
  fileExists: boolean;
  /** Источник действующих значений. */
  source: UserPolicySource;
  /** Предупреждения для отчёта (неполный файл, ошибка чтения и т.п.). */
  warnings: string[];
  /** Есть ли хотя бы один действующий запрет. */
  restrictionsActive: boolean;
}

const DEFAULT_POLICY: UserPolicy = {
  // Хардкод тикера запрещён: тикерные запреты приходят из user-policy.json
  // или PORTFOLIO_NO_SELL_TICKERS. Пустой список — валидное состояние,
  // но о нём обязательно предупреждаем (см. loadUserPolicyWithMeta).
  //
  // Запрет по asset-type (например, «все облигации») также НЕ хардкодится:
  // он должен быть явно объявлен пользователем в user-policy.json или env.
  // Если пользователь не объявил asset-type запрет — продажа облигаций
  // не блокируется автоматически.
  noSellTickers: [],
  noSellAssetTypes: [],
};

let cached: UserPolicyLoadResult | null = null;

function normalizeTickers(raw: string[]): string[] {
  return Array.from(
    new Set(raw.map((t) => t.trim().toUpperCase()).filter((t) => t.length > 0)),
  );
}

function normalizeAssetTypes(raw: string[]): string[] {
  return Array.from(
    new Set(raw.map((t) => t.trim().toUpperCase()).filter((t) => t.length > 0)),
  );
}

function policyFilePath(): string {
  return path.join(resolveAppDataDir(), 'user-policy.json');
}

interface ParsedPolicyFile {
  values: Partial<UserPolicy>;
  exists: boolean;
  error?: string;
}

/**
 * Прочитать файл политики. Отсутствие файла — не ошибка.
 * Ошибка чтения/JSON сохраняется, чтобы попасть в предупреждения отчёта.
 */
function parsePolicyFile(): ParsedPolicyFile {
  const filePath = policyFilePath();
  let exists: boolean;
  try {
    exists = fs.existsSync(filePath);
  } catch {
    exists = false;
  }

  if (!exists) {
    return { values: {}, exists: false };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const values: Partial<UserPolicy> = {};
    if (Array.isArray(parsed.noSellTickers)) {
      values.noSellTickers = normalizeTickers(
        parsed.noSellTickers.map((value) => String(value)),
      );
    }
    if (Array.isArray(parsed.noSellAssetTypes)) {
      values.noSellAssetTypes = normalizeAssetTypes(
        parsed.noSellAssetTypes.map((value) => String(value)),
      );
    }
    return { values, exists: true };
  } catch (err) {
    return {
      values: {},
      exists: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Актуальная политика с диагностикой (с кэшем).
 *
 * Приоритет источников: env → файл → значения по умолчанию.
 * Пустые/отсутствующие поля файла дополняются значениями по умолчанию,
 * чтобы запреты не пропадали молча.
 */
export function loadUserPolicyWithMeta(): UserPolicyLoadResult {
  if (cached) return cached;

  const filePath = policyFilePath();
  const parsedFile = parsePolicyFile();
  const warnings: string[] = [];

  if (parsedFile.error) {
    warnings.push(
      `user-policy.json не прочитан (${parsedFile.error}) — тикерные запреты не применены`,
    );
  } else if (parsedFile.exists) {
    if (!parsedFile.values.noSellTickers?.length) {
      warnings.push(
        'user-policy.json: noSellTickers не задан или пуст — тикерные запреты не действуют; ' +
          'задайте список в файле или через PORTFOLIO_NO_SELL_TICKERS',
      );
    }
    if (!parsedFile.values.noSellAssetTypes?.length) {
      warnings.push(
        'user-policy.json: noSellAssetTypes не задан или пуст — применены значения по умолчанию (О, Облигация)',
      );
    }
  } else {
    // Файла нет — это не ошибка, но и не повод молча терять тикерные запреты.
    warnings.push(
      'user-policy.json не найден — тикерные запреты не настроены; ' +
        'действуют только запреты по типам активов',
    );
  }

  let source: UserPolicySource = parsedFile.exists ? 'file' : 'defaults';
  const policy: UserPolicy = {
    noSellTickers: parsedFile.values.noSellTickers?.length
      ? [...parsedFile.values.noSellTickers]
      : [...DEFAULT_POLICY.noSellTickers],
    noSellAssetTypes: parsedFile.values.noSellAssetTypes?.length
      ? [...parsedFile.values.noSellAssetTypes]
      : [...DEFAULT_POLICY.noSellAssetTypes],
  };

  const envTickers = process.env.PORTFOLIO_NO_SELL_TICKERS;
  if (envTickers && envTickers.trim() !== '') {
    // Разделяем по запятой/точке с запятой; пробелы вокруг разделителя игнорируются.
    // Пример: "RU000A10EC22, PLZL" → ['RU000A10EC22', 'PLZL']
    policy.noSellTickers = normalizeTickers(
      envTickers.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
    );
    source = 'env';
  }

  const envAssetTypes = process.env.PORTFOLIO_NO_SELL_ASSET_TYPES;
  if (envAssetTypes && envAssetTypes.trim() !== '') {
    policy.noSellAssetTypes = normalizeAssetTypes(envAssetTypes.split(','));
    source = 'env';
  }

  const restrictionsActive =
    policy.noSellTickers.length > 0 || policy.noSellAssetTypes.length > 0;
  if (!restrictionsActive) {
    source = 'empty';
    warnings.push(
      'Пользовательская политика не содержит действующих запретов: ' +
        'продажи не блокируются',
    );
  }

  const result: UserPolicyLoadResult = {
    policy,
    filePath,
    fileExists: parsedFile.exists,
    source,
    warnings,
    restrictionsActive,
  };

  cached = result;

  for (const warning of warnings) {
    console.warn(`[UserPolicy] ${warning}`);
  }

  return result;
}

/**
 * Актуальная политика (с кэшем).
 * Приоритет: env → файл user-policy.json → значения по умолчанию.
 */
export function loadUserPolicy(): UserPolicy {
  return loadUserPolicyWithMeta().policy;
}

/** Сбросить кэш (для тестов и после редактирования файла в рантайме) */
export function resetUserPolicyCache(): void {
  cached = null;
}

/** Путь к файлу политики (для подсказок в UI/логах) */
export function userPolicyFilePath(): string {
  return policyFilePath();
}
