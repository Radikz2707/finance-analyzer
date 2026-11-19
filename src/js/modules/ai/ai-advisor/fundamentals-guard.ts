/**
 * Пост-валидация текста советника.
 *
 * Даже если модель проигнорировала промпт, слой «суть» не должен
 * содержать обобщений без числа и источника. Такие предложения
 * заменяются честной пометкой «недоступно», а не оставляются как факт.
 *
 * Дополнительно проверяется, что числа фундаментальных метрик принадлежат
 * СВОЕМУ тикеру, а не соседнему активу из того же прогона. Проверка
 * fail-closed: если подтверждающего значения нет (или нет самого объекта
 * фундаментала), цифра в тексте не сохраняется — вместо неё выводится
 * детерминированная пометка «недоступно (нет подтверждённых данных)».
 */

import type {
  SourcedValue,
  StockFundamentals,
} from '../../api/fundamentals/types.js';

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

/** Пометка для цифры, которую нечем подтвердить. */
const UNCONFIRMED = 'недоступно (нет подтверждённых данных)';

/**
 * Допуск сопоставления процентных метрик у соседних тикеров, в п.п.
 *
 * Почему в п.п., а не в долях: реальные соседние значения дивдоходности
 * (11,3% и 11,4%) отличаются на 0,1 п.п. и не должны считаться
 * контаминацией, а настоящая подмена (ROE 80,3% против реальных ~30%)
 * отличается на десятки п.п. Относительный допуск 5% для 11,4% даёт
 * 0,57 п.п. — слишком грубо и зависит от масштаба метрики. Абсолютный
 * допуск в п.п. ведёт себя одинаково для любых доходностей.
 *
 * Проверка диагностическая (warn-only): она не подменяет цифру в тексте,
 * а только возвращает упоминание для журнала [FUNDAMENTAL_CONTAMINATION].
 */
export const SIBLING_YIELD_TOLERANCE_PP = 0.5;

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
  if (normalized.startsWith('тыс')) return 1e3;
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

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',');
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

// ──────────────────────────────────────────────
// Реестр фундаментальных метрик карточки
// ──────────────────────────────────────────────

/** Как метрика называется в тексте и где её подтверждённое значение. */
interface MetricBinding {
  /** Каноническое имя для детерминированной замены. */
  label: string;
  /** Как метрика может быть названа в свободном тексте модели. */
  pattern: RegExp;
  /** Подтверждённое значение из контракта фундаментала. */
  pick: (fundamentals: StockFundamentals) => SourcedValue<number>;
  /** Сколько знаков показывать в детерминированной замене. */
  digits: number;
  /** Суффикс единицы измерения. */
  suffix: string;
}

/**
 * Все метрики, которые модель любит переписывать «по памяти».
 * Раньше проверялся только Долг/Капитал — отсюда проходили чужие
 * дивдоходности, P/E и ROE.
 */
const METRIC_BINDINGS: MetricBinding[] = [
  {
    label: 'Долг/Капитал',
    pattern: /долг\s*\/\s*капитал/i,
    pick: (fundamentals) => fundamentals.debtToEquity,
    digits: 2,
    suffix: '',
  },
  {
    label: 'Дивидендная доходность',
    // \w в JS не включает кириллицу — используем явный диапазон.
    // Окончание обязательно: иначе «доходност» обрывается и число
    // остаётся за пределами метки («ь 11,3%»), из-за чего проверка не видит цифру.
    pattern: /(дивидендн[а-яё]*\s+доходност[а-яё]*|дивдоходност[а-яё]*)/i,
    pick: (fundamentals) => fundamentals.dividendYield,
    digits: 1,
    suffix: '%',
  },
  {
    label: 'P/E',
    pattern: /\bP\s*\/\s*E\b/i,
    pick: (fundamentals) => fundamentals.pe,
    digits: 2,
    suffix: '',
  },
  {
    label: 'ROE',
    pattern: /\bROE\b/i,
    pick: (fundamentals) => fundamentals.roe,
    digits: 1,
    suffix: '%',
  },
  {
    label: 'Дивиденд на акцию',
    pattern: /дивиденд[а-яё]*\s+на\s+акци[а-яё]*/i,
    pick: (fundamentals) => fundamentals.dividendPerShare,
    digits: 2,
    suffix: ' ₽',
  },
  {
    label: 'Капитализация',
    pattern: /капитализаци[а-яё]*/i,
    pick: (fundamentals) => fundamentals.marketCap,
    digits: 2,
    suffix: ' ₽',
  },
];

