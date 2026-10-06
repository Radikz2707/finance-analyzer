/**
 * VectorStore — векторное хранилище для RAG системы.
 *
 * Использует TF-IDF подход для поиска похожих документов.
 * Работает полностью в браузере без внешних зависимостей.
 * 
 * Возможности:
 * - Индексация документов с TF-IDF векторизацией
 * - Поиск по cosine similarity
 * - Сохранение/загрузка из localStorage
 * - Поддержка метаданных
 */

/** Документ с вектором и метаданными */
export interface DocumentVector {
  /** Уникальный ID документа */
  id: string;
  /** Текст документа */
  text: string;
  /** Заголовок */
  title: string;
  /** Тип документа */
  type: 'strategy' | 'trade' | 'report' | 'news' | 'note' | 'other';
  /** Метаданные */
  metadata: Record<string, unknown>;
  /** TF-IDF вектор */
  vector: number[];
  /** Термины документа */
  terms: string[];
  /** Дата добавления */
  createdAt: string;
  /** Дата последнего обновления */
  updatedAt: string;
}

/** Результат поиска */
export interface SearchDocument {
  /** ID документа */
  id: string;
  /** Текст документа */
  text: string;
  /** Заголовок */
  title: string;
  /** Тип документа */
  type: string;
  /** Метаданные */
  metadata: Record<string, unknown>;
  /** Рейтинг схожести (0-1) */
  score: number;
  /** Количество совпавших терминов */
  termMatches: number;
}

/** Конфигурация хранилища */
export interface VectorStoreConfig {
  /** Максимальное количество документов */
  maxDocuments?: number;
  /** Топ-N результатов поиска */
  topK?: number;
  /** Минимальный порог схожести для возврата */
  minSimilarity?: number;
  /** Язык токенизации */
  language?: 'ru' | 'en' | 'mixed';
}

/** Дефолтная конфигурация */
const DEFAULT_CONFIG: VectorStoreConfig = {
  maxDocuments: 5000,
  topK: 10,
  minSimilarity: 0.1,
  language: 'mixed',
};

/** Стоп-слова для русского и английского */
const STOP_WORDS = new Set([
  // Русские
  'и', 'в', 'не', 'на', 'я', 'с', 'он', 'а', 'по', 'это', 'она', 'они',
  'к', 'у', 'но', 'мы', 'же', 'бы', 'от', 'для', 'как', 'что', 'за',
  'из', 'или', 'его', 'к', 'под', 'про', 'все', 'так', 'тот', 'эта',
  'эти', 'этот', 'эта', 'эту', 'этом', 'этим', 'этого', 'этой', 'этого',
  'мои', 'твои', 'наш', 'ваш', 'их', 'мой', 'твой', 'свой', 'себя',
  'себе', 'меня', 'тебя', 'нас', 'вас', 'них', 'мне', 'тебе', 'нам',
  'вам', 'них', 'мной', 'тобой', 'нами', 'вами', 'ними', 'тут', 'там',
  'тут', 'там', 'вот', 'здесь', 'там', 'там', 'где', 'куда', 'откуда',
  'когда', 'потом', 'потом', 'тогда', 'тоже', 'также', 'лишь', 'бывший',
  'должен', 'может', 'мочь', 'хотеть', 'знать', 'говорить', 'делать',
  // Английские
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because',
]);

/**
 * Токенизация текста — разделение на термины.
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  
  const lower = text.toLowerCase();
  
  // Разбиваем на слова, убираем пунктуацию и цифры
  const words = lower.match(/[а-яёa-z]{3,}/g) || [];
  
  // Убираем стоп-слова
  const filtered = words.filter(word => !STOP_WORDS.has(word));
  
  // Убираем дубликаты
  return [...new Set(filtered)];
}

/**
 * Вычислить TF (Term Frequency) для термина в документе.
 */
function computeTF(term: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const count = terms.filter(t => t === term).length;
  return count / terms.length;
}

/**
 * Вычислить IDF (Inverse Document Frequency) для термина.
 */
function computeIDF(term: string, allTermSets: Set<string>[]): number {
  const docsWithTerm = allTermSets.filter(set => set.has(term)).length;
  if (docsWithTerm === 0) return 0;
  return Math.log(allTermSets.length / docsWithTerm) + 1;
}

/**
 * Вычислить cosine similarity между двумя векторами.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * VectorStore — векторное хранилище для RAG.
 */
export class VectorStore {
  private documents: Map<string, DocumentVector> = new Map();
  private config: VectorStoreConfig;
  private allTermSets: Set<string>[] = [];
  private vocabulary: Map<string, number> = new Map();
  private tfidfMatrix: Map<string, number[]> = new Map();

  constructor(config?: VectorStoreConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadFromStorage();
  }

  /** Добавить документ */
  add(
    id: string,
    text: string,
    title: string,
    type: DocumentVector['type'] = 'other',
    metadata: Record<string, unknown> = {},
  ): DocumentVector {
    const terms = tokenize(text);
    
    // Создаём TF-IDF вектор
    const vector = this.computeTFIDF(terms);
    
    const now = new Date().toISOString();
    const doc: DocumentVector = {
      id,
      text,
      title,
      type,
      metadata,
      vector,
      terms,
      createdAt: now,
      updatedAt: now,
    };
    
    // Проверяем существование
    if (this.documents.has(id)) {
      this.documents.set(id, doc);
      this.rebuildIndex();
    } else {
      this.documents.set(id, doc);
      this.allTermSets.push(new Set(terms));
      this.rebuildVocabulary();
      this.rebuildTfidfMatrix();
    }
    
    // Ограничиваем размер
    if (this.documents.size > this.config.maxDocuments!) {
      this.pruneOldest();
    }
    
    this.saveToStorage();
    return doc;
  }

