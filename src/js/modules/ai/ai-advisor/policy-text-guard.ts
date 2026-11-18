/**
 * PolicyTextGuard — применение пользовательской no-sell политики к ТЕКСТАМ,
 * а не только к структурированным действиям.
 *
 * Зачем: guardrails уже заменяют REDUCE/EXIT на HOLD, но AI-текст
 * (entryStrategy, rationale, narrative) мог остаться прежним и показать
 * пользователю «Продавайте PLZL», хотя продажа запрещена политикой.
 *
 * Принципы:
 * - не трогаем нейтральные описания («объём продаж», «ликвидность продажи»);
 * - заменяем только императивные/инфинитивные sell-директивы;
 * - покупка для no-sell тикера не запрещается (докупать можно);
 * - функции чистые, без I/O.
 */

import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import type { StructuredAIAssetRecommendation } from './structured-ai-recommendation.js';

/** Минимальный контракт пользовательской политики. */
export interface PolicyLike {
  noSellTickers?: string[];
  noSellAssetTypes?: string[];
}

const BOND_TYPE_ALIASES = new Set(['О', 'ОБЛИГАЦИЯ', 'BOND', 'BONDS']);
const STOCK_TYPE_ALIASES = new Set(['А', 'АКЦИЯ', 'STOCK', 'STOCKS']);

/**
 * Императивные/инфинитивные sell-директивы.
 * Специально НЕ включаем нейтральные «объём продаж» / «ликвидность продажи»,
 * но включаем торговые формы: «продайте», «зафиксируйте прибыль»,
 * «выйти из позиции».
 */
// ВАЖНО: JS `\b` не работает для кириллицы (она не входит в \w),
// поэтому границы заданы явными lookaround-проверками.
const SELL_DIRECTIVE =
  /(?:^|[^А-Яа-яЁёA-Za-z])(продать|продайте|продавайте|продавай|продаём|продаем|фиксаци[А-Яа-яЁё]*|фиксировать\s+прибыль|фиксируйте\s+прибыль|зафиксировать\s+прибыль|сократить|сократите|сокращайте|снизить|снизьте|снижайте|выйти\s+из\s+позиции|выходите\s+из\s+позиции|закрыть\s+позицию|закройте\s+позицию|закрывайте\s+позицию|reduce|sell|exit)(?![А-Яа-яЁёA-Za-z])/i;

/**
 * Широкий паттерн для per-asset карточек и многострочных планов:
 * ловит не только императивы, но и sell-нарратив, который нельзя показывать
 * по no-sell тикеру: частичная фиксация, риск продажи, партии выхода.
 */
