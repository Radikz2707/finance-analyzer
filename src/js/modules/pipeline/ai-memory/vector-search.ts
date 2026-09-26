/**
 * Vector Search — векторный поиск по текстовым записям памяти.
 *
 * Реализует простой TF-IDF (Term Frequency - Inverse Document Frequency)
 * векторизатор с cosine similarity для семантического поиска
 * без внешних зависимостей (чистый TypeScript).
 *
 * Алгоритм поиска:
 * 1. Токенизация текста — разбиение на слова, удаление стоп-слов, приведение к нижнему регистру
 * 2. Подсчёт TF (Term Frequency) — частота каждого термина в документе
 * 3. Подсчёт IDF (Inverse Document Frequency) — обратная частота термина во всей коллекции
 * 4. Вычисление TF-IDF вектора — взвешенные частоты терминов
 * 5. Cosine similarity — вычисление косинусного сходства между векторами запроса и записей
 * 6. Сортировка результатов по убыванию сходства
 *
 * Ограничения:
 * - Не является настоящим семантическим поиском (не понимает синонимы)
 * - Работает на уровне лексического сходства (совпадение терминов)
 * - Подходит для быстрого поиска по ключевым словам в контексте
 *
 * @module vector-search
 */

import { operationalMemory, strategicMemory } from './core.js';

// ──────────────────────────────────────────────
// 1. Стоп-слова (русский + английский)
// ──────────────────────────────────────────────

const STOP_WORDS = new Set([
  // Русский
  'и', 'в', 'не', 'на', 'я', '是', '这', '吗', '了', '有', '和', '就',
  '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要',
  '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那',
  '里', '吗', '吧', '被', '从', '与', '还', '得', '对', '为', '以',
  '可', '之', '等', '能', '但', '后', '前', '中', '行', '出', '新',
  '所', '时', '大', '由', '或', '什么', '怎么', '为什么',
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'shall', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but',
  'and', 'or', 'if', 'while', 'about', 'up', 'out', 'on', 'in',
]);

// ──────────────────────────────────────────────
// 2. Токенизация
// ──────────────────────────────────────────────

/**
 * Разбивает текст на токены (слова) с очисткой.
 *
 * Обрабатывает:
 * - Приведение к нижнему регистру
 * - Удаление пунктуации (с сохранением кириллицы и букв)
 * - Удаление стоп-слов (русские и английские)
 * - Фильтрация однобуквенных токенов
 *
 * @param text — входной текст для токенизации
 * @returns массив токенов (слов) для векторизации
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  return text
    .toLowerCase()
    .replace(/[^\w\s\u0400-\u04FF]/g, ' ') // удаляем пунктуацию, оставляем кириллицу
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

// ──────────────────────────────────────────────
// 3. TF-IDF векторизация
// ──────────────────────────────────────────────

/** Словарь: термин -> уникальный ID */
const termToId: Map<string, number> = new Map();
let nextId = 0;

/** Получить ID термина (создать если нет) */
function getTermId(term: string): number {
  let id = termToId.get(term);
  if (id === undefined) {
    id = nextId++;
    termToId.set(term, id);
  }
  return id;
}

/**
 * Создаёт TF-IDF вектор для заданного текста.
 *
 * Алгоритм:
 * 1. Токенизация текста
 * 2. Подсчёт TF (term frequency) — нормализованная частота терминов
 * 3. Вычисление IDF (inverse document frequency) — если предоставлен docFreq
 * 4. Построение вектора с учетом term ID
 * 5. L2-нормализация вектора
 *
 * @param text — входной текст для векторизации
 * @param docFreq — карта частоты встречаемости терминов по документам (опционально, для точного IDF)
 * @returns нормализованный TF-IDF вектор (массив чисел)
 */
export function embedText(
  text: string,
  docFreq?: Map<string, number>,
): number[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];

  // Подсчёт TF (term frequency)
  const tfMap = new Map<string, number>();
  for (const token of tokens) {
    tfMap.set(token, (tfMap.get(token) || 0) + 1);
  }

  // Нормализация TF
  const totalTokens = tokens.length;
  for (const [term, count] of tfMap) {
    tfMap.set(term, count / totalTokens);
  }

  // Построение вектора
  const vector: number[] = [];

  for (const [term, tf] of tfMap) {
    const id = getTermId(term);
    // Расширяем вектор если нужно
    while (vector.length <= id) {
      vector.push(0);
    }

    // IDF (если предоставлен docFreq)
    let idf = 1;
    if (docFreq && docFreq.size > 0) {
      const df = docFreq.get(term) || 1;
      idf = Math.log((docFreq.size + 1) / (df + 1)) + 1;
    }

    vector[id] = tf * idf;
  }

  // Нормализация L2
  const norm = l2Norm(vector);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] = vector[i] / norm;
    }
  }

  return vector;
}

/**
 * Вычислить L2 норму вектора.
 */
function l2Norm(vector: number[]): number {
  let sum = 0;
  for (const v of vector) {
    sum += v * v;
  }
  return Math.sqrt(sum);
}

