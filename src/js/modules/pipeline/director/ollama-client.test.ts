/**
 * OllamaClient.normalizeKeepAlive — нормализация keep_alive.
 *
 * Ollama принимает duration-строку С единицей («30m», «-1s»): значение
 * «-1» без единицы даёт 400 «time: missing unit in duration "-1"».
 *
 * Тесты используют глобалы (globals: true) — как остальные тесты проекта.
 */

import { OllamaClient } from './ollama-client.js';

describe('OllamaClient.normalizeKeepAlive', () => {
  it('голое число «-1» → секунды «-1s» (держать всегда)', () => {
    expect(OllamaClient.normalizeKeepAlive('-1')).toBe('-1s');
  });

  it('голое число «0» → «0s» (выгружать сразу)', () => {
    expect(OllamaClient.normalizeKeepAlive('0')).toBe('0s');
  });

  it('положительное число «300» → «300s»', () => {
    expect(OllamaClient.normalizeKeepAlive('300')).toBe('300s');
  });

  it('duration с единицей проходит без изменений', () => {
    expect(OllamaClient.normalizeKeepAlive('30m')).toBe('30m');
    expect(OllamaClient.normalizeKeepAlive('1h30m')).toBe('1h30m');
    expect(OllamaClient.normalizeKeepAlive('-1s')).toBe('-1s');
  });

  it('пробелы обрезаются', () => {
    expect(OllamaClient.normalizeKeepAlive('  30m  ')).toBe('30m');
    expect(OllamaClient.normalizeKeepAlive(' -1 ')).toBe('-1s');
  });
});
