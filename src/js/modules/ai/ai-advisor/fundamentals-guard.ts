/**
 * Пост-валидация текста советника.
 *
 * Даже если модель проигнорировала промпт, слой «суть» не должен
 * содержать обобщений без числа и источника. Такие предложения
 * заменяются честной пометкой «недоступно», а не оставляются как факт.
 *
 * Дополнительно проверяется, что пояснение «Долг/Капитал» использует
 * данные ТОЛЬКО своего тикера, а не числа из few-shot примера другого актива.
 */

import type { StockFundamentals } from '../../api/fundamentals/types.js';

/** Обобщения, которые запрещены без конкретного числа и источника. */
const GENERALIZATION_PATTERNS: RegExp[] = [
  /обычно[\s\S]{0,60}?\d+([.,]\d+)?\s*%?/i,
  /как\s+правило/i,
  /в\s+среднем[\s\S]{0,60}?\d+([.,]\d+)?/i,
  /традиционно[\s\S]{0,60}?\d+([.,]\d+)?/i,
  /исторически[\s\S]{0,60}?\d+([.,]\d+)?/i,
  /известен[^.]{0,60}(высокой|низкой)\s+(рентабельностью|доходностью|долговой\s+нагрузкой)/i,
  /(дивиденды|доходность|рентабельность)[^.]{0,60}обычно/i,
];

/** Признаки того, что в предложении есть источник и дата. */
const SOURCE_MARKER =
  /(smart-lab\.ru|MOEX\s*ISS|MOEX|источник[:\s]|\(\s*[^)]*\d{2}\.\d{2}\.\d{4}\s*\))/i;

const REPLACEMENT = 'недоступно: обобщение без числа и источника запрещено';

/** Проверить, есть ли в предложении запрещённое обобщение. */
export function hasForbiddenGeneralization(sentence: string): boolean {
  return GENERALIZATION_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Очистить текст «сути» от обобщений без числа/источника.
 * Возвращает null, если на входе null/undefined.
 */
export function sanitizeFundamentalText(
  text: string | null | undefined,
): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (!trimmed) return '';

  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const sanitized = sentences.map((sentence) => {
    if (!hasForbiddenGeneralization(sentence)) return sentence;

    const hasNumber = /\d/.test(sentence);
    const hasSource = SOURCE_MARKER.test(sentence);
    if (hasNumber && hasSource) return sentence;

    return REPLACEMENT;
  });

  return sanitized.join(' ');
}

function parseRuNumber(value: string): number | null {
  const normalized = value.replace(/\s+/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function unitMultiplier(unit: string | undefined): number {
  const normalized = (unit ?? '').toLowerCase();
  if (normalized.startsWith('трлн')) return 1e12;
  if (normalized.startsWith('млрд')) return 1e9;
  if (normalized.startsWith('млн')) return 1e6;
  return 1;
}

function formatRub(value: number): string {
  if (value >= 1e12)
    return `${(value / 1e12).toFixed(2).replace('.', ',')} трлн ₽`;
  if (value >= 1e9)
    return `${(value / 1e9).toFixed(1).replace('.', ',')} млрд ₽`;
  if (value >= 1e6)
    return `${(value / 1e6).toFixed(1).replace('.', ',')} млн ₽`;
  return `${value.toLocaleString('ru-RU')} ₽`;
}

function formatAsOf(value: string | null): string {
  if (!value) return 'дата не указана';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ru-RU');
}

function buildDebtToEquityAttribution(
  ticker: string,
  fundamentals: StockFundamentals,
): string {
  const metric = fundamentals.debtToEquity;
  const ratio =
    metric.value === null
      ? 'недоступно'
      : metric.value.toFixed(2).replace('.', ',');
  const source =
    metric.source ?? fundamentals.sourcesUsed[0] ?? 'источник не указан';
  const asOf = formatAsOf(metric.asOf ?? fundamentals.price.asOf);
  const absolute =
    fundamentals.debt.value !== null && fundamentals.equity.value !== null
      ? ` — долг ${formatRub(fundamentals.debt.value)} на капитал ${formatRub(
          fundamentals.equity.value,
        )}`
      : '';

  return `${ticker}: Долг/Капитал ${ratio} (${source}, ${asOf})${absolute}.`;
}

/**
 * Проверить, что пояснение Д/К относится к своему тикеру.
 * При несовпадении возвращает детерминированный текст с сохранением
 * источника и даты — в том же формате, что остальные метрики карточки.
 */
export function validateFundamentalTextForTicker(
  text: string | null | undefined,
  ticker: string,
  fundamentals?: StockFundamentals,
): string | null {
  const sanitized = sanitizeFundamentalText(text);
  if (!sanitized || !fundamentals) return sanitized;

  const ownRatio = fundamentals.debtToEquity.value;
  const ratioMatch = sanitized.match(/Долг\s*\/\s*Капитал\s+([\d.,]+)/i);
  if (ratioMatch && ownRatio !== null) {
    const parsedRatio = parseRuNumber(ratioMatch[1] ?? '');
    if (
      parsedRatio !== null &&
      Math.abs(parsedRatio - ownRatio) >
        Math.max(0.05, Math.abs(ownRatio) * 0.05)
    ) {
      return buildDebtToEquityAttribution(ticker, fundamentals);
    }
  }

  const absoluteMatch = sanitized.match(
    /долг[а-я]*\s+([\d\s.,]+)\s*(млрд|млн|трлн)?[^.]*?капитал[а-я]*\s+([\d\s.,]+)\s*(млрд|млн|трлн)?/i,
  );
  if (
    absoluteMatch &&
    fundamentals.debt.value !== null &&
    fundamentals.equity.value !== null
  ) {
    const parsedDebt =
      parseRuNumber(absoluteMatch[1] ?? '') !== null
        ? (parseRuNumber(absoluteMatch[1] ?? '') ?? 0) *
          unitMultiplier(absoluteMatch[2])
        : null;
    const parsedEquity =
      parseRuNumber(absoluteMatch[3] ?? '') !== null
        ? (parseRuNumber(absoluteMatch[3] ?? '') ?? 0) *
          unitMultiplier(absoluteMatch[4])
        : null;
    const debtMismatch =
      parsedDebt !== null &&
      Math.abs(parsedDebt - fundamentals.debt.value) >
        Math.max(1, Math.abs(fundamentals.debt.value) * 0.1);
    const equityMismatch =
      parsedEquity !== null &&
      Math.abs(parsedEquity - fundamentals.equity.value) >
        Math.max(1, Math.abs(fundamentals.equity.value) * 0.1);
    if (debtMismatch || equityMismatch) {
      return buildDebtToEquityAttribution(ticker, fundamentals);
    }
  }

  return sanitized;
}
