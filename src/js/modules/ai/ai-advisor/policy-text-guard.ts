/**
 * PolicyTextGuard — применение пользовательской no-sell политики к ТЕКСТАМ,
 * а не только к структурированным действиям.
 *
 * Зачем: guardrails уже заменяют REDUCE/EXIT на HOLD, но AI-текст
 * (entryStrategy, rationale, narrative) мог остаться прежним и показать
 * пользователю «Продавайте <актив>», хотя продажа запрещена политикой.
 *
 * Принципы:
 * - не трогаем нейтральные описания («объём продаж», «ликвидность продажи»);
 * - заменяем только императивные/инфинитивные sell-директивы и sell-нарратив;
 * - покупка для no-sell тикера не запрещается (докупать можно);
 * - актив определяется и по тикеру, и по имени (narrative часто пишет «Полюс»);
 * - замена выполняется по строке/предложению целиком, без вставки в середину
 *   предложения и без обрывков незакрытых скобок;
 * - функции чистые, без I/O.
 */

import type { AssetAnalysis } from '../../portfolio/portfolio-math/portfolio-math.js';
import type { StructuredAIAssetRecommendation } from './structured-ai-recommendation.js';
import { PortfolioConfig } from '../../../config/portfolio-config.js';

/** Минимальный контракт пользовательской политики. */
export interface PolicyLike {
  noSellTickers?: string[];
  noSellAssetTypes?: string[];
}

const BOND_TYPE_ALIASES = new Set(['О', 'ОБЛИГАЦИЯ', 'BOND', 'BONDS']);
const STOCK_TYPE_ALIASES = new Set(['А', 'АКЦИЯ', 'STOCK', 'STOCKS']);

/** Конфиг детекции: корни и маркеры вынесены в portfolio-config. */
const DETECTION = PortfolioConfig.narrativePolicy;

/** Предкомпилированные семантические конструкции. */
const STRUCTURAL_PATTERNS = DETECTION.structuralPatterns.map(
  (pattern) => new RegExp(pattern, 'i'),
);

/**
 * Строки политики, которые рендерит САМ конвейер, а не модель.
 *
 * Их нельзя санировать: иначе санатор зацикливается на собственном
 * результате («PLZL: держать — продажа/сокращение заблокированы»)
 * и в четырнадцати карточках облигаций начинается самоперегенерация.
 */
const POLICY_STATEMENT_PATTERNS: RegExp[] = [
  /продажа\/сокращение\s+заблокированы\s+политикой\s+no-sell/i,
  /^⛔\s*Заблокировано\s+политикой\s+no-sell/i,
  /^[^:]{1,40}:\s*держать\s*[—–-]\s*продажа\/сокращение/i,
  // Аргументные фразы карточек («<Актив>: держать — … заблокированы»):
  // сюда же попадают строки, где дефис/написание no-sell искажены
  // извлечением PDF («политикой поsell»). Такие строки — текст политики,
  // их нельзя ни санировать, ни дублировать.
  /держать\s*[—–-]\s*[^.!?]{0,80}?заблокирован/i,
  /заблокирован[а-яё]*\s+политикой\s+no-sell/i,
  // Искажённый хвост без глагола: «… политикой поsell.»
  /политик[а-яё]*\s+no-sell/i,
];

/**
 * Привести вариации написания no-sell к каноническому виду ДО матчинга.
 *
 * Модель и PDF-извлечение дают «после», «поsell», «по-sell», «no sell»,
 * «no_sell». Без нормализации такие строки не распознаются как текст
 * политики и попадают в rationale вторым экземпляром.
 */
export function normalizePolicySpelling(value: string): string {
  return value
    .replace(/\b(?:no|по)\s*[-_–—]?\s*sell\b/gi, 'no-sell')
    .replace(/политик[а-яё]*\s+no\s+sell/gi, 'политикой no-sell');
}

/**
 * Нормализация LaTeX-разметки в тексте карточек.
 *
 * Модель генерирует математическую разметку `$...$` (например, `$1.6 < 3.5$`),
 * которая рендерится как есть в отчёте. Разворачиваем в обычный текст:
 * - `$1.6 < 3.5$` → `1,6 < 3,5` (замена точки на запятую, удаление $)
 * - `$...$` → содержимое с заменой точек на запятые (русская нотация)
 */
export function normalizeLatexMarkup(
  text: string | null | undefined,
): string | null {
  if (!text) return text ?? null;

  return text.replace(/\$([^$]+)\$/g, (_match, content: string) => {
    // Удаляем LaTeX-команды (\b, \s, и т.д.)
    let cleaned = content.replace(/\\[a-zA-Z]+/g, '');
    // Заменяем английские десятичные точки на русские запятые
    cleaned = cleaned.replace(/(\d)\.(\d)/g, '$1,$2');
    return cleaned;
  });
}

