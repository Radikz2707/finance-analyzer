/**
 * ResearchProviderRegistry — агрегатор research data.
 *
 * Поддерживает:
 * - findProviders(asset) → все подходящие провайдеры
 * - researchAll(asset, context) → объединение результатов
 * - Merge semantics: VALUE > NO_DATA, evidence union, conflict tracking
 * - Fallback: пустой snapshot когда providers нет
 */

import type { ResearchProvider, ResearchAsset } from './types.js';
import type {
  AssetResearchSnapshot,
  ResearchValue,
  AssetType,
} from '../types.js';
import { hasValue } from '../helpers.js';
import { researchCacheRepo } from '../../db-manager/db-manager.js';

// ──────────────────────────────────────────────
// Conflict record
// ──────────────────────────────────────────────

/** Запись о конфликте двух VALUE */
export interface ValueConflict {
  field: string;
  providerA: string;
  valueA: unknown;
  providerB: string;
  valueB: unknown;
}

// ──────────────────────────────────────────────
// Merge utilities
// ──────────────────────────────────────────────

/** Слияние двух ResearchValue: VALUE > NO_DATA, evidence union */
function mergeResearchValue<T>(
  existing: ResearchValue<T> | undefined,
  incoming: ResearchValue<T>,
  field: string,
  providerName: string,
  conflicts: ValueConflict[],
  existingProvider: string,
): ResearchValue<T> {
  // NO_DATA не перезаписывает VALUE
  if (incoming.status === 'NO_DATA' || incoming.status === 'NOT_APPLICABLE') {
    if (existing && hasValue(existing)) {
      return existing;
    }
    return incoming;
  }

  // incoming имеет VALUE
  if (hasValue(incoming)) {
    if (!existing) {
      return incoming;
    }

    // existing тоже VALUE — проверяем конфликт
    if (hasValue(existing)) {
      const sameValue = JSON.stringify(existing.value) === JSON.stringify(incoming.value);
      if (!sameValue) {
        conflicts.push({
          field,
          providerA: existingProvider,
          valueA: existing.value,
          providerB: providerName,
          valueB: incoming.value,
        });
        // Сохраняем первое значение, конфликт зафиксирован
        return existing;
      }
      // Значения совпадают — объединяем evidenceIds
      return {
        ...incoming,
        evidenceIds: [...new Set([...(existing.evidenceIds ?? []), ...(incoming.evidenceIds ?? [])])],
      } as ResearchValue<T>;
    }

    // existing — NO_DATA, incoming — VALUE
    return incoming;
  }

  return incoming;
}

/** Рекурсивное слияние объектов (для nested sections) */
function mergeObjects(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: string,
  providerName: string,
  conflicts: ValueConflict[],
  existingProvider: string,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const fullPath = path ? `${path}.${key}` : key;
    const sourceVal = source[key];
    const targetVal = result[key];

    if (sourceVal === undefined) {
      continue;
    }

    if (targetVal === undefined) {
      result[key] = sourceVal;
      continue;
    }

    // Оба — ResearchValue (discriminated union по status)
    if (
      typeof sourceVal === 'object' && sourceVal !== null && 'status' in sourceVal &&
      typeof targetVal === 'object' && targetVal !== null && 'status' in targetVal
    ) {
      result[key] = mergeResearchValue(
        targetVal as ResearchValue<unknown>,
        sourceVal as ResearchValue<unknown>,
        fullPath,
        providerName,
        conflicts,
        existingProvider,
      );
      continue;
    }

    // Оба — объекты
    if (
      typeof sourceVal === 'object' && sourceVal !== null &&
      typeof targetVal === 'object' && targetVal !== null &&
      !Array.isArray(sourceVal) && !Array.isArray(targetVal)
    ) {
      result[key] = mergeObjects(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
        fullPath,
        providerName,
        conflicts,
        existingProvider,
      );
      continue;
    }

    // Массивы — объединяем
    if (Array.isArray(sourceVal) && Array.isArray(targetVal)) {
      result[key] = [...targetVal, ...sourceVal];
      continue;
    }

    // Иначе — source перезаписывает (разные типы, не конфликт)
    result[key] = sourceVal;
  }

  return result;
}

/** Слияние двух AssetResearchSnapshot */
function mergeSnapshots(
  a: AssetResearchSnapshot,
  b: AssetResearchSnapshot,
  providerA: string,
  providerB: string,
): { snapshot: AssetResearchSnapshot; conflicts: ValueConflict[] } {
  const conflicts: ValueConflict[] = [];

  const merged: Record<string, unknown> = {
    identity: a.identity, // identity не сливаем, берём из первого
    evidence: { ...a.evidence, ...b.evidence }, // evidence объединяем
  };

  // Слияние секций
  const sections: (keyof Pick<
    AssetResearchSnapshot,
    'marketResearch' | 'macroResearch' | 'newsResearch' |
    'issuerResearch' | 'bondResearch' | 'etfResearch' |
    'riskAssessment' | 'investmentThesis' | 'aiRecommendation'
  >)[] = [
    'marketResearch', 'macroResearch', 'newsResearch',
    'issuerResearch', 'bondResearch', 'etfResearch',
    'riskAssessment', 'investmentThesis', 'aiRecommendation',
  ];

  for (const section of sections) {
    const aVal = a[section];
    const bVal = b[section];

    if (aVal === undefined && bVal === undefined) {
      continue;
    }
    if (aVal === undefined) {
      merged[section] = bVal;
      continue;
    }
    if (bVal === undefined) {
      merged[section] = aVal;
      continue;
    }

    // Оба определены — сливаем
    merged[section] = mergeObjects(
      aVal as unknown as Record<string, unknown>,
      bVal as unknown as Record<string, unknown>,
      section,
      providerB,
      conflicts,
      providerA,
    );
  }

  return {
    snapshot: merged as unknown as AssetResearchSnapshot,
    conflicts,
  };
}

