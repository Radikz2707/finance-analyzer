/**
 * CodingWorkflow — конвейер разработки кода под управлением Директора.
 *
 * Этапы: write → test → analyze → repair → retest → report.
 *
 * Роли «органов»:
 * - FileAgent пишет файлы (код);
 * - TerminalAgent запускает проверку работоспособности (npm test/build);
 * - RepairExecutor (DI) чинит провалы: авто-ремонт, LLM-исполнитель или
 *   правило по паттерну ошибки; по умолчанию — честное «не могу починить»;
 * - отчёт фиксирует итог: работоспособно ли приложение (testPassed).
 *
 * Безопасность: никакой прямой работы с процессами — только FileAgent
 * (корни/защита путей) и TerminalAgent (whitelist/blacklist/таймауты).
 * В Director роль 'code' дополнительно проходит security-gate.
 */

import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import { splitCommandWithArgs } from '../agent/command-tokens.js';
import type { AgentConfig } from '../agent/types.js';
import { FileAgent, type FileAgentInput } from '../agents/file-agent.js';
import {
  TerminalAgent,
  type TerminalAgentInput,
  type TerminalAgentOutput,
} from '../agents/terminal-agent.js';
import {
  CodingWorkflowError,
  type CodingWorkflowInput,
  type CodingWorkflowOutput,
  type CodeFileSpec,
  type RepairExecutor,
  type StepRecord,
} from './types.js';

/** Максимум символов вывода провала, передаваемого ремонт-исполнителю */
const MAX_FAILURE_OUTPUT = 4000;

/** Максимум строк в кратком описании провала (этап analyze) */
const ANALYZE_LINES = 5;

/** Опции конструктора CodingWorkflow */
export interface CodingWorkflowEngineOptions {
  /** Разрешённые корни (для собственных File/Terminal агентов) */
  roots?: string[];
  /** Агент записи файлов (по умолчанию — свой FileAgent с roots) */
  fileAgent?: IAgentLike<FileAgentInput>;
  /** Агент выполнения проверок (по умолчанию — свой TerminalAgent) */
  terminalAgent?: IAgentLike<TerminalAgentInput>;
  /** Команда проверки по умолчанию (по умолчанию 'npm run test') */
  defaultTestCommand?: string;
  /** Максимум итераций ремонта по умолчанию (по умолчанию 2) */
  maxRepairIterations?: number;
  /** Ремонт-исполнитель (по умолчанию — null: «не могу починить») */
  repairExecutor?: RepairExecutor;
}

/** Минимальный контракт агента (AgentResult-обёртка) */
interface IAgentLike<TInput> {
  execute(
    input: TInput,
  ): Promise<{ success: boolean; data?: unknown; error?: unknown }>;
}

export class CodingWorkflow extends AgentBase {
  private readonly fileAgent: IAgentLike<FileAgentInput>;
  private readonly terminalAgent: IAgentLike<TerminalAgentInput>;
  private readonly defaultTestCommand: string;
  private readonly maxRepairIterations: number;
  private readonly repairExecutor: RepairExecutor;

  constructor(config?: AgentConfig, options?: CodingWorkflowEngineOptions) {
    super(config ?? { name: 'CodingWorkflow' });
    const roots = options?.roots?.length
      ? options.roots.map((root) => path.resolve(root))
      : [process.cwd()];
    this.fileAgent =
      options?.fileAgent ?? new FileAgent({ name: 'FileAgent' }, { roots });
    this.terminalAgent =
      options?.terminalAgent ??
      new TerminalAgent({ name: 'TerminalAgent' }, { roots });
    this.defaultTestCommand = options?.defaultTestCommand ?? 'npm run test';
    this.maxRepairIterations = Math.max(0, options?.maxRepairIterations ?? 2);
    this.repairExecutor = options?.repairExecutor ?? (() => null);
  }