/** Найденное в предложении число метрики. */
interface ParsedMetricNumber {
  /** Число в единицах метрики (для рублей — уже с множителем). */
  value: number;
  /** Сырое число из текста (для проверки на «чужое» значение). */
  raw: number;
}

/**
 * Достать число, стоящее сразу после названия метрики.
 * Возвращает null, если метрика упомянута без числа — такое предложение
 * не трогаем: качественное суждение без цифры не является утверждением о данных.
 */
function extractMetricNumber(
  sentence: string,
  binding: MetricBinding,
): ParsedMetricNumber | null {
  const match = binding.pattern.exec(sentence);
  if (!match) return null;

  const rest = sentence.slice(match.index + match[0].length);
  const numberMatch = rest.match(
    /^[\s:—–-]*([-−]?\d+(?:[.,]\d+)?)\s*(трлн|млрд|млн|тыс)?/i,
  );
  if (!numberMatch) return null;

  const raw = parseRuNumber(numberMatch[1] ?? '');
  if (raw === null) return null;

  return {
    value: raw * unitMultiplier(numberMatch[2]),
    raw,
  };
}

/** Диапазон чисел, стоящий сразу после названия метрики («9–12%»). */
interface ParsedMetricRange {
  low: number;
  high: number;
  /** Сырой текст диапазона — для журнала. */
  raw: string;
}

/**
 * Достать диапазон, стоящий сразу после названия метрики.
 *
 * Зачем отдельно от extractMetricNumber: фраза «дивидендная доходность
 * 9–12%» описывает коридор по нескольким активам, и первое число (9)
 * не обязано совпадать с подтверждённым значением конкретного тикера.
 */
function extractMetricRange(
  sentence: string,
  binding: MetricBinding,
): ParsedMetricRange | null {
  const match = binding.pattern.exec(sentence);
  if (!match) return null;

  const rest = sentence.slice(match.index + match[0].length);
  // Диапазон может стоять не сразу после метки: «доходность Полюса и
  // Интер РАО составляет 9–12%». Числа ограничены 1–3 цифрами, чтобы
  // не принять ISO-дату (2026-11-17) за диапазон.
  const rangeMatch = rest.match(
    /([-−]?\d{1,3}(?:[.,]\d+)?)\s*(?:[-–—]|до)\s*([-−]?\d{1,3}(?:[.,]\d+)?)\s*(трлн|млрд|млн|тыс)?/i,
  );
  if (!rangeMatch) return null;

  const first = parseRuNumber(rangeMatch[1] ?? '');
  const second = parseRuNumber(rangeMatch[2] ?? '');
  if (first === null || second === null) return null;

  const multiplier = unitMultiplier(rangeMatch[3]);
  return {
    low: Math.min(first, second) * multiplier,
    high: Math.max(first, second) * multiplier,
    raw: rangeMatch[0].trim(),
  };
}

/**
 * Совпадает ли подтверждённое значение с числом из текста.
 *
 * @param tolerancePp — абсолютный допуск в п.п. для процентных метрик.
 *   Если задан, используется вместо относительного допуска.
 */
function matchesConfirmed(
  ownValue: number,
  parsed: ParsedMetricNumber,
  digits: number,
  tolerancePp?: number,
): boolean {
  // Для рублёвых метрик текст может быть в млн/млрд — сравниваем value,
  // для коэффициентов и процентов — raw.
  const candidates = [parsed.value, parsed.raw];
  const tolerance =
    tolerancePp !== undefined
      ? Math.max(tolerancePp, 1e-9)
      : Math.max(digits === 0 ? 1 : 0.05, Math.abs(ownValue) * 0.05);
  return candidates.some(
    (candidate) => Math.abs(ownValue - candidate) <= tolerance,
  );
}

/** Допуск в п.п. применяется только к процентным метрикам. */
function metricTolerancePp(
  binding: MetricBinding,
  siblingYieldTolerancePp: number,
): number | undefined {
  return binding.suffix === '%' ? siblingYieldTolerancePp : undefined;
}

function renderConfirmed(
  ticker: string,
  binding: MetricBinding,
  fundamentals: StockFundamentals,
): string {
  const metric = binding.pick(fundamentals);
  const source = metric.source ?? 'источник не указан';
  return (
    `${ticker}: ${binding.label} ` +
    `${formatNumber(metric.value ?? 0, binding.digits)}${binding.suffix} ` +
    `(${source}, ${formatAsOf(metric.asOf)})`
  );
}

function renderUnavailable(ticker: string, binding: MetricBinding): string {
  return `${ticker}: ${binding.label} — ${UNCONFIRMED}`;
}

