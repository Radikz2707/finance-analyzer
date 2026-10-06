/**
 * RAG Document Manager — UI для управления документами в RAG базе.
 *
 * Позволяет:
 * - Загружать документы (текст, JSON, Excel)
 * - Просматривать список документов
 * - Искать по документам
 * - Удалять документы
 */

import type { DocumentVector } from './vector-store.js';

/**
 * Создать HTML виджет для управления документами.
 */
export function createRAGDocumentManager(): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'rag-document-manager';
  container.innerHTML = `
    <div class="rag-manager__header">
      <h3>📚 База знаний (RAG)</h3>
      <button class="rag-manager__clear-btn" title="Очистить базу">🗑️</button>
    </div>
    
    <div class="rag-manager__stats">
      <div class="rag-manager__stat">
        <span class="rag-manager__stat-value" id="rag-doc-count">0</span>
        <span class="rag-manager__stat-label">документов</span>
      </div>
      <div class="rag-manager__stat">
        <span class="rag-manager__stat-value" id="rag-term-count">0</span>
        <span class="rag-manager__stat-label">терминов</span>
      </div>
    </div>
    
    <div class="rag-manager__upload">
      <h4>📤 Загрузить документ</h4>
      <div class="rag-manager__file-input-wrapper">
        <input type="file" id="rag-file-input" accept=".txt,.json,.md,.csv" class="rag-manager__file-input" />
        <label for="rag-file-input" class="rag-manager__file-label">
          Выбрать файл
        </label>
      </div>
      
      <div class="rag-manager__manual-input">
        <h4>✏️ Или ввести текст вручную</h4>
        <textarea id="rag-text-input" class="rag-manager__textarea" placeholder="Введите текст документа..."></textarea>
        <input type="text" id="rag-title-input" class="rag-manager__title-input" placeholder="Заголовок" />
        <select id="rag-type-select" class="rag-manager__type-select">
          <option value="note">📝 Заметка</option>
          <option value="strategy">🎯 Стратегия</option>
          <option value="trade">💼 Сделка</option>
          <option value="report">📊 Отчёт</option>
          <option value="news">📰 Новость</option>
        </select>
        <button id="rag-add-btn" class="rag-manager__add-btn">➕ Добавить</button>
      </div>
    </div>
    
    <div class="rag-manager__search">
      <h4>🔍 Поиск по базе</h4>
      <input type="text" id="rag-search-input" class="rag-manager__search-input" placeholder="Введите запрос..." />
      <button id="rag-search-btn" class="rag-manager__search-btn">Найти</button>
      <div id="rag-search-results" class="rag-manager__search-results"></div>
    </div>
    
    <div class="rag-manager__documents">
      <h4>📄 Документы</h4>
      <div id="rag-documents-list" class="rag-manager__documents-list"></div>
    </div>
  `;
  
  return container;
}

/**
 * Инициализировать обработчики событий для виджета.
 */
export function initRAGDocumentManager(
  director: {
    loadDocumentsForRAG: (docs: Array<{ text: string; title: string; type: string; metadata?: Record<string, unknown> }>) => Promise<number>;
    queryRAG: (question: string) => Promise<{ answer: string; sources: Array<{ title: string; score: number }>; hasRelevantDocuments: boolean }>;
    getRAGStats: () => Record<string, unknown>;
    clearRAG: () => void;
  },
): void {
  const fileInput = document.getElementById('rag-file-input') as HTMLInputElement;
  const textInput = document.getElementById('rag-text-input') as HTMLTextAreaElement;
  const titleInput = document.getElementById('rag-title-input') as HTMLInputElement;
  const typeSelect = document.getElementById('rag-type-select') as HTMLSelectElement;
  const addBtn = document.getElementById('rag-add-btn') as HTMLButtonElement;
  const searchInput = document.getElementById('rag-search-input') as HTMLInputElement;
  const searchBtn = document.getElementById('rag-search-btn') as HTMLButtonElement;
  const searchResults = document.getElementById('rag-search-results') as HTMLDivElement;
  const clearBtn = document.querySelector('.rag-manager__clear-btn') as HTMLButtonElement;
  const documentsList = document.getElementById('rag-documents-list') as HTMLDivElement;
  
  // Загрузка файла
  fileInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const type = file.name.endsWith('.json') ? 'report' : 'note';
      
      const count = await director.loadDocumentsForRAG([
        {
          text,
          title: file.name,
          type,
          metadata: { fileName: file.name, fileSize: file.size },
        },
      ]);
      
      alert(`✅ Загружено ${count} документ(ов)`);
      updateStats();
      updateDocumentsList();
    };
    reader.readAsText(file);
  });
  
  // Добавление текста
  addBtn?.addEventListener('click', async () => {
    const text = textInput.value.trim();
    const title = titleInput.value.trim() || 'Без заголовка';
    const type = typeSelect.value as DocumentVector['type'];
    
    if (!text) {
      alert('Введите текст документа');
      return;
    }
    
    const count = await director.loadDocumentsForRAG([
      {
        text,
        title,
        type,
        metadata: { sourceType: 'manual' },
      },
    ]);
    
    textInput.value = '';
    titleInput.value = '';
    
    alert(`✅ Добавлено ${count} документ(ов)`);
    updateStats();
    updateDocumentsList();
  });
  
  // Поиск
  searchBtn?.addEventListener('click', async () => {
    const question = searchInput.value.trim();
    if (!question) return;
    
    searchResults.innerHTML = '<div class="rag-manager__searching">🔍 Ищу...</div>';
    
    try {
      const result = await director.queryRAG(question);
      
      if (result.hasRelevantDocuments) {
        searchResults.innerHTML = `
          <div class="rag-manager__search-answer">
            <h5>💡 Ответ:</h5>
            <p>${result.answer}</p>
          </div>
          <div class="rag-manager__search-sources">
            <h5>📚 Источники:</h5>
            ${result.sources.map(s => `
              <div class="rag-manager__source">
                <strong>${s.title}</strong> (релевантность: ${(s.score * 100).toFixed(0)}%)
              </div>
            `).join('')}
          </div>
        `;
      } else {
        searchResults.innerHTML = '<div class="rag-manager__no-results">❌ Ничего не найдено</div>';
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      searchResults.innerHTML = '<div class="rag-manager__error">❌ Ошибка поиска</div>';
    }
  });
  
  // Очистка
  clearBtn?.addEventListener('click', () => {
    if (confirm('Очистить всю базу знаний?')) {
      director.clearRAG();
      updateStats();
      updateDocumentsList();
      searchResults.innerHTML = '';
    }
  });
  
  // Обновление статистики
  function updateStats(): void {
    const stats = director.getRAGStats();
    const docCount = document.getElementById('rag-doc-count');
    const termCount = document.getElementById('rag-term-count');
    
    if (docCount) {
      docCount.textContent = (stats.totalDocuments as number)?.toString() || '0';
    }
    if (termCount) {
      termCount.textContent = (stats.totalTerms as number)?.toLocaleString('ru-RU') || '0';
    }
  }
  
  // Обновление списка документов
  function updateDocumentsList(): void {
    if (!documentsList) return;
    
    // В текущей реализации список документов не доступен напрямую,
    // поэтому показываем заглушку
    documentsList.innerHTML = '<p class="rag-manager__info">Документы загружены и готовы к поиску.</p>';
  }
  
  // Первоначальное обновление
  updateStats();
}
