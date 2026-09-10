/**
 * Watch-режим: следит за изменениями Excel-файла и автоматически
 * перегенерирует report.html через parseExcelAndFetchRecommendations().
 *
 * Работает даже с открытым Excel-файлом — при блокировке файла
 * повторяет попытку чтения через 2 секунды (до 3 раз).
 *
 * Использование:
 *   npm run watch
 *
 * Остановить: Ctrl+C
 */
import { parseExcelAndFetchRecommendations } from './src/js/modules/ai-advisor/ai-advisor.js';
import * as fs from 'fs';
import * as path from 'path';

// Путь к Excel-файлу (дублируем из xlsx-parser-config.ts, чтобы не тянуть зависимости)
const EXCEL_FILE_PATH =
  process.env.EXCEL_FILE_PATH ||
  path.resolve('C:/Users/Радик/Documents/Бухгалтерия Радика/Отчет/Данные новые.xlsx');

const DEBOUNCE_MS = 5000; // Ждём 5 сек после изменения mtime — Power Query обычно завершает запись за 3-4 сек
const RETRY_DELAY_MS = 2000; // Ждём 2 сек перед повторной попыткой чтения
const MAX_RETRIES = 3; // Максимум попыток при блокировке файла

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

console.log('👁  Watch-режим запущен');
console.log('📂 Следим за файлом: ' + EXCEL_FILE_PATH);
console.log('⏱  Задержка после изменения: ' + DEBOUNCE_MS + ' мс');
console.log('🔄 Retry при блокировке: ' + MAX_RETRIES + ' раз(а)');
console.log('⌨  Остановить: Ctrl+C\n');

async function runAnalysisWithRetry() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await parseExcelAndFetchRecommendations();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Проверяем, заблокирован ли файл (Windows: код 32, EBUSY, EACCES)
      const isFileLocked =
        message.includes('EBUSY') ||
        message.includes('EACCES') ||
        message.includes('32') ||
        message.includes('locked') ||
        message.includes('blocked');

      if (isFileLocked && attempt < MAX_RETRIES) {
        console.log('   📁 Файл занят (попытка ' + attempt + '/' + MAX_RETRIES + '), повтор через ' + RETRY_DELAY_MS + ' мс...');
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      // Неблокировка или последняя попытка — выбрасываем ошибку
      throw error;
    }
  }
}

async function runAnalysis() {
  if (isRunning) {
    console.log('⏳ Анализ уже запущен, пропускаем...\n');
    return;
  }

  isRunning = true;
  console.log('🔄 Изменение обнаружено, перегенерация отчёта...\n');

  try {
    await runAnalysisWithRetry();
    console.log('\n✅ Отчёт успешно обновлён!\n');
  } catch (error) {
    console.error('\n❌ Ошибка при перегенерации:', error instanceof Error ? error.message : error, '\n');
  } finally {
    isRunning = false;
  }
}

function onFileChange() {
  // Сбрасываем предыдущий таймер (debounce)
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Запускаем анализ через DEBOUNCE_MS мс
  debounceTimer = setTimeout(() => {
    runAnalysis();
  }, DEBOUNCE_MS);
}

// Проверяем, существует ли файл
if (!fs.existsSync(EXCEL_FILE_PATH)) {
  console.error('❌ Файл не найден: ' + EXCEL_FILE_PATH);
  console.error('Установите переменную окружения EXCEL_FILE_PATH или измените путь в этом файле.\n');
  process.exit(1);
}

// Читаем начальное состояние файла
let lastModified = fs.statSync(EXCEL_FILE_PATH).mtimeMs;
let lastSuccessRun = Date.now();

// Первый запуск
runAnalysis();

// Poll-режим: проверяем файл каждые 2 секунды
const pollInterval = setInterval(() => {
  try {
    const currentModified = fs.statSync(EXCEL_FILE_PATH).mtimeMs;
    if (currentModified !== lastModified) {
      lastModified = currentModified;
      onFileChange();
    }
  } catch {
    // Файл может быть заблокирован Excel — игнорируем ошибки чтения метаданных
  }
}, 2000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Watch-режим остановлен.');
  if (debounceTimer) clearTimeout(debounceTimer);
  clearInterval(pollInterval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  clearInterval(pollInterval);
  process.exit(0);
});