  /** Удалить документ */
  remove(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;
    
    this.documents.delete(id);
    this.rebuildIndex();
    this.saveToStorage();
    return true;
  }

  /** Получить документ по ID */
  get(id: string): DocumentVector | undefined {
    return this.documents.get(id);
  }

  /** Получить все документы */
  getAll(): DocumentVector[] {
    return Array.from(this.documents.values());
  }

  /** Получить статистику */
  getStats(): {
    totalDocuments: number;
    byType: Record<string, number>;
    totalTerms: number;
    vocabularySize: number;
  } {
    const byType: Record<string, number> = {};
    let totalTerms = 0;
    
    for (const doc of this.documents.values()) {
      byType[doc.type] = (byType[doc.type] || 0) + 1;
      totalTerms += doc.terms.length;
    }
    
    return {
      totalDocuments: this.documents.size,
      byType,
      totalTerms,
      vocabularySize: this.vocabulary.size,
    };
  }

  /**
   * Поиск документов по запросу.
   * Использует TF-IDF + cosine similarity.
   */
  search(query: string, options?: {
    topK?: number;
    minSimilarity?: number;
    type?: DocumentVector['type'];
  }): SearchDocument[] {
    const topK = options?.topK ?? this.config.topK;
    const minSimilarity = options?.minSimilarity ?? this.config.minSimilarity;
    
    const queryTerms = tokenize(query);
    const queryVector = this.computeTFIDF(queryTerms);
    
    const results: SearchDocument[] = [];
    
    for (const doc of this.documents.values()) {
      // Фильтр по типу
      if (options?.type && doc.type !== options.type) continue;
      
      // Вычисляем similarity
      const similarity = cosineSimilarity(queryVector, doc.vector);
      
      if (similarity >= (minSimilarity ?? 0)) {
        // Считаем количество совпавших терминов
        const docTermSet = new Set(doc.terms);
        const termMatches = queryTerms.filter(t => docTermSet.has(t)).length;
        
        results.push({
          id: doc.id,
          text: doc.text,
          title: doc.title,
          type: doc.type,
          metadata: doc.metadata,
          score: similarity,
          termMatches,
        });
      }
    }
    
    // Сортируем по score (убывание)
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, topK);
  }

  /**
   * Поиск по тикеру.
   */
  searchByTicker(ticker: string): SearchDocument[] {
    return this.search(ticker, { topK: 20 });
  }

  /**
   * Поиск по типу документа.
   */
  searchByType(type: DocumentVector['type']): SearchDocument[] {
    const docs = this.getAll().filter(d => d.type === type);
    return docs.map(doc => ({
      id: doc.id,
      text: doc.text,
      title: doc.title,
      type: doc.type,
      metadata: doc.metadata,
      score: 1.0,
      termMatches: doc.terms.length,
    }));
  }

  /**
   * Очистить хранилище.
   */
  clear(): void {
    this.documents.clear();
    this.allTermSets = [];
    this.vocabulary.clear();
    this.tfidfMatrix.clear();
    this.saveToStorage();
  }

  /**
   * Вычислить TF-IDF вектор для набора терминов.
   */
  private computeTFIDF(terms: string[]): number[] {
    const vector: number[] = [];
    
    for (const term of this.vocabulary.keys()) {
      const tf = computeTF(term, terms);
      const idf = computeIDF(term, this.allTermSets);
      vector.push(tf * idf);
    }
    
    return vector;
  }

  /**
   * Перестроить индекс.
   */
  private rebuildIndex(): void {
    this.allTermSets = Array.from(this.documents.values()).map(doc => new Set(doc.terms));
    this.rebuildVocabulary();
    this.rebuildTfidfMatrix();
  }

  /**
   * Перестроить словарь.
   */
  private rebuildVocabulary(): void {
    this.vocabulary.clear();
    let index = 0;
    
    for (const doc of this.documents.values()) {
      for (const term of doc.terms) {
        if (!this.vocabulary.has(term)) {
          this.vocabulary.set(term, index++);
        }
      }
    }
  }

  /**
   * Перестроить TF-IDF матрицу.
   */
  private rebuildTfidfMatrix(): void {
    this.tfidfMatrix.clear();
    
    for (const doc of this.documents.values()) {
      const vector = this.computeTFIDF(doc.terms);
      this.tfidfMatrix.set(doc.id, vector);
      doc.vector = vector;
    }
  }

  /**
   * Удалить старые документы.
   */
  private pruneOldest(): void {
    const sorted = Array.from(this.documents.entries())
      .sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime());
    
    const toRemove = sorted.slice(0, sorted.length - this.config.maxDocuments!);
    
    for (const [id] of toRemove) {
      this.documents.delete(id);
    }
    
    this.rebuildIndex();
  }

  /**
   * Сохранить в localStorage.
   */
  private saveToStorage(): void {
    try {
      const data = {
        documents: Array.from(this.documents.entries()),
        vocabulary: Array.from(this.vocabulary.entries()),
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem('finance_analyzer_vector_store', JSON.stringify(data));
    } catch (error) {
      console.warn('[VectorStore] Ошибка сохранения:', error);
    }
  }

  /**
   * Загрузить из localStorage.
   */
  private loadFromStorage(): void {
    try {
      const data = localStorage.getItem('finance_analyzer_vector_store');
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.documents) {
          this.documents = new Map(parsed.documents);
        }
        if (parsed.vocabulary) {
          this.vocabulary = new Map(parsed.vocabulary);
        }
        this.allTermSets = Array.from(this.documents.values()).map(doc => new Set(doc.terms));
      }
    } catch (error) {
      console.warn('[VectorStore] Ошибка загрузки:', error);
    }
  }
}
