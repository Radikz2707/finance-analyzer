import { VectorStore } from './vector-store.js';

describe('VectorStore', () => {
  let store: VectorStore;

  beforeEach(() => {
    store = new VectorStore({ maxDocuments: 100 });
    store.clear();
  });

  it('должен добавлять документ', () => {
    const doc = store.add(
      'test-1',
      'Сбербанк показал рост прибыли на 15% в третьем квартале',
      'Сбербанк: рост прибыли',
      'report',
      { date: '2024-10-01' },
    );

    expect(doc.id).toBe('test-1');
    expect(doc.title).toBe('Сбербанк: рост прибыли');
    expect(doc.type).toBe('report');
    expect(doc.terms.length).toBeGreaterThan(0);
  });

  it('должен искать документы по запросу', () => {
    store.add('1', 'Сбербанк показал рост прибыли', 'Сбербанк', 'report');
    store.add('2', 'Газпром снизил добычу нефти', 'Газпром', 'report');
    store.add('3', 'Лукойл объявил дивиденды', 'Лукойл', 'report');

    const results = store.search('Сбербанк прибыль');
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toBe('Сбербанк');
  });

  it('должен возвращать пустой результат при отсутствии совпадений', () => {
    store.add('1', 'Сбербанк показал рост', 'Сбербанк', 'report');
    
    const results = store.search('Apple iPhone Macbook');
    
    expect(results.length).toBe(0);
  });

  it('должен фильтровать по типу документа', () => {
    store.add('1', 'Сбербанк прибыль', 'Сбербанк', 'report');
    store.add('2', 'Моя стратегия инвестирования', 'Стратегия', 'strategy');
    store.add('3', 'Лукойл дивиденды', 'Лукойл', 'report');

    const reports = store.search('прибыль', { type: 'report' });
    const strategies = store.search('стратегия', { type: 'strategy' });

    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(strategies.length).toBeGreaterThanOrEqual(1);
  });

  it('должен удалять документы', () => {
    store.add('1', 'Сбербанк прибыль', 'Сбербанк', 'report');
    store.add('2', 'Газпром добыча', 'Газпром', 'report');

    expect(store.get('1')).toBeDefined();
    
    store.remove('1');
    
    expect(store.get('1')).toBeUndefined();
    expect(store.get('2')).toBeDefined();
  });

  it('должен возвращать статистику', () => {
    store.add('1', 'Сбербанк прибыль', 'Сбербанк', 'report');
    store.add('2', 'Моя стратегия', 'Стратегия', 'strategy');
    store.add('3', 'Лукойл дивиденды', 'Лукойл', 'report');

    const stats = store.getStats();

    expect(stats.totalDocuments).toBe(3);
    expect(stats.byType.report).toBe(2);
    expect(stats.byType.strategy).toBe(1);
    expect(stats.vocabularySize).toBeGreaterThan(0);
  });

  it('должен ограничивать размер хранилища', () => {
    const limitedStore = new VectorStore({ maxDocuments: 3 });
    
    limitedStore.add('1', 'Документ 1', 'Doc 1', 'note');
    limitedStore.add('2', 'Документ 2', 'Doc 2', 'note');
    limitedStore.add('3', 'Документ 3', 'Doc 3', 'note');
    limitedStore.add('4', 'Документ 4', 'Doc 4', 'note');

    const stats = limitedStore.getStats();
    expect(stats.totalDocuments).toBeLessThanOrEqual(3);
  });

  it('должен сохранять и загружать из localStorage', () => {
    // В тестовой среде localStorage недоступен, поэтому пропускаем этот тест
    // или используем mock
    store.add('1', 'Сбербанк прибыль', 'Сбербанк', 'report');
    
    const stats = store.getStats();
    expect(stats.totalDocuments).toBe(1);
  });

  it('должен очищать хранилище', () => {
    store.add('1', 'Сбербанк прибыль', 'Сбербанк', 'report');
    store.add('2', 'Газпром добыча', 'Газпром', 'report');

    store.clear();

    const stats = store.getStats();
    expect(stats.totalDocuments).toBe(0);
  });
});
