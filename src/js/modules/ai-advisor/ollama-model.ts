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
 * ⚠️ ТРЕБОВАНИЯ К ПАМЯТИ (проверено на RTX 4050 Laptop 6 ГБ VRAM + 16 ГБ RAM):
 *   - qwen3.5:9b  (6.6 ГБ) — РАБОТАЕТ: влезает в VRAM с CPU-оффлоадом;
 *   - qwen3.6:27b-q4_K_M (17.4 ГБ) — НЕ РАБОТАЕТ: не влезает ни в VRAM,
 *     ни в RAM (Ollama падает с «failed to allocate CUDA_Host buffer»).
 *     Для 27B нужно ≥ 32 ГБ RAM (или GPU с ≥ 20 ГБ VRAM).
 *
 * Модуль намеренно НЕ имеет зависимостей (без axios, без Node-модулей),
 * чтобы безопасно импортироваться и в Node-код, и в браузерный бандл
 * (browser-director работает в браузере, где process.env уже подставляется
 * сборщиком — как и в ollama-client.ts).
 */
export const OLLAMA_MODEL_NAME: string =
  process.env.OLLAMA_MODEL || 'qwen3.5:9b';