// ──────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────

export class ResearchProviderRegistry {
  private providers: ResearchProvider[] = [];

  /** Зарегистрировать provider */
  register(provider: ResearchProvider): void {
    this.providers.push(provider);
  }

  /**
   * Найти ВСЕ подходящие провайдеры.
   * Порядок — порядок регистрации.
   */
  findProviders(asset: ResearchAsset): readonly ResearchProvider[] {
    return this.providers.filter((p) => p.supports(asset));
  }

  /**
   * Получить snapshot, агрегировав результаты всех подходящих providers.
   *
   * Merge semantics:
   * - VALUE > NO_DATA
   * - evidence объединяется
   * - конфликт VALUE+VALUE фиксируется, первое значение сохраняется
   *
   * Кэширование: результаты сохраняются в SQLite с TTL 5 минут.
   */
  async researchAll(
    asset: ResearchAsset,
    context: import('./types.js').ResearchContext,
  ): Promise<{
    snapshot: AssetResearchSnapshot;
    conflicts: ValueConflict[];
    providerCount: number;
    fromCache: boolean;
  }> {
    const matchingProviders = this.findProviders(asset);

    if (matchingProviders.length === 0) {
      return {
        snapshot: {
          identity: {
            ticker: asset.ticker,
            name: asset.name,
            assetType: asset.assetType as AssetType,
            issuer: asset.issuer ?? '',
            currency: asset.currency ?? 'RUB',
            market: asset.market ?? 'MOEX',
          },
          evidence: {},
        },
        conflicts: [],
        providerCount: 0,
        fromCache: false,
      };
    }

    // Проверяем кэш перед вызовом провайдеров (пропускаем в тестах)
    const cacheKey = asset.ticker;
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST;
    const cached = !isTest ? researchCacheRepo.get(cacheKey, context.researchTimestamp ?? 'latest') : null;

    if (cached) {
      console.log(`[ResearchCache] ✅ ${cacheKey} — данные из кэша (TTL ${context.ttlSeconds ?? 300}с)`);
      try {
        const cachedSnapshot = JSON.parse(cached) as AssetResearchSnapshot;
        return {
          snapshot: cachedSnapshot,
          conflicts: [],
          providerCount: matchingProviders.length,
          fromCache: true,
        };
      } catch {
        console.warn(`[ResearchCache] ⚠️ Ошибка парсинга кэша для ${cacheKey}`);
      }
    }

    // Последовательно сливаем результаты
    let merged = await matchingProviders[0].research(asset, context);
    const conflicts: ValueConflict[] = [];

    for (let i = 1; i < matchingProviders.length; i++) {
      const next = await matchingProviders[i].research(asset, context);
      const result = mergeSnapshots(merged, next, matchingProviders[0].constructor.name, matchingProviders[i].constructor.name);
      merged = result.snapshot;
      conflicts.push(...result.conflicts);
    }

    // Сохраняем в кэш (пропускаем в тестах)
    if (!isTest) {
      const ttlSeconds = context.ttlSeconds ?? 300;
      try {
        researchCacheRepo.set(
          cacheKey,
          JSON.stringify(merged),
          context.researchTimestamp ?? 'latest',
          ttlSeconds,
        );
        console.log(`[ResearchCache] 💾 ${cacheKey} — сохранено в кэш (TTL ${ttlSeconds}с)`);
      } catch (err) {
        console.warn(`[ResearchCache] ⚠️ Ошибка сохранения кэша для ${cacheKey}:`, err);
      }

      // Очищаем просроченные записи
      try {
        researchCacheRepo.clearExpired();
      } catch {
        // Игнорируем ошибки очистки
      }
    }

    return {
      snapshot: merged,
      conflicts,
      providerCount: matchingProviders.length,
      fromCache: false,
    };
  }

  /**
   * Получить snapshot (legacy API — использует researchAll).
   * @deprecated — используйте researchAll()
   */
  async getSnapshot(
    asset: ResearchAsset,
    context: import('./types.js').ResearchContext,
  ): Promise<AssetResearchSnapshot> {
    const { snapshot } = await this.researchAll(asset, context);
    return snapshot;
  }

  /** Получить всех зарегистрированных providers */
  getProviders(): readonly ResearchProvider[] {
    return [...this.providers];
  }

  /** Очистить все провайдеры */
  clear(): void {
    this.providers = [];
  }
}