// ──────────────────────────────────────────────
// 4. Cosine Similarity
// ──────────────────────────────────────────────

/**
 * Вычисляет косинусное сходство между двумя векторами.
 *
 * Формула: cos(θ) = (A · B) / (||A|| × ||B||)
 *
 * Результат интерпретируется так:
 * - 1.0 — векторы идентичны
 * - 0.0 — векторы ортогональны (не похожи)
 * - -1.0 — векторы противоположны (не применяется для TF-IDF)
 *
 * @param vecA — первый вектор (запрос или документ)
 * @param vecB — второй вектор (документ или запрос)
 * @returns сходство в диапазоне [0, 1] для TF-IDF векторов
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length === 0 || vecB.length === 0) return 0;

  // Приводим к одинаковой длине
  const maxLen = Math.max(vecA.length, vecB.length);
  const a = vecA.length < maxLen ? [...vecA, ...Array(maxLen - vecA.length).fill(0)] : vecA;
  const b = vecB.length < maxLen ? [...vecB, ...Array(maxLen - vecB.length).fill(0)] : vecB;

  // Dot product
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (normA * normB);
}

// ──────────────────────────────────────────────
// 5. Поиск по сходству
// ──────────────────────────────────────────────

/** Результат поиска по сходству */
export interface SearchHit {
  /** ID записи */
  id: string;
  /** Тип записи */
  type: string;
  /** Содержание */
  content: string;
  /** Оценка сходства (0-1) */
  similarity: number;
  /** Дата создания */
  createdAt: string;
}

/**
 * Выполняет семантический поиск по записям памяти.
 *
 * Алгоритм:
 * 1. Векторизация поискового запроса через TF-IDF
 * 2. Получение всех записей из оперативной и стратегической памяти
 * 3. Векторизация каждой записи
 * 4. Вычисление cosine similarity между запросом и каждой записью
 * 5. Фильтрация по минимальному порогу сходства
 * 6. Сортировка по убыванию сходства, обрезка до limit
 *
 * @param query — поисковый запрос (текст для поиска)
 * @param limit — максимальное количество результатов (по умолчанию 10)
 * @param minSimilarity — минимальное сходство для включения в результат (по умолчанию 0.1)
 * @returns массив найденных записей, отсортированный по сходству (убывание)
 */
export function searchBySimilarity(
  query: string,
  limit: number = 10,
  minSimilarity: number = 0.1,
): SearchHit[] {
  const queryVector = embedText(query);
  if (queryVector.length === 0) return [];

  // Собираем все записи
  const allEntries: Array<{
    id: string;
    type: string;
    content: string;
    createdAt: string;
  }> = [];

  // Оперативная память
  const operational = operationalMemory.getRecent(500);
  for (const entry of operational) {
    allEntries.push({
      id: entry.id,
      type: `operational:${entry.type}`,
      content: entry.content,
      createdAt: entry.createdAt,
    });
  }

  // Стратегическая память
  const strategic = strategicMemory.getAll(200);
  for (const entry of strategic) {
    const content = [
      entry.compressedData,
      entry.raw ? JSON.stringify(entry.raw) : '',
      entry.trend ? JSON.stringify(entry.trend) : '',
      entry.anomalies ? JSON.stringify(entry.anomalies) : '',
    ].join(' ');

    allEntries.push({
      id: entry.id,
      type: `strategic:${entry.type}`,
      content,
      createdAt: entry.date,
    });
  }

  // Вычисляем сходство для каждой записи
  const hits: SearchHit[] = [];
  for (const entry of allEntries) {
    const entryVector = embedText(entry.content);
    const sim = cosineSimilarity(queryVector, entryVector);

    if (sim >= minSimilarity) {
      hits.push({
        id: entry.id,
        type: entry.type,
        content: entry.content,
        similarity: Math.round(sim * 1000) / 1000,
        createdAt: entry.createdAt,
      });
    }
  }

  // Сортируем по сходству (убывание)
  hits.sort((a, b) => b.similarity - a.similarity);

  return hits.slice(0, limit);
}

// ──────────────────────────────────────────────
// 6. Индексация для ускорения поиска
// ──────────────────────────────────────────────

/** Кэш векторов для ускорения повторных запросов */
const vectorCache = new Map<string, number[]>();

/**
 * Очищает кэш векторов и словарь терминов.
 *
 * Сбрасывает:
 * - Кэш векторов (vectorCache) — для освобождения памяти
 * - Словарь терминов (termToId) — для перестроения векторного пространства
 * - Счётчик ID (nextId) — для сброса нумерации
 *
 * Вызывается при необходимости сброса состояния (например, в тестах).
 */
export function clearVectorCache(): void {
  vectorCache.clear();
  termToId.clear();
  nextId = 0;
}

// ──────────────────────────────────────────────
// 7. Экспорт
// ──────────────────────────────────────────────

// Функции tokenize, l2Norm, getTermId экспортированы выше по отдельности
