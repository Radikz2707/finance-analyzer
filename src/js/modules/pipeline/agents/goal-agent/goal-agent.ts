/**
 * GoalAgent — управление целями, приоритетами и жизненным циклом задач.
 */

import { randomUUID } from 'crypto';
import { AgentBase } from '../../agent/agent-base.js';
import type { AgentConfig } from '../../agent/types.js';
import type {
  GoalPriority,
  GoalStatus,
  GoalType,
  Goal,
  GoalAgentInput,
  GoalAddParams,
  GoalUpdateParams,
  GoalListParams,
  GoalReorderParams,
  GoalByTagsParams,
  GoalOperationResult,
  ProgressSummary,
  ExportResult,
} from './types.js';

const DEFAULT_PRIORITY: Goal['priority'] = 'medium';
const DEFAULT_TAGS: Goal['tags'] = [];
const PRIORITIES: GoalPriority[] = ['low', 'medium', 'high', 'critical'];

export class GoalAgent extends AgentBase {
  private goals: Map<string, Goal>;

  constructor(config: AgentConfig) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 10000 });
    this.goals = new Map();
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const params = input as GoalAgentInput;
    switch (params.action) {
      case 'add':
        return this.addGoal(params.params as GoalAddParams);
      case 'update':
        return this.updateGoal(params.params as GoalUpdateParams);
      case 'complete':
        return this.completeGoal(
          (params.params as { id: string; metrics?: Record<string, number> })
            .id,
          (params.params as { id: string; metrics?: Record<string, number> })
            .metrics,
        );
      case 'cancel':
        return this.cancelGoal((params.params as { id: string }).id);
      case 'pause':
        return this.pauseGoal((params.params as { id: string }).id);
      case 'resume':
        return this.resumeGoal((params.params as { id: string }).id);
      case 'delete':
        return this.deleteGoal((params.params as { id: string }).id);
      case 'get':
        return this.getGoal((params.params as { id: string }).id);
      case 'list':
        return this.listGoals(params.params as GoalListParams | undefined);
      case 'reorder':
        return this.reorderGoals(params.params as GoalReorderParams);
      case 'get-progress':
        return this.getProgressSummary();
      case 'get-overdue':
        return this.getOverdueGoals();
      case 'get-by-tags':
        return this.getGoalsByTags(params.params as GoalByTagsParams);
      case 'export-goals':
        return this.exportGoals(
          (params.params as { format?: 'json' | 'csv' } | undefined)?.format,
        );
      default:
        throw new Error(
          `Unknown action: ${(params as { action: string }).action}`,
        );
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  private createGoal(params: GoalAddParams): Goal {
    const now = this.now();
    return {
      id: randomUUID(),
      name: params.name,
      description: params.description,
      type: params.type,
      priority: params.priority ?? DEFAULT_PRIORITY,
      status: 'pending',
      progress: 0,
      deadline: params.deadline,
      parentId: params.parentId,
      tags: params.tags ?? DEFAULT_TAGS,
      createdAt: now,
      updatedAt: now,
      metrics: params.metrics,
    };
  }

  private addGoal(params: GoalAddParams): GoalOperationResult {
    const goal = this.createGoal(params);
    this.goals.set(goal.id, goal);
    return { success: true, message: `Цель "${goal.name}" создана`, goal };
  }

  private updateGoal(params: GoalUpdateParams): GoalOperationResult {
    const goal = this.goals.get(params.id);
    if (!goal) {
      return { success: false, message: `Цель с ID "${params.id}" не найдена` };
    }
    const updates: Partial<Goal> = {};
    if (params.name !== undefined) updates.name = params.name;
    if (params.description !== undefined)
      updates.description = params.description;
    if (params.type !== undefined) updates.type = params.type;
    if (params.priority !== undefined) updates.priority = params.priority;
    if (params.status !== undefined) updates.status = params.status;
    if (params.progress !== undefined)
      updates.progress = Math.max(0, Math.min(100, params.progress));
    if (params.deadline !== undefined) updates.deadline = params.deadline;
    if (params.parentId !== undefined) updates.parentId = params.parentId;
    if (params.tags !== undefined) updates.tags = params.tags;
    if (params.metrics !== undefined) updates.metrics = params.metrics;
    Object.assign(goal, updates, { updatedAt: this.now() });
    return { success: true, message: `Цель "${goal.name}" обновлена`, goal };
  }

  private completeGoal(
    id: string,
    metrics?: Record<string, number>,
  ): GoalOperationResult {
    const goal = this.goals.get(id);
    if (!goal)
      return { success: false, message: `Цель с ID "${id}" не найдена` };
    goal.status = 'completed';
    goal.progress = 100;
    goal.completedAt = this.now();
    goal.updatedAt = this.now();
    if (metrics) goal.metrics = { ...goal.metrics, ...metrics };
    return { success: true, message: `Цель "${goal.name}" завершена`, goal };
  }

  private cancelGoal(id: string): GoalOperationResult {
    const goal = this.goals.get(id);
    if (!goal)
      return { success: false, message: `Цель с ID "${id}" не найдена` };
    goal.status = 'cancelled';
    goal.updatedAt = this.now();
    return { success: true, message: `Цель "${goal.name}" отменена`, goal };
  }

  private pauseGoal(id: string): GoalOperationResult {
    const goal = this.goals.get(id);
    if (!goal)
      return { success: false, message: `Цель с ID "${id}" не найдена` };
    goal.status = 'paused';
    goal.updatedAt = this.now();
    return {
      success: true,
      message: `Цель "${goal.name}" приостановлена`,
      goal,
    };
  }

  private resumeGoal(id: string): GoalOperationResult {
    const goal = this.goals.get(id);
    if (!goal)
      return { success: false, message: `Цель с ID "${id}" не найдена` };
    goal.status = 'active';
    goal.updatedAt = this.now();
    return { success: true, message: `Цель "${goal.name}" возобновлена`, goal };
  }

  private deleteGoal(id: string): GoalOperationResult {
    const goal = this.goals.get(id);
    if (!goal)
      return { success: false, message: `Цель с ID "${id}" не найдена` };
    this.goals.delete(id);
    return { success: true, message: `Цель "${goal.name}" удалена` };
  }

  private getGoal(id: string): GoalOperationResult {
    const goal = this.goals.get(id);
    if (!goal)
      return { success: false, message: `Цель с ID "${id}" не найдена` };
    return { success: true, message: `Цель "${goal.name}" найдена`, goal };
  }

  private listGoals(params?: GoalListParams): GoalOperationResult {
    let goals = Array.from(this.goals.values());
    if (params) {
      if (params.type) goals = goals.filter((g) => g.type === params.type);
      if (params.status)
        goals = goals.filter((g) => g.status === params.status);
      if (params.priority)
        goals = goals.filter((g) => g.priority === params.priority);
      if (params.tags && params.tags.length > 0) {
        goals = goals.filter((g) =>
          params.tags!.some((t) => g.tags.includes(t)),
        );
      }
      if (params.search) {
        const search = params.search.toLowerCase();
        goals = goals.filter(
          (g) =>
            g.name.toLowerCase().includes(search) ||
            g.description.toLowerCase().includes(search),
        );
      }
    }
    const limit = params?.limit ?? goals.length;
    const offset = params?.offset ?? 0;
    const paginated = goals.slice(offset, offset + limit);
    return {
      success: true,
      message: `Найдено ${goals.length} целей`,
      goals: paginated,
    };
  }

  private reorderGoals(params: GoalReorderParams): GoalOperationResult {
    const goals = Array.from(this.goals.values());
    for (const rule of params.rules) {
      for (const goal of goals) {
        if (rule.targetType && goal.type !== rule.targetType) continue;
        if (rule.setPriority) {
          goal.priority = rule.setPriority;
          goal.updatedAt = this.now();
        }
        if (rule.boostPercent && goal.priority !== 'critical') {
          const idx = PRIORITIES.indexOf(goal.priority);
          if (
            idx < PRIORITIES.length - 1 &&
            Math.random() * 100 < rule.boostPercent
          ) {
            goal.priority = PRIORITIES[idx + 1]!;
            goal.updatedAt = this.now();
          }
        }
        if (rule.dPriorityPercent && goal.priority !== 'low') {
          const idx = PRIORITIES.indexOf(goal.priority);
          if (idx > 0 && Math.random() * 100 < rule.dPriorityPercent) {
            goal.priority = PRIORITIES[idx - 1]!;
            goal.updatedAt = this.now();
          }
        }
      }
    }
    return {
      success: true,
      message: `Приоритеты перераспределены для ${goals.length} целей`,
    };
  }

  private getProgressSummary(): GoalOperationResult {
    const goals = Array.from(this.goals.values());
    const byStatus: Record<GoalStatus, number> = {
      pending: 0,
      active: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
    };
    const byType: Record<GoalType, number> = {
      tracking: 0,
      analysis: 0,
      alert: 0,
      action: 0,
      research: 0,
    };
    const byPriority: Record<GoalPriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    let totalProgress = 0;
    let overdueCount = 0;
    const now = new Date();
    for (const goal of goals) {
      if (goal.status) if (goal.status) byStatus[goal.status]++;
      if (goal.type) if (goal.type) byType[goal.type]++;
      if (goal.priority) if (goal.priority) byPriority[goal.priority]++;
      totalProgress += goal.progress;
      if (
        goal.deadline &&
        new Date(goal.deadline) < now &&
        goal.status !== 'completed' &&
        goal.status !== 'cancelled'
      ) {
        overdueCount++;
      }
    }
    const summary: ProgressSummary = {
      totalGoals: goals.length,
      byStatus,
      byType,
      byPriority,
      averageProgress:
        goals.length > 0
          ? Math.round((totalProgress / goals.length) * 100) / 100
          : 0,
      overdueCount,
      completedCount: byStatus.completed || 0,
    };
    return {
      success: true,
      message: 'Сводка по прогрессу',
      progressSummary: summary,
    };
  }

  private getOverdueGoals(): GoalOperationResult {
    const now = new Date();
    const overdue = Array.from(this.goals.values()).filter(
      (g) =>
        g.deadline &&
        new Date(g.deadline) < now &&
        g.status !== 'completed' &&
        g.status !== 'cancelled',
    );
    return {
      success: true,
      message: `Найдено ${overdue.length} просроченных целей`,
      goals: overdue,
    };
  }

  private getGoalsByTags(params: GoalByTagsParams): GoalOperationResult {
    const goals = Array.from(this.goals.values());
    let filtered: Goal[];
    if (params.matchAll) {
      filtered = goals.filter((g) =>
        params.tags.every((t) => g.tags.includes(t)),
      );
    } else {
      filtered = goals.filter((g) =>
        params.tags.some((t) => g.tags.includes(t)),
      );
    }
    return {
      success: true,
      message: `Найдено ${filtered.length} целей по тегам`,
      goals: filtered,
    };
  }

  private exportGoals(
    format?: 'json' | 'csv',
  ): GoalOperationResult | ExportResult {
    const goals = Array.from(this.goals.values());
    const fmt = format ?? 'json';
    if (fmt === 'json') {
      const content = JSON.stringify(goals, null, 2);
      return { format: 'json', content, goalCount: goals.length };
    }
    const headers = [
      'id',
      'name',
      'description',
      'type',
      'priority',
      'status',
      'progress',
      'deadline',
      'tags',
      'createdAt',
    ];
    const rows = goals.map((g) =>
      headers.map((h) => String((g as unknown as Record<string, unknown>)[h] ?? '')).join(','),
    );
    const content = [headers.join(','), ...rows].join('\n');
    return { format: 'csv', content, goalCount: goals.length };
  }

  getGoalCount(): number {
    return this.goals.size;
  }

  getGoalById(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  getAllGoals(): Goal[] {
    return Array.from(this.goals.values());
  }
}