const SELL_BLOCK_PATTERN =
  /(частичн[А-Яа-яЁё]*\s+фиксац|фиксац[А-Яа-яЁё]*\s+част[А-Яа-яЁё]*\s+прибыл|фиксац[А-Яа-яЁё]*\s+прибыл|фиксир[А-Яа-яЁё]*\s+прибыл|зафиксир[А-Яа-яЁё]*\s+прибыл|точк[А-Яа-яЁё]*\s+для\s+фиксац|риск[А-Яа-яЁё]*\s+продаж|продаж[А-Яа-яЁё]*\s+по\s+низк|средств[А-Яа-яЁё]*\s+от\s+продаж|за\s+сч[её]т\s+продаж[А-Яа-яЁё]*|продаж[А-Яа-яЁё]*\s*\(?\s*за\s+сч[её]т|снижени[А-Яа-яЁё]*\s+дол[ия]|снизить\s+дол[юи]|уменьшени[А-Яа-яЁё]*\s+дол[ия]|слишком\s+высок[А-Яа-яЁё]*\s+для|продать|продайте|продавайте|продавай|продаём|продаем|сократить|сократите|сокращайте|сокращ[А-Яа-яЁё]*\s+(?:дол|позиц)|снизить\s+(?:дол|позиц)|снизьте|снижайте|выйти\s+из\s+позиц|выходите\s+из\s+позиц|выход[А-Яа-яЁё]*\s+из\s+позиц|закрыть\s+позиц|закройте\s+позиц|закрывай[А-Яа-яЁё]*\s+позиц|ликвидир[А-Яа-яЁё]*|избавь[А-Яа-яЁё]*|перв[А-Яа-яЁё]*\s+парти[А-Яа-яЁё]*\s+выход|втор[А-Яа-яЁё]*\s+парти[А-Яа-яЁё]*\s+выход|reduce|sell|exit)/i;

/** Является ли действие продажей/сокращением. */
export function isSellAction(action: string | null | undefined): boolean {
  return action === 'SELL' || action === 'REDUCE' || action === 'EXIT';
}

/** Есть ли в тексте sell-директива. */
export function hasSellDirective(text: string | null | undefined): boolean {
  if (!text) return false;
  SELL_DIRECTIVE.lastIndex = 0;
  return SELL_DIRECTIVE.test(text);
}

function normalizeTicker(ticker: string | undefined): string {
  return (ticker ?? '').trim().toUpperCase();
}

/**
 * Запрещена ли продажа актива пользовательской политикой.
 * Логика повторяет strategy-validator.isSellAllowedByPolicy, но не тянет
 * зависимость из pipeline-слоя в ai-advisor.
 */
export function isSellBlockedByPolicy(
  asset: Pick<AssetAnalysis, 'ticker' | 'assetType' | 'holdOnly'>,
  policy?: PolicyLike,
): boolean {
  if (asset.holdOnly) return true;

  const ticker = normalizeTicker(asset.ticker);
  const noSellTickers = new Set(
    (policy?.noSellTickers ?? []).map((value) => normalizeTicker(value)),
  );
  if (noSellTickers.has(ticker)) return true;

  const assetType = (asset.assetType ?? '').trim().toUpperCase();
  const noSellAssetTypes = new Set(
    (policy?.noSellAssetTypes ?? []).map((value) =>
      (value ?? '').trim().toUpperCase(),
    ),
  );

  if (noSellAssetTypes.has(assetType)) return true;

  if (BOND_TYPE_ALIASES.has(assetType)) {
    if (
      noSellAssetTypes.has('О') ||
      noSellAssetTypes.has('ОБЛИГАЦИЯ') ||
      noSellAssetTypes.has('BOND') ||
      noSellAssetTypes.has('BONDS')
    ) {
      return true;
    }
  }

  if (STOCK_TYPE_ALIASES.has(assetType)) {
    if (
      noSellAssetTypes.has('А') ||
      noSellAssetTypes.has('АКЦИЯ') ||
      noSellAssetTypes.has('STOCK') ||
      noSellAssetTypes.has('STOCKS')
    ) {
      return true;
    }
  }

  return false;
}

interface SanitizeOptions {
  /**
   * true — заменять предложение только если в нём упомянут тикер
   * (для общего narrative). false — для per-asset полей, где контекст
   * тикера уже задан снаружи.
   */
  requireTicker?: boolean;
}

/**
 * Заменить sell-директивы на нейтральную HOLD-формулировку.
 * Возвращает исходный текст, если директив нет.
 */
export function sanitizePolicyText(
  text: string | null | undefined,
  ticker: string,
  _policy?: PolicyLike,
  options: SanitizeOptions = {},
): { text: string | null; changed: boolean } {
  if (!text) return { text: text ?? null, changed: false };

  const requireTicker = options.requireTicker ?? true;
  const tickerUpper = normalizeTicker(ticker);
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) ?? [text];
  let changed = false;

  const replaced = sentences.map((sentence) => {
    const hasTicker =
      tickerUpper.length > 0 && sentence.toUpperCase().includes(tickerUpper);
    if (requireTicker && !hasTicker) return sentence;
    if (!SELL_BLOCK_PATTERN.test(sentence)) return sentence;

    changed = true;
    return neutralPolicyLine(tickerUpper || 'Актив');
  });

  if (!changed) return { text, changed: false };

  return {
    text: replaced
      .join(' ')
      .replace(/\s+([.!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim(),
    changed: true,
  };
}

function neutralPolicyLine(ticker: string): string {
  return `${normalizeTicker(ticker) || 'Актив'}: держать — продажа/сокращение заблокированы политикой no-sell.`;
}

/**
 * Склеить строки с незакрытой скобкой, чтобы не оставлять обрывки
 * вида «5%) слишком высока…» после вырезания sell-фрагмента.
 */
function mergeUnbalancedParenthesisLines(text: string): string {
  const lines = text.split('\n');
  const merged: string[] = [];
  let buffer = '';
  let depth = 0;

  for (const line of lines) {
    buffer = depth > 0 ? `${buffer} ${line.trim()}` : line;
    depth +=
      (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);
    if (depth <= 0) {
      merged.push(buffer);
      buffer = '';
      depth = 0;
    }
  }

  if (buffer) merged.push(buffer);
  return merged.join('\n');
}

/**
 * Санация per-asset полей карточки (entryStrategy / technicalTiming / rationale).
 * В отличие от sentence-режима, здесь контекст тикера уже задан снаружи,
 * поэтому заменяем ЛЮБОЕ предложение с sell-нарративом, а не только
 * предложение с явным упоминанием тикера.
 */
export function sanitizePolicyCardText(
  text: string | null | undefined,
  ticker: string,
): { text: string | null; changed: boolean } {
  if (!text) return { text: text ?? null, changed: false };

  let changed = false;
  const replaced = text.split('\n').map((line) => {
    if (!SELL_BLOCK_PATTERN.test(line)) return line;

    const sentences = line.match(/[^.!?]+[.!?]?/g) ?? [line];
    let lineChanged = false;
    const replacedLine = sentences
      .map((sentence) => {
        if (!SELL_BLOCK_PATTERN.test(sentence)) return sentence;
        lineChanged = true;
        return neutralPolicyLine(ticker);
      })
      .join(' ')
      .replace(/\s+([.!?])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (lineChanged) changed = true;
    return lineChanged ? replacedLine : line;
  });

  if (!changed) return { text, changed: false };
  return { text: replaced.join('\n'), changed: true };
}

/**
 * Применить политику к структурированной рекомендации.
 * - sell-действие для no-sell тикера → HOLD + policyBlocked;
 * - текстовые sell-директивы вычищаются даже при BUY/HOLD.
 */
export function applyPolicyToRecommendation(
  rec: StructuredAIAssetRecommendation,
  asset: AssetAnalysis,
  policy?: PolicyLike,
): StructuredAIAssetRecommendation {
  if (!isSellBlockedByPolicy(asset, policy)) {
    return rec;
  }

  const actionBlocked = isSellAction(rec.recommendedAction);
  const rationale = sanitizePolicyCardText(rec.rationale, asset.ticker);
  const entryStrategy = sanitizePolicyCardText(rec.entryStrategy, asset.ticker);
  const technicalTiming = sanitizePolicyCardText(
    rec.technicalTiming,
    asset.ticker,
  );

  const textBlocked =
    rationale.changed || entryStrategy.changed || technicalTiming.changed;

  if (!actionBlocked && !textBlocked) {
    return rec;
  }

  const policyNote = 'Продажа/сокращение заблокированы политикой no-sell';

  return {
    ...rec,
    recommendedAction: actionBlocked ? 'HOLD' : rec.recommendedAction,
    rationale: actionBlocked
      ? `⛔ Заблокировано политикой no-sell: ${rec.recommendedAction}. ${
          rationale.text ?? ''
        }`.trim()
      : rationale.text,
    entryStrategy: actionBlocked
      ? 'Держать. Продажа/сокращение заблокированы политикой no-sell.'
      : entryStrategy.text,
    technicalTiming: actionBlocked
      ? 'Держать. Продажа/сокращение заблокированы политикой no-sell.'
      : technicalTiming.text,
    policyBlocked: actionBlocked || rec.policyBlocked === true,
    policyTextBlocked: textBlocked || rec.policyTextBlocked === true,
    policyNote:
      actionBlocked || textBlocked ? policyNote : (rec.policyNote ?? null),
  };
}

/**
 * Применить политику к свободному AI-тексту (резюме / план / мониторинг).
 *
 * Работает в line-context режиме: если в строке есть no-sell тикер, он
 * становится активным контекстом, и последующие строки без тикера
 * (например, «→ рекомендуется сократить на ...») тоже санируются.
 * Это покрывает многострочные планы и fallback-отчёт.
 */
export function applyPolicyToNarrative(
  text: string,
  assets: AssetAnalysis[],
  policy?: PolicyLike,
): string {
  if (!text) return text;

  // Сначала склеиваем строки с незакрытыми скобками, иначе после замены
  // предложения может остаться хвост «5%) слишком высока…».
  const normalizedText = mergeUnbalancedParenthesisLines(text);

  const blockedTickers = new Set(
    assets
      .filter((asset) => isSellBlockedByPolicy(asset, policy))
      .map((asset) => normalizeTicker(asset.ticker))
      .filter(Boolean),
  );
  if (blockedTickers.size === 0) return text;

  const allTickers = new Set(
    assets.map((asset) => normalizeTicker(asset.ticker)).filter(Boolean),
  );

  let activeTicker: string | null = null;
  const changedTickers = new Set<string>();
  const lines = normalizedText.split('\n');

  const replaced = lines.map((line) => {
    const upper = line.toUpperCase();
    const blockedHere =
      [...blockedTickers].find((ticker) => upper.includes(ticker)) ?? null;

    if (blockedHere) {
      activeTicker = blockedHere;
    } else if ([...allTickers].some((ticker) => upper.includes(ticker))) {
      // Строка про другой актив — контекст no-sell тикера больше не действует.
      activeTicker = null;
    }

    const contextTicker = blockedHere ?? activeTicker;
    if (!contextTicker) return line;
    if (!SELL_BLOCK_PATTERN.test(line)) return line;

    // В одной строке могут быть фразы про разные тикеры
    // («Продавайте PLZL... Продавайте SBER...»). Заменяем только те
    // предложения, которые относятся к no-sell тикеру.
    const sentences = line.match(/[^.!?\n]+[.!?]?/g) ?? [line];
    let lineChanged = false;
    const replacedLine = sentences
      .map((sentence) => {
        const sentenceUpper = sentence.toUpperCase();
        const blockedInSentence =
          [...blockedTickers].find((ticker) =>
            sentenceUpper.includes(ticker),
          ) ?? null;
        const hasNonBlockedTicker = [...allTickers].some(
          (ticker) =>
            !blockedTickers.has(ticker) && sentenceUpper.includes(ticker),
        );

        if (blockedInSentence) {
          if (!SELL_BLOCK_PATTERN.test(sentence)) return sentence;
          changedTickers.add(blockedInSentence);
          lineChanged = true;
          return neutralPolicyLine(blockedInSentence);
        }

        if (hasNonBlockedTicker) return sentence;
        if (!SELL_BLOCK_PATTERN.test(sentence)) return sentence;

        changedTickers.add(contextTicker);
        lineChanged = true;
        return neutralPolicyLine(contextTicker);
      })
      .join(' ');

    return lineChanged ? replacedLine : line;
  });

  if (changedTickers.size === 0) return text;

  console.log(
    `[POLICY_TEXT] tickers=${[...changedTickers].join(',')} narrative=replaced`,
  );
  return replaced.join('\n');
}
