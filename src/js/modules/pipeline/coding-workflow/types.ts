/**
 * CodingWorkflow — типы конвейера разработки кода (этапы write → test →
 * analyze → repair → retest → report).
 *
 * Назначение: Директор принял задачу «создать новый функционал» и делегирует
 * её связке агентов:
 * - FileAgent пишет файлы (этап write);
 * - TerminalAgent запускает проверку (npm test / build — этап test/retest);
 * - RepairExecutor чинит провалы (DI: авто-ремонт или LLM-исполнитель);
 * - отчёт фиксирует работоспособность приложения (testPassed).
 *
 * Безопасность: все операции идут через FileAgent/TerminalAgent с их
 * whitelist/roots; никаких прямых child_process; в Director роль 'code'
 * дополнительно проходит security-gate.
 */

import type { IAgent } from '../agent/types.js';
import type { FileAgentInput } from '../agents/file-agent.js';
import type { TerminalAgentInput } from '../agents/terminal-agent.js';

// ──────────────────────────────────────────────
// 1. Вход
// ──────────────────────────────────────────────

/** Файл для записи */
export interface CodeFileSpec {
  /** Путь (относительно корня FileAgent) */
  path: string;
  /** Содержимое файла */
  content: string;
}

/** Вход CodingWorkflow */
export interface CodingWorkflowInput {
  /** Описание задачи (для отчёта и repair-исполнителя) */
  task: string;
  /** Файлы для записи (этап write); пустой список → честный отказ */
  files: CodeFileSpec[];
  /**
   * Команда проверки (по умолчанию: npm run test → 'npm', ['run','test']).
   * Формат: строка, разбирается через tokenize; выполняется через
   * TerminalAgent (whitelist npm/git/npx...).
   */
  testCommand?: string;
  /** Максимум итераций ремонта (по умолчанию 2) */
  maxRepairIterations?: number;
}

// ──────────────────────────────────────────────
// 2. Этапы и результат
// ──────────────────────────────────────────────

/** Этапы конвейера */
export type CodingWorkflowStep =
  'write' | 'test' | 'analyze' | 'repair' | 'retest' | 'report';

/** Запись одного этапа */
export interface StepRecord {
  /** Название этапа */
  step: CodingWorkflowStep;
  /** Успешен ли этап */
  success: boolean;
  /** Человекочитаемое описание результата этапа */
  message: string;
  /** Номер попытки ремонта (для repair/retest) */
  attempt?: number;
}

/** Что делать ремонт-исполнителю (результат RepairExecutor) */
export type RepairAction =
  | { type: 'write'; file: CodeFileSpec; note?: string }
  | { type: 'command'; command: string; args?: string[]; note?: string };

/** Контекст провала для ремонт-исполнителя */
export interface RepairContext {
  /** Исходная задача */
  task: string;
  /** Вывод провалившейся проверки (stdout+stderr, обрезанный) */
  failureOutput: string;
  /** Код возврата провалившейся проверки */
  exitCode: number;
  /** Номер попытки ремонта (1..maxRepairIterations) */
  attempt: number;
}

/** Ремонт-исполнитель: по провалу решает, что исправить. null = не может */
export type RepairExecutor = (
  context: RepairContext,
) => Promise<RepairAction | null> | RepairAction | null;

/** Выход CodingWorkflow */
export interface CodingWorkflowOutput {
  /** Достигнута ли работоспособность (тесты прошли) */
  success: boolean;
  /** Человекочитаемая сводка */
  message: string;
  /** Прошла ли финальная проверка */
  testPassed: boolean;
  /** Сколько итераций ремонта было выполнено */
  repairIterations: number;
  /** Записанные файлы */
  filesWritten: string[];
  /** Журнал этапов */
  steps: StepRecord[];
}

// ──────────────────────────────────────────────
// 3. Опции (DI)
// ──────────────────────────────────────────────

/** Опции CodingWorkflow */
export interface CodingWorkflowOptions {
  /** Разрешённые корни (для собственных File/Terminal агентов) */
  roots?: string[];
  /** Агент записи файлов (по умолчанию — свой FileAgent с roots) */
  fileAgent?: IAgent<FileAgentInput>;
  /** Агент выполнения проверок (по умолчанию — свой TerminalAgent) */
  terminalAgent?: IAgent<TerminalAgentInput>;
  /** Команда проверки по умолчанию (по умолчанию 'npm run test') */
  defaultTestCommand?: string;
  /** Максимум итераций ремонта по умолчанию (по умолчанию 2) */
  maxRepairIterations?: number;
  /** Ремонт-исполнитель (по умолчанию — null: «не могу починить») */
  repairExecutor?: RepairExecutor;
}

// ──────────────────────────────────────────────
// 4. Ошибка
// ──────────────────────────────────────────────

/** Честная ошибка конвейера */
export class CodingWorkflowError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodingWorkflowError';
  }
}
