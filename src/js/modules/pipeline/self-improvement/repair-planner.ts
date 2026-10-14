/**
 * RepairPlanner — планирование ремонта и улучшения проекта.
 *
 * Вход:
 * - диагностика AutoRepairAgent (AutoRepairOutput) — fixable-проверки
 *   превращаются в конкретные шаги (terminal/file);
 * - уроки LearningAgent (Lesson[]) — уроки с outcome 'bad' превращаются
 *   в code-шаги «пересмотреть подход к действию X»;
 * - метрики FeedbackLoop (AnalysisResult) — слабые категории (win rate
 *   < 0.4) превращаются в code-шаги «пересмотреть подход к категории X».
 *
 * Выход: ImprovementPlan (id, goal, diagnosis, steps, expectedOutcome).
 *
 * Модуль чистый: без Node-зависимостей, DI только для часов (детерминизм
 * в тестах). Шаги дедуплицируются по описанию — один и тот же фикс не
 * планируется дважды.
 */

import { randomUUID } from 'node:crypto';
import type {
  AutoRepairOutput,
  HealthCheckResult,
} from '../agents/auto-repair-agent.js';
import type { Lesson } from '../agents/learning-agent.js';
import type { AnalysisResult } from '../feedback-loop/types.js';
import { WEAK_WIN_RATE_THRESHOLD } from './improvement-goals.js';
import type { ImprovementPlan, ImprovementStep } from './types.js';

// ──────────────────────────────────────────────
// 1. Вход планировщика
// ──────────────────────────────────────────────

/** Вход RepairPlanner: диагностика + уроки + метрики */
export interface RepairPlannerInput {
  /** Диагностика AutoRepairAgent (обязательна) */
  diagnosis: AutoRepairOutput;
  /** Уроки LearningAgent (по умолчанию — пусто) */
  lessons?: readonly Lesson[];
  /** Метрики FeedbackLoop.analyze() (опционально) */
  metrics?: AnalysisResult | null;
  /** Цель улучшения (по умолчанию — «Ремонт и улучшение проекта») */
  goal?: string;
}

/** Опции RepairPlanner (DI) */
export interface RepairPlannerOptions {
  /** Часы для детерминированных тестов (по умолчанию new Date()) */
  now?: () => Date;
}

// ──────────────────────────────────────────────
// 2. Планировщик
// ──────────────────────────────────────────────

/** Планировщик ремонта: диагностика/уроки/метрики → план шагов */
export class RepairPlanner {
  private readonly now: () => Date;

  constructor(options?: RepairPlannerOptions) {
    this.now = options?.now ?? (() => new Date());
  }

  /**
   * Построить план улучшения.
   * Пустая диагностика + нет уроков + нет слабых категорий → план без
   * шагов (честно: чинить нечего).
   */
  buildPlan(input: RepairPlannerInput): ImprovementPlan {
    const steps: ImprovementStep[] = [];
    const seen = new Set<string>();

    // 1. Fixable-проверки диагностики → конкретные шаги.
    for (const check of input.diagnosis.checks) {
      if (!check.fixable || !check.fix) {
        continue;
      }
      const step = fixToStep(check);
      if (!step || seen.has(step.description)) {
        continue;
      }
      seen.add(step.description);
      steps.push(step);
    }

    // 2. Уроки LearningAgent: outcome 'bad' → пересмотреть подход.
    for (const lesson of input.lessons ?? []) {
      if (lesson.outcome !== 'bad') {
        continue;
      }
      const description = `Пересмотреть подход к «${lesson.action}» (урок: ${lesson.note ?? 'без заметок'})`;
      if (seen.has(description)) {
        continue;
      }
      seen.add(description);
      steps.push({
        role: 'code',
        input: {
          task: `Пересмотреть подход к «${lesson.action}»: ${lesson.note ?? ''}`.trim(),
          files: [],
        },
        description,
      });
    }

    // 3. Метрики FeedbackLoop: слабые категории → пересмотреть подход.
    if (input.metrics) {
      for (const category of input.metrics.metrics.byCategory) {
        if (category.implementedCount === 0) {
          continue; // метрики ненадёжны
        }
        if (category.winRate >= WEAK_WIN_RATE_THRESHOLD) {
          continue;
        }
        const description = `Пересмотреть подход к категории «${category.category}» (win rate ${(category.winRate * 100).toFixed(0)}%)`;
        if (seen.has(description)) {
          continue;
        }
        seen.add(description);
        steps.push({
          role: 'code',
          input: {
            task: `Пересмотреть подход к категории «${category.category}»: win rate ${(category.winRate * 100).toFixed(0)}%`,
            files: [],
          },
          description,
        });
      }
    }

    const goal = input.goal?.trim() || 'Ремонт и улучшение проекта';
    return {
      id: randomUUID(),
      goal,
      diagnosis: summarizeDiagnosis(input.diagnosis),
      steps,
      expectedOutcome: buildExpectedOutcome(steps.length),
      createdAt: this.now().toISOString(),
    };
  }
}

// ──────────────────────────────────────────────
// 3. Чистые хелперы (экспортируются для тестов)
// ──────────────────────────────────────────────

/**
 * Преобразовать fixable-проверку диагностики в шаг плана.
 * null — если фикс не выражается шагом (не должно случаться: все виды
 * RepairFixKind покрыты).
 */
export function fixToStep(check: HealthCheckResult): ImprovementStep | null {
  const fix = check.fix;
  if (!fix) {
    return null;
  }
  switch (fix.kind) {
    case 'terminal':
      return {
        role: 'terminal',
        input: { command: fix.command, args: fix.args },
        description: fix.description,
      };
    case 'git-checkout':
      return {
        role: 'terminal',
        input: { command: 'git', args: ['checkout', '--', fix.target] },
        description: fix.description,
      };
    case 'file-recreate':
      return {
        role: 'file',
        input: {
          action: 'write',
          path: fix.target,
          content: fix.content ?? '{}',
        },
        description: fix.description,
      };
    case 'file-copy':
      // Содержимое источника планировщику недоступно: шаг несёт source,
      // исполнитель (SelfImprovementLoop) читает источник перед записью.
      return {
        role: 'file',
        input: {
          action: 'write',
          path: fix.target,
          content: '',
          source: fix.source,
        },
        description: fix.description,
      };
    default: {
      const exhaustive: never = fix.kind;
      void exhaustive;
      return null;
    }
  }
}

/** Сводка диагностики одной строкой (для плана и отчётов) */
export function summarizeDiagnosis(diagnosis: AutoRepairOutput): string {
  const errors = diagnosis.checks.filter((c) => c.severity === 'error').length;
  const warnings = diagnosis.checks.filter(
    (c) => c.severity === 'warning',
  ).length;
  const fixable = diagnosis.checks.filter((c) => c.fixable).length;
  return (
    `Диагностика (${diagnosis.scope}): ${diagnosis.checks.length} проверок, ` +
    `ошибок ${errors}, предупреждений ${warnings}, исправимых ${fixable}, ` +
    `overall=${diagnosis.overall}`
  );
}

/** Ожидаемый результат плана (честная формулировка по числу шагов) */
function buildExpectedOutcome(stepCount: number): string {
  if (stepCount === 0) {
    return 'Проблем не обнаружено — изменения не требуются.';
  }
  return `Выполнить ${stepCount} шаг(ов) плана и убедиться, что проверка проекта (npm test / tsc) проходит.`;
}