/** Фундаментал другого актива того же прогона — для cross-ticker проверки. */
export interface FundamentalSibling {
  ticker: string;
  fundamentals: StockFundamentals;
}

/** Упоминание метрики, значение которой совпало с чужим тикером. */
export interface ForeignMetricMention {
  label: string;
  value: number;
  foreignTicker: string;
}

/**
 * Найти в тексте числа, которые совпадают со значениями ДРУГИХ тикеров.
 * Нужен для диагностики контаминации: даже если своё значение тоже
 * оказалось рядом, факт заимствования должен быть виден в логе прогона.
 */
export function detectForeignMetricMentions(
  text: string | null | undefined,
  ownTicker: string,
  own: StockFundamentals | undefined,
  siblings: FundamentalSibling[] = [],
  siblingYieldTolerancePp: number = SIBLING_YIELD_TOLERANCE_PP,
): ForeignMetricMention[] {
  if (!text) return [];

  const mentions: ForeignMetricMention[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    for (const binding of METRIC_BINDINGS) {
      const parsed = extractMetricNumber(sentence, binding);
      if (!parsed) continue;

      const tolerancePp = metricTolerancePp(binding, siblingYieldTolerancePp);
      const ownValue = own ? binding.pick(own).value : null;
      if (
        ownValue !== null &&
        matchesConfirmed(ownValue, parsed, binding.digits, tolerancePp)
      ) {
        continue;
      }

      for (const sibling of siblings) {
        if (sibling.ticker.toUpperCase() === ownTicker.toUpperCase()) continue;
        const foreignValue = binding.pick(sibling.fundamentals).value;
        if (foreignValue === null) continue;
        if (
          matchesConfirmed(foreignValue, parsed, binding.digits, tolerancePp)
        ) {
          mentions.push({
            label: binding.label,
            value: foreignValue,
            foreignTicker: sibling.ticker,
          });
          break;
        }
      }
    }
  }

  return mentions;
}

/**
 * Проверить, что пояснение по фундаменталу относится к своему тикеру.
 *
 * Поведение:
 * 1. Обобщения без числа и источника вырезаются (как раньше).
 * 2. Если объекта фундаментала нет — любые числа фундаментальных метрик
 *    в тексте считаются неподтверждёнными и заменяются пометкой.
 * 3. Если своё значение метрики отсутствует (null) — число из текста
 *    заменяется пометкой «недоступно».
 * 4. Если число расходится со своим подтверждённым значением (в т.ч.
 *    совпадает с соседним тикером) — предложение заменяется
 *    детерминированной атрибуцией своего значения с источником и датой.
 */
