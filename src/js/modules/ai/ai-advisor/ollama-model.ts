/**
 * Единая точка управления именем локальной модели Ollama.
 *
 * Модель задаётся ОДИН раз в .env (OLLAMA_MODEL) и используется во всех
 * местах кода:
 *   - ai-config.ts        → AI_MODELS[ollama].modelName (основной AI-конвейер);
 *   - review-agent.ts     → модель ревизоров (conservative/aggressive/risk);
 *   - ollama-client.ts    → дефолт модели Director;
 *   - browser-director.ts → модель Director (RAG + чат).
 *
 * Чтобы сменить модель — достаточно изменить OLLAMA_MODEL в .env
 * (или переопределить при запуске: set OLLAMA_MODEL=... && npm run pipeline).
 *
 * 💡 ТЕКУЩАЯ КОНФИГУРАЦИЯ (32 ГБ RAM, qwen3.6:35b-a3b):
 *   - Модель: qwen3.6:35b-a3b (MoE, 35B total / 3B active)
 *   - Размер: ~21 ГБ (Q4_K_M) — отлично влезает в 32 ГБ RAM
 *   - num_ctx: 24576 — оптимизированный контекст (промпт ~5-7k, ответ до 8k)
 *   - temperature: 0.7 — баланс креативности и точности
 *   - Streaming: включён — ответ приходит частями в реальном времени
 *   - Markdown: разрешён — модель форматирует ответы красиво
 *
 * 💡 ПОЧЕМУ qwen3.6:35b-a3b?
 *   - MoE-архитектура (Mixture of Experts) — 35B параметров, но только 3B активны
 *   - Быстрее full-size моделей при сопоставимом качестве
 *   - Отлично работает с Markdown, кодом, финансовыми расчётами
 *   - Контекст 32K токенов — хватает на полную историю чата + данные агентов
 *
 * Модуль намеренно НЕ имеет зависимостей (без axios, без Node-модулей),
 * чтобы безопасно импортироваться и в Node-код, и в браузерный бандл
 * (browser-director работает в браузере, где process.env уже подставляется
 * сборщиком — как и в ollama-client.ts).
 */
export const OLLAMA_MODEL_NAME: string =
  process.env.OLLAMA_MODEL || 'qwen3.6:35b-a3b';
