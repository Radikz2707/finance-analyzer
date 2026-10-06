/// <reference types="vitest/globals" />
/**
 * Smoke-тест CLI-чата Директора в режиме `--once`.
 *
 * Запускает реальный процесс:
 *   node --import tsx scripts/director-chat.ts --once "Сравни Сбер и Газпром"
 * и проверяет вывод: план делегирования, результаты агентов, раунд Консилиума
 * и блок ответа Director.
 *
 * Стабильность в CI:
 * - EXCEL_FILE_PATH принудительно пустой → детерминированный режим «без данных»;
 * - DIRECTOR_CHAT_AI=off → роль «ai» не делает сетевых проб и работает в
 *   детерминированном режиме (быстро и одинаково везде);
 * - таймаут 120 с покрывает JIT-транспиляцию tsx и работу агентов.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

/** Корень репозитория (родитель scripts/) */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const SMOKE_TIMEOUT_MS = 120_000;

describe('CLI Director Chat (smoke, --once)', () => {
  it(
    '«Сравни Сбер и Газпром»: план, результаты агентов, Консилиум, ответ',
    async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/director-chat.ts',
          '--once',
          'Сравни Сбер и Газпром',
        ],
        {
          cwd: REPO_ROOT,
          // Без данных портфеля и без LLM: детерминированный офлайн-режим
          env: {
            ...process.env,
            EXCEL_FILE_PATH: '',
            OLLAMA_MODEL: '',
            DIRECTOR_CHAT_AI: 'off',
          },
          timeout: SMOKE_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      // План делегирования (стриминг аудита);
      // «📋 План: подключены агенты [...]» — регистронезависимо
      expect(stdout).toMatch(/подключены агенты/i);
      // Результаты агентов (⚙️ strategist → ok ...)
      expect(stdout).toContain('→ ok');
      // Консилиум созван и показан хотя бы первый раунд
      expect(stdout).toContain('Консилиум');
      expect(stdout).toContain('Раунд 1');
      // Блок ответа Director выводится отдельно
      expect(stdout).toContain('Ответ Director');
      // Синтез Director появляется в стриминге
      expect(stdout).toContain('Синтез Director');
    },
    SMOKE_TIMEOUT_MS,
  );
});
