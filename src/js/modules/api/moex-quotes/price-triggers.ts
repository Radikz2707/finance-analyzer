/**
 * Ценовые триггеры из структурированного JSON-блока AI.
 *
 * Зачем отдельный модуль: `price-alerts.ts` работает только с уровнями из
 * пользовательского конфига и не умеет читать уровни, которые модель
 * предлагает в ответе. Здесь уровни приходят строго из машинночитаемого
 * блока, а не из свободного текста.
 *
 * Принципы:
 * - нет JSON-блока → нет триггеров и запись `[PRICE_TRIGGER] structure=absent`;
 * - битый/неполный блок отбрасывается целиком (fail-closed): уровень без
 *   направления или с неположительной ценой не участвует в сверке;
 * - триггер — информационный сигнал, а не торговое поручение; sell-действие
 *   для актива под no-sell политикой помечается `blocked_by_policy`;
 * - сверка только с подтверждённой ценой: нет цены → триггер не строится.
 */

import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import {
  isSellAction,
  isSellBlockedByPolicy,
  type PolicyLike,
} from '../../ai/ai-advisor/policy-text-guard.js';

/** Направление пробоя уровня. */
export type PriceTriggerDirection = 'above' | 'below';

/** Один уровень из JSON-блока. */
export interface PriceTriggerLevel {
  /** Цена срабатывания, ₽. */
  price: number;
  /** above — цена выросла до уровня или выше; below — упала до уровня или ниже. */
  direction: PriceTriggerDirection;
}

/** Блок триггеров по одному инструменту. */
export interface PriceTriggerBlock {
  /** Тикер только из символов (без пробелов, скобок и тире). */
  ticker: string;
  /** Непустой список валидных уровней. */
  levels: PriceTriggerLevel[];
  /** Действие, предложенное моделью (SELL/REDUCE/EXIT/HOLD/BUY/...). */
  action: string;
}

/** Результат разбора текста ответа AI. */
export interface PriceTriggerParseResult {
  triggers: PriceTriggerBlock[];
  /** present — найден хотя бы один валидный блок; absent — нет. */
  structure: 'present' | 'absent';
}

/** Котировка для сверки: объект из MoexQuotesClient или просто число. */
export type PriceTriggerQuoteSource =
  { last: number | null; asOf?: string | null } | number | null | undefined;

/** Результат сверки одного блока с текущей ценой. */
export interface PriceTriggerEvaluation {
  ticker: string;
  currentPrice: number;
  /** Время среза котировки (ISO), если источник его отдал. */
  asOf: string | null;
  /** Достигнутый уровень; null — ни один уровень не пробит. */
  level: PriceTriggerLevel | null;
  /** Итоговое действие: исходное или `blocked_by_policy`. */
  action: string;
  /** Действие из JSON до policy-check. */
  originalAction: string;
  /** true — sell-действие запрещено политикой no-sell. */
  blockedByPolicy: boolean;
  /** true — хотя бы один уровень достигнут текущей ценой. */
  triggered: boolean;
}

/** Параметры сверки. */
export interface EvaluatePriceTriggersOptions {
  /** Котировки по тикерам (ключ — тикер). */
  quotes: Record<string, PriceTriggerQuoteSource>;
  /** Активы портфеля — нужны для проверки типа актива в политике. */
  assets?: ReadonlyArray<
    Pick<AssetAnalysis, 'ticker' | 'assetType' | 'holdOnly'>
  >;
  /** Пользовательская no-sell политика. */
  policy?: PolicyLike;
}

/** Огороженный блок ```json ... ``` (или просто ``` ... ```). */
const FENCED_JSON = /```(?:json)?\s*([\s\S]*?)```/gi;

/** Тикер: только буквы, цифры, точка, дефис, подчёркивание. */
const TICKER_PATTERN = /^[A-Z0-9._-]+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function normalizeTicker(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ticker = value.trim().toUpperCase();
  if (!ticker || !TICKER_PATTERN.test(ticker)) return null;
  return ticker;
}

function normalizeDirection(value: unknown): PriceTriggerDirection | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'above' || normalized === 'up' || normalized === '>') {
    return 'above';
  }
  if (normalized === 'below' || normalized === 'down' || normalized === '<') {
    return 'below';
  }
  return null;
}

function toLevels(value: unknown): PriceTriggerLevel[] {
  if (!Array.isArray(value)) return [];
  const levels: PriceTriggerLevel[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const price = Number(record['price']);
    const direction = normalizeDirection(record['direction']);
    if (!Number.isFinite(price) || price <= 0 || !direction) continue;
    levels.push({ price, direction });
  }
  return levels;
}

function toBlock(value: unknown): PriceTriggerBlock | null {
  const record = asRecord(value);
  if (!record) return null;

  const ticker = normalizeTicker(record['ticker']);
  const action =
    typeof record['action'] === 'string' ? record['action'].trim() : '';
  const levels = toLevels(record['levels']);

  if (!ticker || !action || levels.length === 0) return null;
  return { ticker, levels, action };
}

