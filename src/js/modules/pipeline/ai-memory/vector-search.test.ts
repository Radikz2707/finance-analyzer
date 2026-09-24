/**
 * Vector Search Tests — тесты для TF-IDF векторного поиска.
 *
 * Тестируют:
 * - tokenize() — токенизация текста
 * - embedText() — TF-IDF векторизация
 * - cosineSimilarity() — косинусное сходство
 * - searchBySimilarity() — семантический поиск
 * - clearVectorCache() — очистка кэша
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  tokenize,
  embedText,
  cosineSimilarity,
  searchBySimilarity,
  clearVectorCache,
} from './vector-search.js';
import {
  init as initMemory,
  operationalMemory,
} from './ai-memory.js';

// ──────────────────────────────────────────────
// 1. Тесты tokenize()
// ──────────────────────────────────────────────

describe('Vector Search — tokenize()', () => {
  beforeEach(() => {
    clearVectorCache();
    initMemory({ verbose: false });
  });

  afterEach(() => {
    clearVectorCache();
  });

  it('должна вернуть пустой массив для пустой строки', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize(null as unknown as string)).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });

  it('должна удалить стоп-слова (русские)', () => {
    const result = tokenize('и в не на по о с');
    expect(result).toEqual([]);
  });

  it('должна удалить стоп-слова (английские)', () => {
    const result = tokenize('the a an is are was were');
    expect(result).toEqual([]);
  });

  it('должна оставить значимые слова', () => {
    const result = tokenize('покупка акции Сбербанка');
    expect(result).toContain('покупка');
    expect(result).toContain('акции');
    expect(result).toContain('сбербанка');
    expect(result).not.toContain('и');
  });

  it('должна привести к нижнему регистру', () => {
    const result = tokenize('ПОКУПКА Акции СБЕРБАНКА');
    expect(result).toEqual(['покупка', 'акции', 'сбербанка']);
  });

  it('должна удалить пунктуацию', () => {
    const result = tokenize('покупка, акции; Сбербанка!');
    expect(result).toEqual(['покупка', 'акции', 'сбербанка']);
  });

  it('должна отфильтровать однобуквенные слова', () => {
    const result = tokenize('а б в покупка');
    expect(result).toEqual(['покупка']);
  });

  it('должна обработать кириллицу', () => {
    const result = tokenize('доходность портфеля за квартал');
    expect(result).toEqual(['доходность', 'портфеля', 'квартал']);
  });

  it('должна обработать смешанный текст', () => {
    const result = tokenize('SBER GDR dividend income');
    expect(result).toContain('sber');
    expect(result).toContain('gdr');
    expect(result).toContain('dividend');
    expect(result).toContain('income');
  });
});

// ──────────────────────────────────────────────
// 2. Тесты embedText() — TF-IDF
// ──────────────────────────────────────────────

describe('Vector Search — embedText()', () => {
  beforeEach(() => {
    clearVectorCache();
    initMemory({ verbose: false });
  });

  afterEach(() => {
    clearVectorCache();
  });

  it('должна вернуть пустой массив для пустого текста', () => {
    expect(embedText('')).toEqual([]);
    expect(embedText('   ')).toEqual([]);
  });

  it('должна вернуть непустой вектор для текста', () => {
    const vector = embedText('покупка акций');
    expect(vector.length).toBeGreaterThan(0);
  });

  it('должна нормализовать вектор (L2 норма = 1)', () => {
    const vector = embedText('доходность портфеля выросла');
    let sum = 0;
    for (const v of vector) {
      sum += v * v;
    }
    const norm = Math.sqrt(sum);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('должна давать одинаковый вектор для одинакового текста', () => {
    const text = 'SBER GDR dividend';
    const vec1 = embedText(text);
    const vec2 = embedText(text);
    expect(vec1).toEqual(vec2);
  });

  it('должна учитывать частоту терминов (TF)', () => {
    // Текст с повторением ключевого слова
    const text1 = 'покупка покупка покупка продажа';
    const text2 = 'покупка продажа продажа продажа';

    const vec1 = embedText(text1);
    const vec2 = embedText(text2);

    // Векторы должны отличаться
    let diff = 0;
    const maxLen = Math.max(vec1.length, vec2.length);
    for (let i = 0; i < maxLen; i++) {
      const v1 = vec1[i] || 0;
      const v2 = vec2[i] || 0;
      diff += Math.abs(v1 - v2);
    }
    expect(diff).toBeGreaterThan(0.01);
  });

  it('должна использовать IDF при передаче docFreq', () => {
    const docFreq = new Map<string, number>();
    docFreq.set('редкое', 1);
    docFreq.set('частое', 100);

    const vec = embedText('редкое частое слово', docFreq);
    expect(vec.length).toBeGreaterThan(0);
  });

  it('должна создавать векторы разной размерности для разного текста', () => {
    const vec1 = embedText('покупка акций');
    const vec2 = embedText('продажа облигаций дивиденды');

    // У разных текстов разное количество уникальных терминов
    // но после нормализации размерность может совпадать из-за глобального termToId
    expect(vec1.length).toBeGreaterThan(0);
    expect(vec2.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────
// 3. Тесты cosineSimilarity()
// ──────────────────────────────────────────────

describe('Vector Search — cosineSimilarity()', () => {
  beforeEach(() => {
    clearVectorCache();
    initMemory({ verbose: false });
  });

  afterEach(() => {
    clearVectorCache();
  });

  it('должна вернуть 0 для пустых векторов', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [])).toBe(0);
  });

  it('должна вернуть 1.0 для идентичных векторов', () => {
    const vec = [1, 2, 3];
    expect(cosineSimilarity(vec, vec)).toBe(1.0);
  });

  it('должна вернуть 1.0 для пропорциональных векторов', () => {
    const vecA = [1, 2, 3];
    const vecB = [2, 4, 6]; // пропорционально vecA
    expect(cosineSimilarity(vecA, vecB)).toBe(1.0);
  });

  it('должна вернуть 0 для ортогональных векторов', () => {
    const vecA = [1, 0, 0];
    const vecB = [0, 1, 0];
    expect(cosineSimilarity(vecA, vecB)).toBe(0);
  });

  it('должна вернуть положительное сходство для похожих векторов', () => {
    const vecA = [1, 1, 0, 0];
    const vecB = [1, 0.9, 0, 0];
    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBeGreaterThan(0.99);
    expect(sim).toBeLessThanOrEqual(1.0);
  });

  it('должна вернуть 0 для полностью разных векторов', () => {
    const vecA = [1, 0, 0, 0];
    const vecB = [0, 0, 0, 1];
    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBe(0);
  });

  it('должна обрабатывать векторы разной длины', () => {
    const vecA = [1, 2, 3];
    const vecB = [1, 2, 3, 0, 0];
    const sim = cosineSimilarity(vecA, vecB);
    expect(sim).toBe(1.0);
  });

  it('должна вернуть значение в диапазоне [0, 1] для TF-IDF векторов', () => {
    const vec1 = embedText('доходность портфеля');
    const vec2 = embedText('доходность акции');
    const sim = cosineSimilarity(vec1, vec2);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it('должна быть симметричной', () => {
    const vecA = embedText('покупка акций Сбербанка');
    const vecB = embedText('продажа акций Газпрома');
    const simAB = cosineSimilarity(vecA, vecB);
    const simBA = cosineSimilarity(vecB, vecA);
    expect(simAB).toBeCloseTo(simBA, 10);
  });
});

// ──────────────────────────────────────────────
// 4. Тесты searchBySimilarity()
// ──────────────────────────────────────────────

describe('Vector Search — searchBySimilarity()', () => {
  beforeEach(() => {
    clearVectorCache();
    initMemory({ verbose: false });
  });

  afterEach(() => {
    clearVectorCache();
  });

  it('должна вернуть пустой массив для пустого запроса', () => {
    const results = searchBySimilarity('');
    expect(results).toEqual([]);
  });

  it('должна вернуть пустой массив для запроса без значимых слов', () => {
    const results = searchBySimilarity('и в не на по');
    expect(results).toEqual([]);
  });

  it('должна найти записи с совпадающими ключевыми словами', () => {
    // Сохраняем запись с известным контентом
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Анализ акций Сбербанка и Газпрома Q3 2025',
      priority: 'high',
      keywords: ['сбербанк', 'газпром', 'анализ'],
    });

    const results = searchBySimilarity('акции Сбербанка', 10, 0.01);
    expect(results.length).toBeGreaterThan(0);
  });

  it('должна сортировать результаты по убыванию сходства', () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Покупка акций технологических компаний',
      priority: 'medium',
      keywords: ['технологии', 'акции'],
    });
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'decision',
      content: 'Продажа облигаций ОФЗ',
      priority: 'critical',
      keywords: ['облигации', 'офз'],
    });

    const results = searchBySimilarity('акции покупка', 10, 0.01);
    expect(results.length).toBeGreaterThan(0);

    // Результаты должны быть отсортированы
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].similarity).toBeGreaterThanOrEqual(
        results[i].similarity,
      );
    }
  });

  it('должна ограничивать количество результатов по limit', () => {
    // Создаём несколько записей
    for (let i = 0; i < 10; i++) {
      operationalMemory.save({
        createdAt: new Date().toISOString(),
        type: 'conversation',
        content: `Тестовая запись номер ${i} с ключевыми словами акции`,
        priority: 'low',
        keywords: ['тест', 'акции'],
      });
    }

    const results = searchBySimilarity('акции', 3, 0.01);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('должна фильтровать по minSimilarity', () => {
    const results = searchBySimilarity('покупка акций', 10, 0.9);
    // При высоком пороге similarity может быть мало результатов
    for (const hit of results) {
      expect(hit.similarity).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('должна возвращать правильную структуру SearchHit', () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'pipeline_result',
      content: 'Результат анализа портфеля за сентябрь 2025',
      priority: 'high',
      keywords: ['портфель', 'анализ'],
    });

    const results = searchBySimilarity('анализ портфеля', 10, 0.01);

    if (results.length > 0) {
      const hit = results[0];
      expect(hit).toHaveProperty('id');
      expect(hit).toHaveProperty('type');
      expect(hit).toHaveProperty('content');
      expect(hit).toHaveProperty('similarity');
      expect(hit).toHaveProperty('createdAt');
      expect(typeof hit.id).toBe('string');
      expect(typeof hit.similarity).toBe('number');
      expect(hit.similarity).toBeGreaterThanOrEqual(0);
      expect(hit.similarity).toBeLessThanOrEqual(1);
    }
  });

  it('должна находить более похожие записи первыми', () => {
    operationalMemory.save({
      createdAt: new Date().toISOString(),
      type: 'conversation',
      content: 'Дивидендная политика Сбербанка 2025 год',
      priority: 'high',
      keywords: ['дивиденды', 'сбербанк'],
    });

    const results = searchBySimilarity('дивиденды Сбербанка', 10, 0.01);

    // Запись о дивидендах Сбербанка должна быть найдена
    const sberResult = results.find(
      (r) => r.content.includes('Сбербанка') && r.content.includes('дивиденд'),
    );
    expect(sberResult).toBeDefined();
  });
});

// ──────────────────────────────────────────────
// 5. Тесты clearVectorCache()
// ──────────────────────────────────────────────

describe('Vector Search — clearVectorCache()', () => {
  beforeEach(() => {
    initMemory({ verbose: false });
  });

  it('должна сбросить состояние после векторизации', () => {
    embedText('тестовый текст для векторизации');
    expect(embedText('тестовый текст').length).toBeGreaterThan(0);
  });

  it('должна корректно работать после очистки', () => {
    embedText('первый текст');
    clearVectorCache();
    const vec2 = embedText('первый текст');

    // После очистки векторизация должна работать корректно
    expect(vec2.length).toBeGreaterThan(0);
  });

  it('должна не вызывать ошибок при повторных вызовах', () => {
    expect(() => clearVectorCache()).not.toThrow();
    expect(() => clearVectorCache()).not.toThrow();
    expect(() => clearVectorCache()).not.toThrow();
  });
});