export function validateFundamentalTextForTicker(
  text: string | null | undefined,
  ticker: string,
  fundamentals?: StockFundamentals,
  siblings: FundamentalSibling[] = [],
  siblingYieldTolerancePp: number = SIBLING_YIELD_TOLERANCE_PP,
  section: 'card' | 'narrative' = 'card',
): string | null {
  const sanitized = sanitizeFundamentalText(text);
  if (!sanitized) return sanitized;

  const sentences = sanitized.split(/(?<=[.!?])\s+/);

  const validated = sentences.map((sentence) => {
    // 1. Специальная ветка Д/К: коэффициент и абсолютные величины.
    if (fundamentals) {
      const ratioMatch = sentence.match(/Долг\s*\/\s*Капитал\s+([\d.,]+)/i);
      const ownRatio = fundamentals.debtToEquity.value;
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

      const absoluteMatch = sentence.match(
        /долг[а-я]*\s+([\d\s.,]+)\s*(млрд|млн|трлн)?[^.]*?капитал[а-я]*\s+([\d\s.,]+)\s*(млрд|млн|трлн)?/i,
      );
      if (absoluteMatch) {
        const debtValue = fundamentals.debt.value;
        const equityValue = fundamentals.equity.value;

        if (debtValue === null || equityValue === null) {
          // Нет подтверждённых абсолютных величин — числа из текста не оставляем.
          return buildDebtToEquityAttribution(ticker, fundamentals);
        }

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
          Math.abs(parsedDebt - debtValue) >
            Math.max(1, Math.abs(debtValue) * 0.1);
        const equityMismatch =
          parsedEquity !== null &&
          Math.abs(parsedEquity - equityValue) >
            Math.max(1, Math.abs(equityValue) * 0.1);
        if (debtMismatch || equityMismatch) {
          return buildDebtToEquityAttribution(ticker, fundamentals);
        }
      }
    }

    // 2. Остальные метрики: дивдоходность, P/E, ROE, дивиденд на акцию,
    //    капитализация. Любое расхождение или отсутствие подтверждения
    //    удаляет цифру из свободного текста.
    const replacements: string[] = [];
    for (const binding of METRIC_BINDINGS) {
      if (binding.label === 'Долг/Капитал') continue;

      const parsed = extractMetricNumber(sentence, binding);
      if (!parsed) continue;

      if (!fundamentals) {
        console.warn(
          `[NARRATIVE_METRIC_CONTRACT] section=${section} ticker=${ticker} ` +
            `label=${binding.label} old=${parsed.raw} new=${UNCONFIRMED} reason=unconfirmed`,
        );
        replacements.push(
          `${ticker}: фундаментальные показатели — ${UNCONFIRMED}`,
        );
        continue;
      }

      const own = binding.pick(fundamentals);
      if (own.value === null) {
        console.warn(
          `[NARRATIVE_METRIC_CONTRACT] section=${section} ticker=${ticker} ` +
            `label=${binding.label} old=${parsed.raw} new=unavailable reason=unconfirmed`,
        );
        replacements.push(renderUnavailable(ticker, binding));
        continue;
      }

      const tolerancePp = metricTolerancePp(binding, siblingYieldTolerancePp);
      if (matchesConfirmed(own.value, parsed, binding.digits, tolerancePp)) {
        continue;
      }

      // Число не совпало со своим. Проверяем, не взято ли оно у соседа —
      // это отдельный сигнал контаминации, полезный в диагностике.
      const foreign = siblings.find(
        (sibling) =>
          sibling.ticker.toUpperCase() !== ticker.toUpperCase() &&
          (() => {
            const foreignValue = binding.pick(sibling.fundamentals).value;
            return (
              foreignValue !== null &&
              matchesConfirmed(
                foreignValue,
                parsed,
                binding.digits,
                tolerancePp,
              )
            );
          })(),
      );

      console.warn(
        `[NARRATIVE_METRIC_CONTRACT] section=${section} ticker=${ticker} ` +
          `label=${binding.label} old=${parsed.raw} own=${own.value} ` +
          `new=${own.value} reason=${foreign ? 'foreign' : 'own_value'} ` +
          `tolerance=${metricTolerancePp(binding, siblingYieldTolerancePp) ?? 'abs_0.05'}`,
      );
      replacements.push(
        foreign
          ? `${renderConfirmed(ticker, binding, fundamentals)} — значение другого актива отклонено`
          : renderConfirmed(ticker, binding, fundamentals),
      );
    }

    if (replacements.length > 0) {
      return replacements.join(' ');
    }

    return sentence;
  });

  return validated.join(' ');
}

