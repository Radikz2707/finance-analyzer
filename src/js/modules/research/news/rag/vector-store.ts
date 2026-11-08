/**
 * VectorStore — простое векторное хранилище для RAG-поиска.
 *
 * Использует TF-IDF-подобный подход для поиска похожих новостей
 * без внешних зависимостей. Работает полностью на CPU.
 *
 * Архитектура:
 * 1. index(text) — токенизация + построение IDF-вектора
 * 2. search(query, limit) — поиск по сходству косинуса
 * 3. persist()/load() — сохранение/загрузка в БД
 */

// ──────────────────────────────────────────────
// 1. Типы
// ──────────────────────────────────────────────

/** Запись в векторном хранилище */
export interface VectorEntry {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

/** Результат поиска */
export interface SearchResult {
  entry: VectorEntry;
  score: number;
}

// ──────────────────────────────────────────────
// 2. Токенизация
// ──────────────────────────────────────────────

/**
 * Токенизация текста: разбивка на слова, lowercase, удаление стоп-слов.
 * Поддерживает кириллицу и латиницу.
 */
const STOP_WORDS = new Set([
  'и', 'в', 'не', 'на', 'с', 'по', 'для', 'из', 'как', 'что', 'это',
  'к', 'у', 'о', 'от', 'до', 'а', 'но', 'или', 'же', 'бы', 'то',
  'он', 'она', 'они', 'мы', 'вы', 'я', 'ты', 'все', 'так', 'ещё',
  'еще', 'уже', 'там', 'здесь', 'тут', 'очень', 'довольно', 'слишком',
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
  'in', 'of', 'to', 'for', 'by', 'with', 'as', 'was', 'are', 'this',
  'that', 'it', 'be', 'he', 'she', 'we', 'they', 'i', 'you', 'my',
]);

function tokenize(text: string): string[] {
  const lower = text.toLowerCase().trim();
  // Разбиваем на слова (буквы, цифры, кириллица)
  const words = lower.match(/[а-яa-z0-9]+/g) ?? [];
  // Убираем стоп-слова и короткие слова (< 3 символов)
  return words.filter(
    (w) => w.length >= 3 && !STOP_WORDS.has(w),
  );
}

// ──────────────────────────────────────────────
// 3. TF-IDF вычисление
// ──────────────────────────────────────────────

/** Вычислить TF (term frequency) для токенов */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const total = tokens.length || 1;

  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  // Нормализация
  for (const [token, count] of tf) {
    tf.set(token, count / total);
  }

  return tf;
}

/** Вычислить IDF (inverse document frequency) */
function computeIDF(documents: string[][]): Map<string, number> {
  const idf = new Map<string, number>();
  const N = documents.length || 1;

  // Считаем документную частоту каждого термина
  const df = new Map<string, number>();
  for (const docs of documents) {
    const unique = new Set(docs);
    for (const term of unique) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // IDF = log(N / df)
  for (const [term, count] of df) {
    idf.set(term, Math.log(N / count) + 1); // +1 для сглаживания
  }

  return idf;
}

/** Вычислить TF-IDF вектор для документа */
function computeTFIDF(
  tokens: string[],
  idf: Map<string, number>,
): Map<string, number> {
  const tf = computeTF(tokens);
  const tfidf = new Map<string, number>();

  for (const [term, tfValue] of tf) {
    const idfValue = idf.get(term) ?? 0;
    tfidf.set(term, tfValue * idfValue);
  }

  return tfidf;
}

/** Вычислить косинусное сходство между двумя векторами */
function cosineSimilarity(
  vecA: Map<string, number>,
  vecB: Map<string, number>,
): number {
  const allTerms = new Set([...vecA.keys(), ...vecB.keys()]);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const term of allTerms) {
    const a = vecA.get(term) ?? 0;
    const b = vecB.get(term) ?? 0;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ──────────────────────────────────────────────
// 4. VectorStore
// ──────────────────────────────────────────────

/** Опции VectorStore */
export interface VectorStoreOptions {
  /** Максимальное количество результатов поиска */
  maxResults?: number;
  /** Максимальное количество документов в индексе */
  maxEntries?: number;
}

export class VectorStore {
  private entries: VectorEntry[] = [];
  private documents: string[][] = []; // токенизированные документы
  private idf: Map<string, number> = new Map();
  private readonly maxResults: number;
  private readonly maxEntries: number;

  constructor(options: VectorStoreOptions = {}) {
    this.maxResults = options.maxResults ?? 10;
    this.maxEntries = options.maxEntries ?? 10000;
  }

  /** Добавить документ в индекс */
  add(entry: VectorEntry): void {
    this.entries.push(entry);
    this.documents.push(tokenize(entry.text));
    // Перестраиваем IDF
    this.idf = computeIDF(this.documents);
    // Автоочистка старых документов
    if (this.entries.length > this.maxEntries) {
      this.trimOldEntries();
    }
  }

  /** Удалить старые записи, оставляя только новые */
  private trimOldEntries(): void {
    const removed = this.entries.splice(0, this.entries.length - this.maxEntries);
    this.documents.splice(0, removed.length);
    this.idf = computeIDF(this.documents);
  }

  /** Удалить документ по ID */
  remove(id: string): void {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx >= 0) {
      this.entries.splice(idx, 1);
      this.documents.splice(idx, 1);
      this.idf = computeIDF(this.documents);
    }
  }

  /** Получить все документы */
  getAll(): VectorEntry[] {
    return [...this.entries];
  }

  /** Получить количество документов */
  count(): number {
    return this.entries.length;
  }

  /**
   * Поиск по запросу с использованием TF-IDF и косинусного сходства.
   */
  search(query: string, limit?: number): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const queryTFIDF = computeTFIDF(queryTokens, this.idf);
    const results: SearchResult[] = [];
    const minSim = 0.15; // Минимальный порог сходства

    for (let i = 0; i < this.entries.length; i++) {
      const doc = this.entries[i];
      if (!doc) continue;
      const docTokens = this.documents[i];
      if (!docTokens) continue;
      const docTFIDF = computeTFIDF(docTokens, this.idf);
      const score = cosineSimilarity(queryTFIDF, docTFIDF);

      if (score >= minSim) {
        results.push({
          entry: doc,
          score,
        });
      }
    }

    // Сортировка по убыванию сходства
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit ?? this.maxResults);
  }

  /**
   * Получить последние N документов (для индикатора "обучено на данные от ...")
   */
  getLatest(count: number): VectorEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Очистить индекс.
   */
  clear(): void {
    this.entries = [];
    this.documents = [];
    this.idf = new Map();
  }
}
