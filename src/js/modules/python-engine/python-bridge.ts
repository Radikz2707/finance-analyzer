/**
 * PythonBridge — TS↔Python мост через child_process (JSON over stdio).
 *
 * Архитектура:
 *   [TypeScript] ──spawn──→ [python main.py]
 *   [TypeScript] ←──stdout JSON── [python]
 *
 * Протокол: одна JSON-строка в stdin → одна JSON-строка из stdout.
 * Таймаут защищает pipeline от зависшего процесса python.
 *
 * Retry: при ошибке (ненулевой код, таймаут, невалидный JSON, ошибка
 * движка) выполняется до `retries` ДОПОЛНИТЕЛЬНЫХ попыток сверх первой
 * с экспоненциальной задержкой (retryDelayMs * 2^attempt). Скрипт
 * не найден — НЕ ретраится (сразу throw).
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { getLogger } from '../logger/logger.js';
import type {
  IPythonBridge,
  PythonBridgeConfig,
  PythonRequest,
  PythonResponse,
} from './types.js';

/** Логгер модуля */
const log = getLogger('python-bridge');

/** Путь к движку по умолчанию (от корня проекта) */
const DEFAULT_SCRIPT_PATH = resolve(process.cwd(), 'src', 'python', 'main.py');

/** Число дополнительных попыток по умолчанию (итого 2 попытки) */
const DEFAULT_RETRIES = 1;

/** Базовая задержка между попытками, мс */
const DEFAULT_RETRY_DELAY_MS = 300;

/** Определить доступный интерпретатор: на Windows 'python', иначе 'python3' */
function detectPythonPath(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

/** Пауза между попытками */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * PythonBridge — запуск Python-движка и обмен JSON по stdio.
 */
export class PythonBridge implements IPythonBridge {
  private readonly config: Required<PythonBridgeConfig>;

  constructor(config?: Partial<PythonBridgeConfig>) {
    this.config = {
      pythonPath: config?.pythonPath ?? detectPythonPath(),
      scriptPath: config?.scriptPath ?? DEFAULT_SCRIPT_PATH,
      timeoutMs: config?.timeoutMs ?? 15000,
      verbose: config?.verbose ?? false,
      retries: config?.retries ?? DEFAULT_RETRIES,
      retryDelayMs: config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    };
  }

  /** Доступен ли скрипт Python-движка на диске */
  isScriptAvailable(): boolean {
    return existsSync(this.config.scriptPath);
  }

  /**
   * Выполнить команду в Python-движке.
   *
   * Retry: повторяет попытку при любой ошибке процесса (код ≠ 0,
   * таймаут, невалидный JSON, ошибка движка) до `retries` раз с
   * экспоненциальной задержкой. Скрипт не найден — сразу throw.
   *
   * @throws Error при недоступности скрипта или после исчерпания попыток.
   */
  async call<T = unknown>(request: PythonRequest): Promise<T> {
    if (!this.isScriptAvailable()) {
      // Скрипт отсутствует — ретраить бессмысленно, бросаем сразу
      throw new Error(
        `[PythonBridge] Скрипт движка не найден: ${this.config.scriptPath}`,
      );
    }

    let lastError: unknown;
    const attempts = this.config.retries + 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.runProcess<T>(request);
      } catch (err) {
        lastError = err;
        if (attempt < attempts) {
          const delay = this.config.retryDelayMs * 2 ** (attempt - 1);
          if (this.config.verbose) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn(
              `Попытка ${attempt}/${attempts} команды '${request.command}' не удалась: ${message}. Повтор через ${delay}мс`,
            );
          }
          await sleep(delay);
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Внутренний запуск одного процесса Python (одна попытка).
   * Вынесен в protected для тестирования retry-логики через подкласс.
   */
  protected async runProcess<T = unknown>(request: PythonRequest): Promise<T> {
    return new Promise<T>((resolvePromise, reject) => {
      const child = spawn(this.config.pythonPath, [this.config.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          child.kill();
          reject(
            new Error(
              `[PythonBridge] Таймаут ${this.config.timeoutMs}мс для команды '${request.command}'`,
            ),
          );
        });
      }, this.config.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        settle(() => {
          reject(
            new Error(
              `[PythonBridge] Не удалось запустить '${this.config.pythonPath}': ${err.message}`,
            ),
          );
        });
      });

      child.on('close', (code) => {
        settle(() => {
          if (code !== 0) {
            reject(
              new Error(
                `[PythonBridge] Python завершился с кодом ${code}: ${stderr.trim() || '(без stderr)'}`,
              ),
            );
            return;
          }

          try {
            const lines = stdout.trim().split('\n').filter(Boolean);
            const raw = lines[lines.length - 1] ?? '';
            const parsed = JSON.parse(raw) as PythonResponse<T>;

            if (!parsed.ok) {
              reject(
                new Error(
                  `[PythonBridge] Ошибка движка: ${parsed.error ?? 'unknown'}`,
                ),
              );
              return;
            }
            resolvePromise(parsed.data as T);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            reject(
              new Error(
                `[PythonBridge] Некорректный ответ Python: ${message}. stdout=${stdout.slice(0, 200)}`,
              ),
            );
          }
        });
      });

      child.stdin.write(JSON.stringify(request) + '\n');
      child.stdin.end();
    });
  }

  /** Проверить доступность Python-движка (команда health, с retry) */
  async isAvailable(): Promise<boolean> {
    try {
      const data = await this.call<{ python: string; commands: string[] }>({
        command: 'health',
      });
      if (this.config.verbose) {
        log.info(`✅ Python-движок доступен (python ${data.python})`);
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.config.verbose) {
        log.warn(`⚠️ Python-движок недоступен: ${message}`);
      }
      return false;
    }
  }
}