/** Является ли строка/предложение текстом политики, сгенерированным pipeline. */
export function isPolicyStatement(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = normalizePolicySpelling(text).trim();
  return POLICY_STATEMENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Источник строки политики. */
export type PolicyStatementProvenance = 'pipeline' | 'model';

/** Строка политики с пометкой источника. */
export interface PolicyStatementWithProvenance {
  text: string;
  provenance: PolicyStatementProvenance;
}

/**
 * Схлопнуть повторяющиеся строки политики в тексте.
 *
 * Служебный текст пишет конвейер (баннер/подпись карточки), модель не
 * обязана его повторять. Первый экземпляр сохраняется как есть, все
 * последующие предложения-политики удаляются, даже если написаны
 * искажённо («после», «поsell»).
 */
export function dedupePolicyStatements(
  text: string | null | undefined,
  ticker: string,
): { text: string | null; removed: number } {
  if (!text) return { text: text ?? null, removed: 0 };

  let seenPolicy = false;
  let removed = 0;

  const lines = text.split('\n').map((line) => {
    const sentences = splitSentences(line);
    const kept: string[] = [];

    for (const sentence of sentences) {
      if (!isPolicyStatement(sentence)) {
        kept.push(sentence);
        continue;
      }
      if (seenPolicy) {
        removed++;
        continue;
      }
      seenPolicy = true;
      kept.push(sentence);
    }

    return kept
      .join(' ')
      .replace(/[ \t]+([.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  });

  if (removed > 0) {
    console.log(
      `[POLICY_TEXT] layer=dedupe mode=card ticker=${normalizeTicker(ticker) || 'n/a'} dedup=${removed}`,
    );
  }

  return {
    text: lines.filter((line) => line.length > 0).join('\n'),
    removed,
  };
}

/**
 * Схлопнуть повторяющиеся строки политики с учётом provenance.
 *
 * Pipeline-строки (provenance='pipeline') защищены — не удаляются.
 * Модельные строки (provenance='model') удаляются как дубликаты,
 * даже если появились первыми.
 *
 * Дополнительно: model-строки содержащие sell-директивы (detectSellDirective)
 * тоже удаляются — это признак того что модель не очистила свой текст.
 *
 * @returns текст с удалёнными дубликатами + количество удалённых модельных строк
 */
export function dedupePolicyStatementsWithProvenance(
  statements: PolicyStatementWithProvenance[],
  ticker: string,
): { text: string; removed: number } {
  if (statements.length === 0) return { text: '', removed: 0 };

  let removed = 0;
  let pipelineSeen = false;
  const kept: PolicyStatementWithProvenance[] = [];

  for (const stmt of statements) {
    const isPipelinePolicy = isPolicyStatement(stmt.text);
    const hasSellDirective = detectSellDirective(stmt.text, 'card') !== null;

    // Pipeline-строка политики — всегда защищена
    if (isPipelinePolicy) {
      if (!pipelineSeen) {
        pipelineSeen = true;
        kept.push(stmt);
      } else {
        // Повторная pipeline-строка — не дублируем
        removed++;
      }
      continue;
    }

    // Model-строка: если содержит sell-директиву — удаляем
    // (модель не очистила свой текст, sanitizePolicyCardText не справился)
    if (hasSellDirective) {
      removed++;
      continue;
    }

    // Остальные model-строки — сохраняем
    kept.push(stmt);
  }

  if (removed > 0) {
    console.log(
      `[POLICY_TEXT] layer=dedupe-provenance mode=card ticker=${normalizeTicker(ticker) || 'n/a'} ` +
        `dedup=${removed} pipeline_protected=${pipelineSeen}`,
    );
  }

  return {
    text: kept.map((s) => s.text).join('\n'),
    removed,
  };
}

/** Нормализация для сравнения: регистр и ё→е (модель пишет и так, и так). */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е');
}

function containsAny(text: string, needles: readonly string[]): boolean {
  const normalized = normalizeForMatch(text);
  return needles.some((needle) =>
    normalized.includes(normalizeForMatch(needle)),
  );
}

/** Есть ли в предложении признак суммы/процента/доли/партии. */
export function hasAmountOrShareMarker(text: string): boolean {
  return containsAny(text, DETECTION.amountOrShareMarkers);
}

/**
 * Директива «реализовать» — только с объектом сделки.
 *
 * «Нереализованный P&L: −134 760 ₽» — легитимная лексика отчёта, а не
 * директива; поэтому причастие отсекается явным списком форм и проверкой
 * отрицания «не» перед формой.
 */
function hasRealizeDirective(text: string): boolean {
  const normalized = normalizeForMatch(text);
  const hasForm = DETECTION.realizeForms.some((form) => {
    const index = normalized.indexOf(normalizeForMatch(form));
    if (index === -1) return false;
    const before = normalized.slice(Math.max(0, index - 3), index).trim();
    return before !== 'не' && !before.endsWith('не');
  });
  return hasForm && containsAny(text, DETECTION.tradeObjectMarkers);
}

/** Чем именно распознана директива (для лога [POLICY_TEXT]). */
export type SellDirectiveRule =
  'structural' | 'realize' | 'stem' | 'stem+context' | 'stem+amount';

/**
 * Распознать sell-директиву по стемам и семантическим конструкциям.
 *
 * mode:
 * - `narrative` — свободный текст: корневая директива учитывается только
 *   при маркере суммы/доли. Иначе «пересмотрите решение о продаже» —
 *   не директива, а обсуждение;
 * - `card` — per-asset поле: тикер задан контекстом, маркер суммы не нужен.
 */
export function detectSellDirective(
  sentence: string,
  mode: 'narrative' | 'card',
): SellDirectiveRule | null {
  if (!sentence) return null;

  // Явная проверка артефакта «поsell» ДО isPolicyStatement.
  // normalizePolicySpelling нормализует «поsell» → «no-sell»,
  // поэтому isPolicyStatement распознаёт как pipeline и возвращает null.
  // Но «поsell» — это артефакт модели, а не настоящий pipeline-текст.
  if (/поsell/gi.test(sentence)) {
    return 'stem';
  }

  if (isPolicyStatement(sentence)) return null;

  if (STRUCTURAL_PATTERNS.some((pattern) => pattern.test(sentence))) {
    return 'structural';
  }

  if (hasRealizeDirective(sentence)) {
    return 'realize';
  }

  if (containsAny(sentence, DETECTION.directiveStems)) {
    return mode === 'narrative' && !hasAmountOrShareMarker(sentence)
      ? null
      : 'stem';
  }

  if (containsAny(sentence, DETECTION.nounStems)) {
    if (containsAny(sentence, DETECTION.nounDirectiveContext)) {
      return mode === 'narrative' && !hasAmountOrShareMarker(sentence)
        ? null
        : 'stem+context';
    }
    if (hasAmountOrShareMarker(sentence)) {
      return 'stem+amount';
    }
  }

  return null;
}

/** Является ли действие продажей/сокращением. */
export function isSellAction(action: string | null | undefined): boolean {
  return action === 'SELL' || action === 'REDUCE' || action === 'EXIT';
}

/** Есть ли в тексте sell-директива (per-asset режим: тикер уже известен). */
export function hasSellDirective(text: string | null | undefined): boolean {
  if (!text) return false;
  return splitSentences(text).some(
    (sentence) => detectSellDirective(sentence, 'card') !== null,
  );
}

function normalizeTicker(ticker: string | undefined): string {
  return (ticker ?? '').trim().toUpperCase();
}

/** Служебные слова, которые не помогают опознать актив по имени. */
const NAME_STOP_WORDS =
  /\b(ПАО|ОАО|ЗАО|АО|ООО|АКБ|БАНК|ГРУППА|КОМПАНИЯ|ХОЛДИНГ|ИНВЕСТ|ФОНД)\b/gi;

/** Нормализовать имя актива для поиска в свободном тексте. */
export function normalizeAssetName(name: string | undefined): string {
  return (name ?? '')
    .replace(/[«»"'`]/g, ' ')
    .replace(NAME_STOP_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Найти актив, упомянутый в тексте: сначала по тикеру (точное слово),
 * затем по нормализованному имени.
 */
export function findAssetInText<T extends { ticker: string; name?: string }>(
  text: string,
  assets: T[],
): T | null {
  if (!text) return null;
  const upper = text.toUpperCase();

  for (const asset of assets) {
    const ticker = normalizeTicker(asset.ticker);
    if (!ticker) continue;
    const tickerPattern = new RegExp(
      `(?:^|[^A-ZА-ЯЁ0-9])${escapeRegExp(ticker)}(?![A-ZА-ЯЁ0-9])`,
      'i',
    );
    if (tickerPattern.test(upper)) return asset;
  }

  const lower = text.toLowerCase();
  for (const asset of assets) {
    const name = normalizeAssetName(asset.name);
    if (name.length < 4) continue;
    if (lower.includes(name.toLowerCase())) return asset;
    // Имена вида «Интер РАО» в тексте могут быть «ИРАО» — первый значимый
    // токен тоже считаем упоминанием, если он длиннее 4 символов.
    const firstToken = name.split(' ')[0] ?? '';
    if (firstToken.length >= 5 && lower.includes(firstToken.toLowerCase())) {
      return asset;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Разбить ОДНУ строку на предложения, не ломаясь на:
 * - десятичных числах с точкой/запятой (`11.3`, `7,18`);
 * - сокращениях (`руб.`, `п.п.`, `т.д.`, `млн.`);
 * - инициалах и одиночных буквах.
 *
 * Переводы строк обрабатываются вызывающим кодом построчно.
 */
export function splitSentences(line: string): string[] {
  if (!line) return [];

  const abbreviations = new Set([
    'руб',
    'коп',
    'шт',
    'п',
    'пп',
    'т',
    'д',
    'др',
    'г',
    'гг',
    'млн',
    'млрд',
    'тыс',
    'им',
    'ул',
    'рис',
    'табл',
    'см',
    'напр',
    'г',
  ]);

  const result: string[] = [];
  let start = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    let end = i + 1;
    while (end < line.length && /[.!?]/.test(line[end]!)) end++;

    const next = line[end];
    if (next === undefined) {
      i = end - 1;
      continue;
    }
    if (!/\s/.test(next)) {
      i = end - 1;
      continue;
    }

    // Десятичное число: цифра до точки и цифра после пробела/точки.
    let lookahead = end;
    while (lookahead < line.length && /\s/.test(line[lookahead]!)) lookahead++;
    const nextNonSpace = line[lookahead] ?? '';
    const prev = line[i - 1] ?? '';
    if (ch === '.' && /\d/.test(prev) && /\d/.test(nextNonSpace)) {
      i = end - 1;
      continue;
    }

    if (ch === '.') {
      let wordStart = i - 1;
      while (wordStart >= 0 && /[A-Za-zА-Яа-яЁё]/.test(line[wordStart]!)) {
        wordStart--;
      }
      const word = line.slice(wordStart + 1, i).toLowerCase();
      if (abbreviations.has(word)) {
        i = end - 1;
        continue;
      }
      // Одиночная буква — инициал/сокращение.
      if (word.length === 1) {
        i = end - 1;
        continue;
      }
    }

    result.push(line.slice(start, end));
    start = end;
    i = end - 1;
  }

  if (start < line.length) {
    result.push(line.slice(start));
  }

  return result.filter((sentence) => sentence.length > 0);
}

/** Проверить баланс круглых скобок в строке. */
function hasBalancedParentheses(line: string): boolean {
  let depth = 0;
  for (const ch of line) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Запрещена ли продажа актива пользовательской политикой. */
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

/**
 * Заблокирована ли продажа ПО ЯВНОМУ СПИСКУ тикеров (noSellTickers).
 *
 * В отличие от isSellBlockedByPolicy, НЕ проверяет assetType —
 * возвращает true только если тикер явно указан в policy.noSellTickers.
 * Используется для метки «заблокированы политикой no-sell» в карточках:
 * метка ставится только наExplicit-тикеры, а не на все облигации подряд.
 */
export function isSellBlockedByExplicitTicker(
  asset: Pick<AssetAnalysis, 'ticker'>,
  policy?: PolicyLike,
): boolean {
  const ticker = normalizeTicker(asset.ticker);
  const noSellTickers = new Set(
    (policy?.noSellTickers ?? []).map((value) => normalizeTicker(value)),
  );
  return noSellTickers.has(ticker);
}

interface SanitizeOptions {
  /**
   * true — заменять предложение только если в нём упомянут тикер
   * (для общего narrative). false — для per-asset полей, где контекст
   * тикера уже задан снаружи.
   */
  requireTicker?: boolean;
}

function neutralPolicyLine(ticker: string): string {
  return `${normalizeTicker(ticker) || 'Актив'}: держать — продажа/сокращение заблокированы политикой no-sell.`;
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
  let changed = false;

  const replaced = text.split('\n').map((line) => {
    const hasTicker =
      tickerUpper.length > 0 && line.toUpperCase().includes(tickerUpper);
    if (requireTicker && !hasTicker) return line;
    // Pipeline-строка политики не санируется — иначе санатор
    // зацикливается на собственном результате.
    if (isPolicyStatement(line)) return line;
    if (!detectSellDirective(line, 'card')) return line;

    changed = true;
    return neutralPolicyLine(tickerUpper || 'Актив');
  });

  if (!changed) return { text, changed: false };

  return {
    text: replaced
      .join('\n')
      .replace(/[ \t]+([.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
    changed: true,
  };
}

/**
 * Склеить строки с незакрытой скобкой, чтобы не оставлять обрывки
 * вида «5%) слишком высока…» после вырезания sell-фрагмента.
 */
function mergeUnbalancedParenthesisLines(text: string): string {
  const lines = text.split('\n');
  const merged: string[] = [];
  let buffer: string | null = null;
  let depth = 0;

  for (const line of lines) {
    if (buffer === null) {
      buffer = line;
      depth = 0;
    } else {
      buffer = `${buffer} ${line.trim()}`;
    }

    depth +=
      (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);

    if (depth <= 0) {
      merged.push(buffer);
      buffer = null;
      depth = 0;
    }
  }

  if (buffer !== null) merged.push(buffer);
  return merged.join('\n');
}

/** Префикс списка/отступа, который нужно сохранить при замене строки. */
function extractLinePrefix(line: string): string {
  const match = line.match(
    /^(\s*(?:(?:[-–—•*])|(?:\d{1,2}[.)])|(?:[IVX]{1,4}[.)])|(?:→)|(?:#{1,6}))?\s*)/,
  );
  return match?.[1] ?? '';
}

/**
 * Санация per-asset полей карточки (entryStrategy / technicalTiming / rationale).
 * В отличие от sentence-режима, здесь контекст тикера уже задан снаружи,
 * поэтому заменяем ЛЮБОЕ предложение с sell-нарративом.
 */
export function sanitizePolicyCardText(
  text: string | null | undefined,
  ticker: string,
): { text: string | null; changed: boolean } {
  if (!text) return { text: text ?? null, changed: false };

  // Сначала схлопываем повторные строки политики: модель часто дублирует
  // служебный текст, иногда с искажением («политикой поsell»).
  const deduped = dedupePolicyStatements(text, ticker);
  let changed = deduped.removed > 0;
  const source = deduped.text ?? text;

  const replaced = source.split('\n').map((line) => {
    // Строка политики, отрендеренная конвейером, — не AI-контент.
    // Её нельзя ни заменять, ни считать sell-директивой (поправка 1).
    // Нормализуем ПЕРЕД проверкой: «поsell» → «no-sell» → распознаётся как pipeline.
    // Но если оригинальная строка содержит артефакт «поsell» — это не настоящий
    // pipeline-текст, а артефакт модели. Не пропускаем, даём sanitizePolicyCardText
    // заменить на каноническую pipeline-строку.
    const normalized = normalizePolicySpelling(line);
    if (isPolicyStatement(normalized) && !line.includes('поsell')) {
      return line;
    }

    const sentences = splitSentences(line);
    if (!sentences.some((sentence) => detectSellDirective(sentence, 'card'))) {
      return line;
    }

    const prefix = extractLinePrefix(line);
    let lineChanged = false;
    const replacedLine = sentences
      .map((sentence) => {
        if (!detectSellDirective(sentence, 'card')) return sentence;
        lineChanged = true;
        return neutralPolicyLine(ticker);
      })
      .join(' ')
      .replace(/[ \t]+([.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    if (!lineChanged) return line;
    changed = true;

    // Если после замены остались незакрытые скобки — заменяем строку целиком,
    // чтобы не оставлять обрывок в середине предложения.
    if (!hasBalancedParentheses(replacedLine)) {
      return `${prefix}${neutralPolicyLine(ticker)}`;
    }
    return replacedLine;
  });

  if (!changed) return { text, changed: false };
  return { text: replaced.join('\n'), changed: true };
}

/**
 * Нейтрализация buy-директив при HOLD/STABLE (CARD_ACTION_MISMATCH).
 *
 * Если финальное действие карточки — HOLD или STABLE, текст не должен
 * содержать «рекомендуется покупка/докупить/нарастить». Такие директивы
 * заменяются на нейтральную формулировку с ПОДСТАВКОЙ фактического aiVote:
 *   «ТИКЕР: ядро: HOLD, мнение ИИ: SELL — покупка отложена».
 *
 * Ключевое: заменяются ТОЛЬКО предложения с buy-директивами.
 * Остальной текст (P/E, SMA, RSI, фундаментал) сохраняется без изменений.
 */
export function sanitizeBuyDirectivesForAction(
  text: string | null | undefined,
  ticker: string,
  action: string,
  aiVote?: string | null,
  noSellTickers?: string[],
): { text: string | null; changed: boolean } {
  if (!text || !text.length) return { text: text ?? null, changed: false };

  const tickerUpper = (ticker ?? '').trim().toUpperCase();
  // Шаблон «ядро: HOLD» — наследие ранней санации. Он допустим ТОЛЬКО
  // для бумаг из явного no-sell списка (PLZL, RU000A10EC22) и только
  // когда финальное действие действительно HOLD/STABLE.
  const legacyStubPattern = new RegExp(
    `${escapeRegExp(tickerUpper)}\\s*:\\s*ядро\\s*:\\s*HOLD[^.]*\\.?`,
    'gi',
  );

  // Только для HOLD/STABLE — BUY/REDUCE/EXIT не трогаем, но обязан
  // убрать ошибочную заглушку «ядро: HOLD» при BUY.
  if (action !== 'HOLD' && action !== 'STABLE') {
    const cleaned = text
      .replace(legacyStubPattern, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned === text
      ? { text, changed: false }
      : { text: cleaned, changed: true };
  }

  const isExplicitNoSell =
    noSellTickers === undefined ||
    noSellTickers
      .map((value) => (value ?? '').trim().toUpperCase())
      .includes(tickerUpper);
  // Фактический aiVote: если не передан — HOLD (по умолчанию)
  const vote = (aiVote ?? 'HOLD').toUpperCase();
  const neutralTemplate = isExplicitNoSell
    ? `${tickerUpper}: ядро: HOLD, мнение ИИ: ${vote} — покупка отложена.`
    : `${tickerUpper}: покупка отложена — свободного кэша недостаточно.`;

  // Для НЕ-no-sell бумаг заглушка «ядро: HOLD» недопустима даже при HOLD:
  // это шаблон политики no-sell, а не состояние математики.
  let source = text;
  let changed = false;
  if (!isExplicitNoSell && source.match(legacyStubPattern) !== null) {
    source = source.replace(legacyStubPattern, neutralTemplate);
    changed = true;
  }

  const buyPatterns = [
    /рекомендуется\s+покупк[а-яё]/i,
    /рекомендуется\s+докуп[иы]ть/i,
    /рекомендуется\s+нарастить/i,
    /необходимо\s+докуп[иы]ть/i,
    /пора\s+покупать/i,
    /время\s+покупать/i,
    /покупать/i,
    /докупать/i,
    /нарастить/i,
    /накапливать/i,
    /закупать/i,
  ];

  const lines = source.split('\n');
  const replaced: string[] = [];

  for (const line of lines) {
    // Проверяем, есть ли в строке хотя бы одно предложение с buy-директивой
    const sentences = splitSentences(line);
    const hasBuyDirective = sentences.some((s) =>
      buyPatterns.some((p) => p.test(s)),
    );

    if (!hasBuyDirective) {
      // Нет buy-директив — строку не трогаем (сохраняем P/E, SMA, RSI и т.д.)
      replaced.push(line);
      continue;
    }

    // Есть buy-директива — заменяем только предложения с ней, сохраняем аналитику
    changed = true;
    const replacedLine = sentences
      .map((sentence) => {
        if (!buyPatterns.some((p) => p.test(sentence))) {
          // Не buy-предложение — сохраняем
          return sentence;
        }
        // Buy-предложение — заменяем на нейтральную формулировку
        return neutralTemplate;
      })
      .join(' ')
      .replace(/[ \t]+([.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    replaced.push(replacedLine);
  }

  if (!changed) return { text, changed: false };
  return {
    text: replaced.join('\n'),
    changed: true,
  };
}

/**
 * Применить политику к структурированной рекомендации.
 * - sell-действие для no-sell тикера → HOLD + policyBlocked;
 * - текстовые sell-директивы вычищаются даже при BUY/HOLD.
 * - для no-sell тикеров удаляются «разрешающие» утверждения
 *   («продажа допустима», «профицит превышает порог»).
 *
 * Ключевой порядок: pipeline-префикс добавляется ДО санации/дедюпа,
 * чтобы provenance=pipeline строка была защищена от удаления модельных дублей.
 *
 * Метка «заблокированы no-sell» ставится ТОЛЬКО для тикеров из
 * policy.noSellTickers (явный список). Для asset-type блокировок
 * (например, «все облигации») — нейтральная формулировка «держать».
 */
export function applyPolicyToRecommendation(
  rec: StructuredAIAssetRecommendation,
  asset: AssetAnalysis,
  policy?: PolicyLike,
): StructuredAIAssetRecommendation {
  // ─── Шаг 1: ВСЕГДА чистим sell-директивы из model-текста ───
  // Раньше санация вызывалась только для no-sell тикеров.
  // Теперь: sell-директивы модели не должны проходить в карточку
  // ни для одного тикера — ни разрешённого, ни запрещённого.
  const rationale = sanitizePolicyCardText(rec.rationale, asset.ticker);
  const entryStrategy = sanitizePolicyCardText(rec.entryStrategy, asset.ticker);
  const technicalTiming = sanitizePolicyCardText(
    rec.technicalTiming,
    asset.ticker,
  );

  const textBlocked =
    rationale.changed || entryStrategy.changed || technicalTiming.changed;

  const blocked = isSellBlockedByPolicy(asset, policy);
  const explicitBlocked = isSellBlockedByExplicitTicker(asset, policy);
  const actionBlocked = blocked && isSellAction(rec.recommendedAction);

  // ─── Шаг 2: Для no-sell тикеров удаляем «разрешающие» утверждения ───
  // Если тикер в noSellTickers, модель не должна писать «продажа допустима»,
  // «профицит превышает порог» и т.п. — это противоречит императиву no-sell.
  const sanitizeAllowing = (text: string | null): string | null => {
    if (!text || !explicitBlocked) return text;
    // Удалить предложения с «допустим», «разрешен/разрешён», «можно продать»
    return text
      .split(/[.!?]+/)
      .map((s) => {
        const trimmed = s.trim();
        if (
          /допустим[а-яё]*/i.test(trimmed) ||
          /разрешен[а-яё]*/i.test(trimmed) ||
          /разрешён[а-яё]*/i.test(trimmed) ||
          /можно\s+продать/i.test(trimmed)
        ) {
          return '';
        }
        return trimmed;
      })
      .filter(Boolean)
      .join('. ')
      .trim();
  };

  if (!actionBlocked && !textBlocked) {
    return {
      ...rec,
      rationale: sanitizeAllowing(rationale.text),
      entryStrategy: entryStrategy.text,
      technicalTiming: technicalTiming.text,
      policyBlocked: false,
    };
  }

  // Метка «заблокированы no-sell» — только для явного списка тикеров.
  // Для asset-type блокировок (все облигации) — нейтральная формулировка.
  const explicitPolicyNote = explicitBlocked
    ? 'Продажа/сокращение заблокированы политикой no-sell'
    : null;

  // Pipeline-префикс добавляется ДО финального dedupe, чтобы строка
  // с provenance=pipeline была защищена от удаления модельных дублей.
  // Раньше dedupe охранял «первое встреченное» — модельная строка
  // выигрывала, а pipeline-префикс удалялся как дубль.
  const rationaleCandidate = actionBlocked
    ? isPolicyStatement(rationale.text ?? '')
      ? rationale.text
      : `⛔ Заблокировано политикой no-sell: ${rec.recommendedAction}. ${
          sanitizeAllowing(rationale.text) ?? ''
        }`.trim()
    : sanitizeAllowing(rationale.text);

  // Source-based trust: pipeline-строка защищена, модельные дубли удаляются.
  const dedupedRationale = dedupePolicyStatementsWithProvenance(
    buildPolicyStatements(rationaleCandidate, asset.ticker),
    asset.ticker,
  );

  // policyBlocked — true когда продажа заблокирована ПО ЛЮБОМУ правилу
  // (явный тикер ИЛИ asset-type). policyNote — только для явного списка.
  // Для разрешённых тикеров (SBER) текст санируется, но policyBlocked=false.
  // Для no-sell тикеров: policyTextBlocked=true когда текст был изменён,
  // даже если action не заблокирован (BUY по no-sell).
  return {
    ...rec,
    recommendedAction: actionBlocked ? 'HOLD' : rec.recommendedAction,
    rationale: dedupedRationale.text,
    entryStrategy: actionBlocked
      ? 'Держать. Продажа/сокращение заблокированы политикой no-sell.'
      : entryStrategy.text,
    technicalTiming: actionBlocked
      ? 'Держать. Продажа/сокращение заблокированы политикой no-sell.'
      : technicalTiming.text,
    policyBlocked: actionBlocked || rec.policyBlocked === true,
    policyTextBlocked:
      (blocked && textBlocked) || rec.policyTextBlocked === true,
    policyNote: explicitPolicyNote
      ? actionBlocked
        ? explicitPolicyNote
        : rec.policyNote
      : (rec.policyNote ?? null),
  };
}

/**
 * Разобрать текст на предложения с автоматической маркировкой provenance.
 *
 * Строки, распознаваемые как pipeline-текст (POLICY_STATEMENT_PATTERNS),
 * получают provenance='pipeline'. Остальные — 'model'.
 */
function buildPolicyStatements(
  text: string | null | undefined,
  _ticker: string,
): PolicyStatementWithProvenance[] {
  if (!text) return [];

  const sentences = splitSentences(text);
  return sentences.map((sentence) => ({
    text: sentence.trim(),
    provenance: isPolicyStatement(sentence) ? 'pipeline' : 'model',
  }));
}

/** Опции line-context режима для свободного текста. */
export interface NarrativePolicyOptions {
  /**
   * Тикер по умолчанию для строк с sell-директивой без упоминания актива.
   * Если не задан, а в портфеле ровно один no-sell тикер — берётся он.
   */
  defaultTicker?: string;
}

/**
 * Применить политику к свободному AI-тексту (резюме / план / мониторинг).
 *
 * Работает в line-context режиме: если в строке есть no-sell актив (по тикеру
 * ИЛИ по имени), он становится активным контекстом, и последующие строки без
 * упоминания актива (например, «→ рекомендуется сократить на ...») тоже
 * санируются.
 *
 * Замена выполняется по строке/предложению целиком с сохранением префикса
 * списка; тикер в замене берётся из ОРИГИНАЛЬНОЙ строки.
 */
export function applyPolicyToNarrative(
  text: string,
  assets: AssetAnalysis[],
  policy?: PolicyLike,
  options: NarrativePolicyOptions = {},
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

  // Тикер по умолчанию: явно переданный, иначе единственный no-sell тикер.
  // Это позволяет санировать строки стратега без тикера в тексте
  // («Необходимо продать часть позиции…»), не угадывая актив.
  const defaultTicker = normalizeTicker(
    options.defaultTicker ??
      (blockedTickers.size === 1 ? [...blockedTickers][0] : ''),
  );
  let activeTicker: string | null = defaultTicker || null;
  const changedTickers = new Set<string>();
  const changedRules = new Set<string>();
  const lines = normalizedText.split('\n');

  const replaced = lines.map((line) => {
    const blockedAsset = findAssetInText(line, assets);
    const blockedHere =
      blockedAsset && blockedTickers.has(normalizeTicker(blockedAsset.ticker))
        ? normalizeTicker(blockedAsset.ticker)
        : null;
    const anyAsset = blockedAsset;

    if (blockedHere) {
      activeTicker = blockedHere;
    } else if (anyAsset) {
      // Строка про другой актив — контекст no-sell тикера больше не действует.
      activeTicker = null;
    }

    const contextTicker = blockedHere ?? activeTicker;
    // Явная проверка артефакта «поsell» ДО всех проверок контекста.
    // normalizePolicySpelling нормализует «поsell» → «no-sell»,
    // поэтому isPolicyStatement распознаёт как pipeline и пропускает.
    // Контекст тикера не важен: «поsell» — артефакт модели, чистим везде.
    if (
      line.includes('поsell') ||
      line.includes('посell') ||
      line.includes('по-sell')
    ) {
      const fixed = line
        .replace(/поsell/gi, 'no-sell')
        .replace(/посell/gi, 'no-sell')
        .replace(/по-sell/gi, 'no-sell');
      // Добавляем тикер в changedTickers, иначе changedTickers.size === 0
      // и функция возвращает исходный text (строка 924) вместо replaced.
      if (contextTicker) changedTickers.add(contextTicker);
      return fixed;
    }

    if (!contextTicker) return line;
    // Pipeline-строка политики не является AI-директивой (поправка 1).
    if (isPolicyStatement(line)) return line;

    // Одна строка может содержать фразы про разные активы. Заменяем только
    // те предложения, которые относятся к no-sell активу.

    const sentences = splitSentences(line);
    let lineChanged = false;
    const replacedSentences = sentences.map((sentence) => {
      const sentenceAsset = findAssetInText(sentence, assets);
      const sentenceTicker = sentenceAsset
        ? normalizeTicker(sentenceAsset.ticker)
        : null;
      const blockedInSentence =
        sentenceTicker && blockedTickers.has(sentenceTicker)
          ? sentenceTicker
          : null;
      const hasNonBlockedTicker =
        sentenceTicker !== null && !blockedTickers.has(sentenceTicker);

      if (hasNonBlockedTicker) return sentence;

      const rule = detectSellDirective(sentence, 'narrative');
      if (!rule) return sentence;

      const tickerForReplacement =
        blockedInSentence ?? blockedHere ?? contextTicker;
      changedTickers.add(tickerForReplacement);
      changedRules.add(`${tickerForReplacement}:${rule}`);
      lineChanged = true;
      // Что поймано и чем: промпт-слой не удержал → сработал санатор.
      console.log(
        `[POLICY_TEXT] layer=sanator mode=narrative ticker=${tickerForReplacement} ` +
          `rule=${rule} matched="${sentence.trim().slice(0, 80)}"`,
      );
      return neutralPolicyLine(tickerForReplacement);
    });

    if (!lineChanged) return line;

    const prefix = extractLinePrefix(line);
    const result = replacedSentences
      .join(' ')
      .replace(/[ \t]+([.!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    // Незакрытая скобка после замены → отдаём одну нейтральную строку
    // с сохранением префикса, а не обрывок в середине предложения.
    if (!hasBalancedParentheses(result)) {
      return `${prefix}${neutralPolicyLine(
        blockedHere ?? contextTicker,
      )}`.trim();
    }

    return result;
  });

  if (changedTickers.size === 0) return text;

  console.log(
    `[POLICY_TEXT] layer=sanator mode=narrative tickers=${[
      ...changedTickers,
    ].join(',')} rules=${[...changedRules].join('|')} narrative=replaced`,
  );
  return replaced.join('\n');
}