/** Актив narrative-секции: тикер, имя и подтверждённый фундаментал. */
export interface NarrativeFundamentalAsset {
  ticker: string;
  name?: string;
  fundamentals: StockFundamentals;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Все тикеры, упомянутые в предложении (по тикеру или имени актива). */
function findNarrativeTickers(
  sentence: string,
  assets: NarrativeFundamentalAsset[],
): string[] {
  const found = new Set<string>();
  const upper = sentence.toUpperCase();
  for (const asset of assets) {
    const ticker = (asset.ticker ?? '').trim().toUpperCase();
    if (!ticker) continue;
    const pattern = new RegExp(
      `(?:^|[^A-ZА-ЯЁ0-9])${escapeRegExp(ticker)}(?![A-ZА-ЯЁ0-9])`,
      'i',
    );
    if (pattern.test(upper)) found.add(ticker);
  }

  const lower = sentence.toLowerCase();
  for (const asset of assets) {
    const ticker = asset.ticker.toUpperCase();
    if (found.has(ticker)) continue;
    const name = (asset.name ?? '').trim();
    if (name.length < 4) continue;
    if (lower.includes(name.toLowerCase())) {
      found.add(ticker);
      continue;
    }
    const firstToken = name.split(/\s+/)[0] ?? '';
    if (firstToken.length >= 5 && lower.includes(firstToken.toLowerCase())) {
      found.add(ticker);
    }
  }

  return [...found];
}

/**
 * Проверить диапазон метрики по подтверждённым значениям упомянутых активов.
 *
 * Возвращает:
 * - `null` — диапазона в предложении нет (или подтверждённых значений нет):
 *   предложение обрабатывается обычным контрактом;
 * - исходное предложение — диапазон покрывает все подтверждённые значения
 *   (кейс «дивидендная доходность 9–12%» при 11,3% и 11,4%);
 * - детерминированную замену — диапазон выходит за подтверждённые значения
 *   (`reason=range_violation`).
 */
function validateNarrativeRange(
  sentence: string,
  tickers: readonly string[],
  assets: NarrativeFundamentalAsset[],
  siblingYieldTolerancePp: number,
): string | null {
  if (tickers.length === 0) return null;

  let hasRange = false;

  for (const binding of METRIC_BINDINGS) {
    if (binding.label === 'Долг/Капитал') continue;

    const range = extractMetricRange(sentence, binding);
    if (!range) continue;
    hasRange = true;

    const confirmed: Array<{
      ticker: string;
      fundamentals: StockFundamentals;
      value: number;
    }> = [];
    for (const ticker of tickers) {
      const asset = assets.find(
        (candidate) => candidate.ticker.toUpperCase() === ticker.toUpperCase(),
      );
      if (!asset) continue;
      const value = binding.pick(asset.fundamentals).value;
      if (value === null) continue;
      confirmed.push({
        ticker: asset.ticker.toUpperCase(),
        fundamentals: asset.fundamentals,
        value,
      });
    }

    // Нет подтверждённых значений — не перехватываем: fail-closed ветка
    // обычного контракта сама заменит число на «недоступно».
    if (confirmed.length === 0) return null;

    const tolerance =
      metricTolerancePp(binding, siblingYieldTolerancePp) ??
      Math.max(0.05, Math.abs(range.high) * 0.05);
    const allInRange = confirmed.every(
      (item) =>
        item.value >= range.low - tolerance &&
        item.value <= range.high + tolerance,
    );
    if (allInRange) continue;

    console.warn(
      '[NARRATIVE_METRIC_CONTRACT] section=narrative ' +
        `ticker=${tickers.join(',')} label=${binding.label} ` +
        `old=${range.raw} new=${confirmed
          .map((item) => `${item.ticker}:${item.value}`)
          .join(',')} reason=range_violation`,
    );
    return confirmed
      .map((item) => renderConfirmed(item.ticker, binding, item.fundamentals))
      .join(' ');
  }

  return hasRange ? sentence : null;
}

/**
 * Контракт метрик для СВОБОДНОГО narrative.
 *
 * Зачем отдельная функция: validateFundamentalTextForTicker вызывался только
 * для JSON-полей карточки, поэтому в narrative проходили «P/E 7,18, ROE 80,3%»
 * без источника и даты. Здесь тот же контракт применяется к тексту отчёта:
 * предложение привязывается к тикеру, а число либо подтверждается своим
 * значением с атрибуцией (источник, дата), либо заменяется на «недоступно».
 */
export function validateNarrativeFundamentals(
  text: string | null | undefined,
  assets: NarrativeFundamentalAsset[],
  siblingYieldTolerancePp: number = SIBLING_YIELD_TOLERANCE_PP,
): string | null {
  const sanitized = sanitizeFundamentalText(text);
  if (!sanitized) return sanitized;

  const sentences = sanitized.split(/(?<=[.!?])\s+/);
  let activeTicker: string | null = null;

  const validated = sentences.map((sentence) => {
    const mentionedTickers = findNarrativeTickers(sentence, assets);
    const mentioned = mentionedTickers[0] ?? null;
    if (mentioned) activeTicker = mentioned;
    const ticker = mentioned ?? activeTicker;

    // Диапазонный режим: «доходность 9–12%» по нескольким известным активам
    // подтверждается, если коридор покрывает их подтверждённые значения.
    const rangeResult = validateNarrativeRange(
      sentence,
      mentionedTickers,
      assets,
      siblingYieldTolerancePp,
    );
    if (rangeResult !== null) return rangeResult;

    if (!ticker) {
      // Число без привязки к активу подтвердить нечем — fail-closed.
      const hasMetric = METRIC_BINDINGS.some((binding) =>
        extractMetricNumber(sentence, binding),
      );
      if (!hasMetric) return sentence;

      console.warn(
        '[NARRATIVE_METRIC_CONTRACT] section=narrative ticker=n/a label=any ' +
          `old="${sentence.trim().slice(0, 80)}" new=${UNCONFIRMED} reason=no_ticker`,
      );
      return `${UNCONFIRMED}: тикер не определён`;
    }

    const own = assets.find(
      (asset) => asset.ticker.toUpperCase() === ticker.toUpperCase(),
    );
    const siblings: FundamentalSibling[] = assets
      .filter((asset) => asset.ticker.toUpperCase() !== ticker.toUpperCase())
      .map((asset) => ({
        ticker: asset.ticker,
        fundamentals: asset.fundamentals,
      }));

    return (
      validateFundamentalTextForTicker(
        sentence,
        ticker,
        own?.fundamentals,
        siblings,
        siblingYieldTolerancePp,
        'narrative',
      ) ?? ''
    );
  });

  return validated.join(' ');
}
