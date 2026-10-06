/**
 * ActionAgentFactory — фабрика/реестр action-агентов.
 *
 * ⚠️ Node-only модуль: агенты используют fs / child_process / сетевые вызовы,
 * поэтому этот файл НЕ должен попадать в браузерный бандл. В Node-контуре
 * (harness-bootstrap, CLI, скрипты, тесты) фабрика подключается к
 * Director-фасаду через DI (`actionAgents`); в браузерной сборке агентов нет,
 * и фасад честно отвечает «доступно в десктопном режиме».
 *
 * Базовый набор для Director: `file`, `terminal`. Остальные action-агенты
 * (package/browser/config/process/scheduler/learning/auto-repair)
 * регистрируются как доступные в реестре (lazy-создание), но в фасад
 * Director не подключаются: они инфраструктурные и вызываются напрямую.
 *
 * Все экземпляры создаются с безопасными корнями (по умолчанию
 * `process.cwd()`) и разумными таймаутами.
 */

import type { IAgent } from '../agent/types.js';
import { AutoRepairAgent } from './auto-repair-agent.js';
import { BrowserAgent } from './browser-agent.js';
import { ConfigAgent } from './config-agent.js';
import { FileAgent, type FileAgentInput } from './file-agent.js';
import { LearningAgent } from './learning-agent.js';
import { PackageAgent } from './package-agent.js';
import { ProcessAgent } from './process-agent.js';
import { SchedulerAgent } from './scheduler-agent.js';
import { TerminalAgent, type TerminalAgentInput } from './terminal-agent.js';

// ──────────────────────────────────────────────
// 1. Роли и типы
// ──────────────────────────────────────────────

/** Роль action-агента в реестре */
export type ActionAgentRole =
  | 'file'
  | 'terminal'
  | 'package'
  | 'browser'
  | 'config'
  | 'process'
  | 'scheduler'
  | 'learning'
  | 'auto-repair';

/**
 * Карта базовых action-агентов для Director-фасада (браузер: отсутствует).
 * Output не параметризуем: AgentBase.execute возвращает AgentResult без
 * дженерика, а конкретный выходной контракт проверяется потребителем.
 */
export interface DirectorActionAgents {
  file?: IAgent<FileAgentInput>;
  terminal?: IAgent<TerminalAgentInput>;
}

/** Опции фабрики */
export interface ActionAgentFactoryOptions {
  /** Разрешённые корни (по умолчанию — process.cwd()) */
  roots?: string[];
  /** Таймаут по умолчанию для агентов, мс (по умолчанию 30 000) */
  defaultTimeoutMs?: number;
}

/** Таймауты по умолчанию: файловые операции быстрые, терминал дольше */
const DEFAULT_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 15_000;

// ──────────────────────────────────────────────
// 2. Реестр
// ──────────────────────────────────────────────

/**
 * Реестр action-агентов с lazy-созданием: экземпляр строится один раз
 * при первом обращении к роли и кэшируется.
 */
export class ActionAgentRegistry {
  private readonly roots: string[];
  private readonly defaultTimeoutMs: number;
  private readonly factories: ReadonlyMap<ActionAgentRole, () => unknown>;
  private readonly cache = new Map<ActionAgentRole, unknown>();

  constructor(options: ActionAgentFactoryOptions = {}) {
    this.roots = options.roots?.length ? options.roots : [process.cwd()];
    this.defaultTimeoutMs =
      options.defaultTimeoutMs && options.defaultTimeoutMs > 0
        ? options.defaultTimeoutMs
        : DEFAULT_TIMEOUT_MS;

    this.factories = new Map<ActionAgentRole, () => unknown>([
      ['file', () => this.createFileAgent()],
      ['terminal', () => this.createTerminalAgent()],
      [
        'package',
        () =>
          new PackageAgent(
            { name: 'PackageAgent', timeoutMs: this.defaultTimeoutMs },
            { roots: this.roots },
          ),
      ],
      [
        'browser',
        () =>
          new BrowserAgent({
            name: 'BrowserAgent',
            timeoutMs: this.defaultTimeoutMs,
          }),
      ],
      [
        'config',
        () =>
          new ConfigAgent(
            { name: 'ConfigAgent', timeoutMs: this.defaultTimeoutMs },
            { roots: this.roots },
          ),
      ],
      [
        'process',
        () =>
          new ProcessAgent(
            { name: 'ProcessAgent', timeoutMs: this.defaultTimeoutMs },
            { roots: this.roots },
          ),
      ],
      ['scheduler', () => new SchedulerAgent()],
      ['learning', () => new LearningAgent()],
      [
        'auto-repair',
        () =>
          new AutoRepairAgent(
            { name: 'AutoRepairAgent', timeoutMs: this.defaultTimeoutMs },
            { roots: this.roots },
          ),
      ],
    ]);
  }

  /** Доступна ли роль в реестре */
  has(role: ActionAgentRole): boolean {
    return this.factories.has(role);
  }

  /**
   * Получить экземпляр агента по роли (lazy-создание + кэш).
   * @throws если роль не зарегистрирована
   */
  get<T>(role: ActionAgentRole): T {
    const cached = this.cache.get(role);
    if (cached !== undefined) {
      return cached as T;
    }
    const factory = this.factories.get(role);
    if (!factory) {
      throw new Error(`Неизвестная роль action-агента: ${role}`);
    }
    const instance = factory();
    this.cache.set(role, instance);
    return instance as T;
  }

  /** Все зарегистрированные роли */
  listRoles(): ActionAgentRole[] {
    return [...this.factories.keys()];
  }

  /**
   * Базовый набор для Director-фасада: file + terminal.
   * Создаётся один раз на весь реестр.
   */
  createDefaultActionAgents(): DirectorActionAgents {
    return {
      file: this.get<IAgent<FileAgentInput>>('file'),
      terminal: this.get<IAgent<TerminalAgentInput>>('terminal'),
    };
  }

  // ── Фабрики базового набора ──

  private createFileAgent(): IAgent<FileAgentInput> {
    return new FileAgent(
      { name: 'FileAgent', timeoutMs: FILE_TIMEOUT_MS },
      { roots: this.roots },
    );
  }

  private createTerminalAgent(): IAgent<TerminalAgentInput> {
    return new TerminalAgent(
      { name: 'TerminalAgent' },
      {
        roots: this.roots,
        defaultTimeoutMs: this.defaultTimeoutMs,
      },
    );
  }
}

// ──────────────────────────────────────────────
// 3. Хелперы верхнего уровня
// ──────────────────────────────────────────────

/** Создать реестр action-агентов (Node-only) */
export function createActionAgentFactory(
  options?: ActionAgentFactoryOptions,
): ActionAgentRegistry {
  return new ActionAgentRegistry(options);
}

/**
 * Быстрый способ получить базовый набор { file, terminal } для Director.
 * Эквивалент `createActionAgentFactory().createDefaultActionAgents()`.
 */
export function createDefaultActionAgents(
  options?: ActionAgentFactoryOptions,
): DirectorActionAgents {
  return new ActionAgentRegistry(options).createDefaultActionAgents();
}