  protected async executeInternal(
    input: CodingWorkflowInput,
  ): Promise<CodingWorkflowOutput> {
    this.validateInput(input);

    const steps: StepRecord[] = [];
    const filesWritten: string[] = [];

    // ── Этап write: записываем все файлы ──
    for (const file of input.files) {
      const result = await this.fileAgent.execute({
        action: 'write',
        path: file.path,
        content: file.content,
      });
      if (!result.success) {
        steps.push({
          step: 'write',
          success: false,
          message: `Не удалось записать ${file.path}: ${errorText(result.error)}`,
        });
        return this.report(steps, filesWritten, false, 0);
      }
      filesWritten.push(file.path);
    }
    steps.push({
      step: 'write',
      success: true,
      message: `Записано файлов: ${filesWritten.length} (${filesWritten.join(', ')})`,
    });

    // ── Цикл test → analyze → repair → retest ──
    const maxRepair = Math.max(
      0,
      input.maxRepairIterations ?? this.maxRepairIterations,
    );
    const command = splitCommandWithArgs(
      input.testCommand ?? this.defaultTestCommand,
    ) ?? { command: '', args: undefined };
    let testPassed = false;
    let repairIterations = 0;

    for (let attempt = 0; attempt <= maxRepair; attempt++) {
      const isRetest = attempt > 0;
      const run = await this.terminalAgent.execute({
        command: command.command,
        args: command.args,
      });
      const out = run.success
        ? (run.data as TerminalAgentOutput | undefined)
        : undefined;
      if (!out) {
        steps.push({
          step: isRetest ? 'retest' : 'test',
          success: false,
          message: `Проверка не выполнена: ${errorText(run.error)}`,
          attempt: isRetest ? attempt : undefined,
        });
        break;
      }
      if (out.exitCode === 0) {
        testPassed = true;
        steps.push({
          step: isRetest ? 'retest' : 'test',
          success: true,
          message: `Проверка пройдена: ${out.command} (exit 0)`,
          attempt: isRetest ? attempt : undefined,
        });
        break;
      }

      steps.push({
        step: isRetest ? 'retest' : 'test',
        success: false,
        message: `Проверка провалена: ${out.command} (exit ${out.exitCode})`,
        attempt: isRetest ? attempt : undefined,
      });
      if (attempt >= maxRepair) {
        break; // ремонтов больше нет
      }

      // ── analyze: краткое описание провала ──
      const failureOutput = (out.stderr || out.stdout || '').slice(
        0,
        MAX_FAILURE_OUTPUT,
      );
      steps.push({
        step: 'analyze',
        success: true,
        message: `Провал проанализирован: ${summarizeFailure(failureOutput)}`,
        attempt,
      });

      // ── repair: исправление от ремонт-исполнителя ──
      const action = await this.repairExecutor({
        task: input.task,
        failureOutput,
        exitCode: out.exitCode,
        attempt: attempt + 1,
      });
      if (!action) {
        steps.push({
          step: 'repair',
          success: false,
          message:
            'Ремонт-исполнитель не предложил исправление — требуется ' +
            'доработка файлов или инструкции (честный отказ)',
          attempt: attempt + 1,
        });
        break;
      }
      const repaired = await this.applyRepair(action);
      steps.push({
        step: 'repair',
        success: repaired,
        message: repaired
          ? `Исправление применено (${action.type})${action.note ? `: ${action.note}` : ''}`
          : 'Исправление не применено',
        attempt: attempt + 1,
      });
      if (!repaired) {
        break;
      }
      repairIterations += 1;
    }

    return this.report(steps, filesWritten, testPassed, repairIterations);
  }

  /** Применить исправление (запись файла или команда) */
  private async applyRepair(action: {
    type: 'write' | 'command';
    file?: CodeFileSpec;
    command?: string;
    args?: string[];
  }): Promise<boolean> {
    if (action.type === 'write' && action.file) {
      const result = await this.fileAgent.execute({
        action: 'write',
        path: action.file.path,
        content: action.file.content,
      });
      return result.success;
    }
    if (action.type === 'command' && action.command) {
      const result = await this.terminalAgent.execute({
        command: action.command,
        args: action.args,
      });
      const out = result.success
        ? (result.data as TerminalAgentOutput | undefined)
        : undefined;
      return Boolean(out && out.exitCode === 0);
    }
    return false;
  }

  /** Итоговый отчёт (этап report) */
  private report(
    steps: StepRecord[],
    filesWritten: string[],
    testPassed: boolean,
    repairIterations: number,
  ): CodingWorkflowOutput {
    const message = testPassed
      ? `Разработка завершена: записано файлов ${filesWritten.length}, ` +
        `проверка пройдена после ${repairIterations} ремонта(ов).`
      : 'Работоспособность не достигнута: проверка не пройдена ' +
        `после ${repairIterations} ремонта(ов). Требуется внимание человека.`;
    steps.push({ step: 'report', success: testPassed, message });
    return {
      success: testPassed,
      message,
      testPassed,
      repairIterations,
      filesWritten,
      steps,
    };
  }

  /** Валидация входа (честные ошибки) */
  private validateInput(input: CodingWorkflowInput): void {
    if (!input || typeof input !== 'object') {
      throw new CodingWorkflowError(
        'CodingWorkflow: входные данные отсутствуют',
      );
    }
    if (typeof input.task !== 'string' || input.task.trim() === '') {
      throw new CodingWorkflowError(
        'CodingWorkflow: не указано описание задачи (task)',
      );
    }
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new CodingWorkflowError(
        'CodingWorkflow: список файлов пуст — автономная разработка без ' +
          'содержимого файлов невозможна (честный отказ)',
      );
    }
    for (const file of input.files) {
      if (!file || typeof file.path !== 'string' || file.path.trim() === '') {
        throw new CodingWorkflowError(
          'CodingWorkflow: у файла не указан путь (path)',
        );
      }
      if (typeof file.content !== 'string') {
        throw new CodingWorkflowError(
          `CodingWorkflow: у файла ${file.path} не указано содержимое (content)`,
        );
      }
    }
  }
}

/** Краткое описание провала: первые значимые строки вывода */
function summarizeFailure(failureOutput: string): string {
  const lines = failureOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, ANALYZE_LINES);
  return lines.join(' | ').slice(0, 300) || 'вывод пуст';
}

/** Текст ошибки из AgentResult */
function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? 'неизвестная ошибка');
}