/** Достать блоки из распарсенного JSON: массив, priceTriggers или одиночный объект. */
function collectRawBlocks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record['priceTriggers'])) return record['priceTriggers'];
  if (Array.isArray(record['price_triggers'])) return record['price_triggers'];
  if ('ticker' in record && 'levels' in record) return [record];
  return [];
}

function blockKey(block: PriceTriggerBlock): string {
  const levels = block.levels
    .map((level) => `${level.direction}:${level.price}`)
    .join(',');
  return `${block.ticker}|${block.action}|${levels}`;
}

/**
 * Разобрать ответ AI и извлечь ценовые триггеры.
 *
 * Рассматриваются только огороженные JSON-блоки: свободный текст и
 * таблицы рекомендаций не могут создать триггер.
 */
export function parsePriceTriggers(
  text: string | null | undefined,
): PriceTriggerParseResult {
  if (!text || !text.trim()) {
    console.log('[PRICE_TRIGGER] structure=absent reason=no_text');
    return { triggers: [], structure: 'absent' };
  }

  const blocks: PriceTriggerBlock[] = [];
  let fenced = 0;

  for (const match of text.matchAll(FENCED_JSON)) {
    fenced++;
    const body = match[1];
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue;
    }
    for (const raw of collectRawBlocks(parsed)) {
      const block = toBlock(raw);
      if (block) blocks.push(block);
    }
  }

  const seen = new Set<string>();
  const triggers = blocks.filter((block) => {
    const key = blockKey(block);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (triggers.length === 0) {
    console.log(`[PRICE_TRIGGER] structure=absent fenced=${fenced}`);
    return { triggers: [], structure: 'absent' };
  }

  console.log(
    `[PRICE_TRIGGER] structure=present blocks=${triggers.length} fenced=${fenced}`,
  );
  return { triggers, structure: 'present' };
}

function normalizeQuote(
  value: PriceTriggerQuoteSource,
): { last: number | null; asOf: string | null } | null {
  if (typeof value === 'number') {
    return { last: Number.isFinite(value) ? value : null, asOf: null };
  }
  if (!value) return null;
  return {
    last: typeof value.last === 'number' ? value.last : null,
    asOf: value.asOf ?? null,
  };
}

/** Ближайший к текущей цене достигнутый уровень. */
function selectHit(
  levels: readonly PriceTriggerLevel[],
  currentPrice: number,
): PriceTriggerLevel | null {
  const hits = levels.filter((level) =>
    level.direction === 'above'
      ? currentPrice >= level.price
      : currentPrice <= level.price,
  );
  if (hits.length === 0) return null;

  return hits.reduce((best, level) =>
    Math.abs(currentPrice - level.price) < Math.abs(currentPrice - best.price)
      ? level
      : best,
  );
}

/**
 * Сверить блоки с текущими ценами и применить no-sell политику.
 *
 * Блок без подтверждённой цены не попадает в результат: сверять нечего.
 */
export function evaluatePriceTriggers(
  blocks: readonly PriceTriggerBlock[],
  options: EvaluatePriceTriggersOptions,
): PriceTriggerEvaluation[] {
  const assetByTicker = new Map<
    string,
    Pick<AssetAnalysis, 'ticker' | 'assetType' | 'holdOnly'>
  >();
  for (const asset of options.assets ?? []) {
    assetByTicker.set(asset.ticker.trim().toUpperCase(), asset);
  }

  const evaluations: PriceTriggerEvaluation[] = [];

  for (const block of blocks) {
    const quote = normalizeQuote(options.quotes[block.ticker]);
    if (!quote || quote.last === null || quote.last <= 0) {
      console.log(
        `[PRICE_TRIGGER] ticker=${block.ticker} price=unavailable ` +
          `level=- action=${block.action}`,
      );
      continue;
    }

    const currentPrice = quote.last;
    const hit = selectHit(block.levels, currentPrice);
    const asset = assetByTicker.get(block.ticker) ?? {
      ticker: block.ticker,
      assetType: '',
    };
    const blockedByPolicy =
      isSellAction(block.action) &&
      isSellBlockedByPolicy(asset, options.policy);
    const action = blockedByPolicy ? 'blocked_by_policy' : block.action;

    if (blockedByPolicy) {
      console.log(
        `[PRICE_TRIGGER] ticker=${block.ticker} price=${currentPrice} ` +
          `action=blocked_by_policy original=${block.action}`,
      );
    } else {
      console.log(
        `[PRICE_TRIGGER] ticker=${block.ticker} price=${currentPrice} ` +
          `level=${hit ? hit.price : '-'} action=${action}`,
      );
    }

    evaluations.push({
      ticker: block.ticker,
      currentPrice,
      asOf: quote.asOf,
      level: hit,
      action,
      originalAction: block.action,
      blockedByPolicy,
      triggered: hit !== null,
    });
  }

  return evaluations;
}
