/**
 * Скрипт для очистки только AI-кэша (Ollama, GigaChat, Claude, GPT и т.д.)
 *
 * Не удаляет другие данные LocalCache.
 *
 * Использование:
 *   npm run cache:clear-ai
 */
import { localCache } from '../src/js/modules/ai-advisor/ollama-cache.js';

console.log('🧹 Очистка AI-кэша...\n');

const before = localCache.getAllEntries().length;
console.log(`📊 Всего записей в кэше: ${before}`);

const removed = localCache.clearAiEntries();

const after = localCache.getAllEntries().length;
console.log(`\n✅ Готово: удалено AI-записей ${removed}, осталось ${after} записей\n`);
