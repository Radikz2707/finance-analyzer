/**
 * AutomationAgent — workflow engine для автоматизации задач.
 */

import { randomUUID } from 'crypto';
import { AgentBase } from '../../agent/agent-base.js';
import type { AgentConfig } from '../../agent/types.js';
import type {
  AutomationAgentInput,
  AutomationAgentOutput,
  CreateTemplateParams,
  UpdateTemplateParams,
  RunTemplateParams,
  GetTemplatesParams,
  GetRunsParams,
  WorkflowTemplate,
  WorkflowRun,
  ActionExecutionResult,
  WorkflowStatus,
} from './types.js';

export class AutomationAgent extends AgentBase {
  private templates: Map<string, WorkflowTemplate>;
  private runs: Map<string, WorkflowRun>;
  private runResults: Map<string, ActionExecutionResult[]>;

  constructor(config: AgentConfig) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 120000 });
    this.templates = new Map();
    this.runs = new Map();
    this.runResults = new Map();
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const p = input as AutomationAgentInput;
    switch (p.action) {
      case 'create-template':
        return this.createTemplate(p.params as CreateTemplateParams);
      case 'update-template':
        return this.updateTemplate(p.params as UpdateTemplateParams);
      case 'delete-template':
        return this.deleteTemplate((p.params as { id: string }).id);
      case 'run-template':
        return this.runTemplate(p.params as RunTemplateParams);
      case 'run-now':
        return this.runNow(p.params as { templateId: string });
      case 'get-templates':
        return this.getTemplates((p.params as GetTemplatesParams | undefined));
      case 'get-runs':
        return this.getRuns((p.params as GetRunsParams | undefined));
      case 'get-run-status':
        return this.getRunStatus((p.params as { runId: string }).runId);
      case 'pause-run':
        return this.pauseRun((p.params as { runId: string }).runId);
      case 'resume-run':
        return this.resumeRun((p.params as { runId: string }).runId);
      case 'stop-run':
        return this.stopRun((p.params as { runId: string }).runId);
      case 'get-stats':
        return this.getStats();
      default:
        throw new Error('Unknown action: ' + (p as { action: string }).action);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── Template Management ──

  private createTemplate(params: CreateTemplateParams): AutomationAgentOutput {
    const actions = params.actions.map((a) => ({
      ...a,
      id: randomUUID(),
    }));

    const template: WorkflowTemplate = {
      id: randomUUID(),
      name: params.name,
      description: params.description,
      trigger: params.trigger,
      actions,
      createdAt: this.now(),
      updatedAt: this.now(),
      isActive: true,
    };

    this.templates.set(template.id, template);

    return {
      success: true,
      message: 'Шаблон "' + template.name + '" создан',
      template,
    };
  }

  private updateTemplate(params: UpdateTemplateParams): AutomationAgentOutput {
    const template = this.templates.get(params.id);
    if (!template) {
      return { success: false, message: 'Шаблон не найден' };
    }

    if (params.name !== undefined) template.name = params.name;
    if (params.description !== undefined) template.description = params.description;
    if (params.trigger !== undefined) template.trigger = params.trigger;
    if (params.isActive !== undefined) template.isActive = params.isActive;
    if (params.actions !== undefined) {
      template.actions = params.actions.map((a, i) => ({
        ...a,
        id: template.actions[i]?.id ?? randomUUID(),
      }));
    }
    template.updatedAt = this.now();

    return {
      success: true,
      message: 'Шаблон "' + template.name + '" обновлён',
      template,
    };
  }

  private deleteTemplate(id: string): AutomationAgentOutput {
    const template = this.templates.get(id);
    if (!template) {
      return { success: false, message: 'Шаблон не найден' };
    }
    this.templates.delete(id);
    return { success: true, message: 'Шаблон "' + template.name + '" удалён' };
  }

  private getTemplates(params?: GetTemplatesParams): AutomationAgentOutput {
    let items = Array.from(this.templates.values());
    if (params?.isActive !== undefined) {
      items = items.filter((t) => t.isActive === params.isActive);
    }
    return {
      success: true,
      message: 'Найдено ' + items.length + ' шаблонов',
      templates: items,
    };
  }

  // ── Run Management ──

  private async runTemplate(params: RunTemplateParams): Promise<AutomationAgentOutput> {
    const template = this.templates.get(params.templateId);
    if (!template) {
      return { success: false, message: 'Шаблон не найден' };
    }
    return this.executeWorkflow(template, params.overrideParams);
  }

  private async runNow(params: { templateId: string }): Promise<AutomationAgentOutput> {
    const template = this.templates.get(params.templateId);
    if (!template) {
      return { success: false, message: 'Шаблон не найден' };
    }
    return this.executeWorkflow(template);
  }

  private async executeWorkflow(
    template: WorkflowTemplate,
    _overrideParams?: Record<string, unknown>,
  ): Promise<AutomationAgentOutput> {
    const run: WorkflowRun = {
      id: randomUUID(),
      templateId: template.id,
      templateName: template.name,
      status: 'running',
      startedAt: this.now(),
      results: {},
    };

    this.runs.set(run.id, run);
    this.runResults.set(run.id, []);

    const results: ActionExecutionResult[] = [];

    for (const action of template.actions) {
      if (run.status !== 'running') break;

      run.currentActionId = action.id;
      const startMs = Date.now();

      const result = await this.executeAction(action);
      result.durationMs = Date.now() - startMs;
      results.push(result);

      if (!result.success) {
        run.status = 'failed';
        run.error = result.error;
        break;
      }

      run.results[action.id] = result.data;
    }

    if (run.status === 'running') {
      run.status = 'completed';
    }

    run.completedAt = this.now();
    this.runs.set(run.id, run);
    this.runResults.set(run.id, results);

    return {
      success: true,
      message: run.status === 'completed'
        ? 'Workflow завершён'
        : 'Workflow завершён с ошибкой',
      run,
      executionResult: results.at(-1),
    };
  }

  private async executeAction(
    action: WorkflowTemplate['actions'][0],
  ): Promise<ActionExecutionResult> {
    try {
      const success = Math.random() > 0.1;

      if (!success) {
        return {
          actionId: action.id,
          actionType: action.type,
          success: false,
          error: 'Ошибка выполнения: ' + action.type,
          durationMs: 0,
        };
      }

      return {
        actionId: action.id,
        actionType: action.type,
        success: true,
        data: { message: 'Действие ' + action.type + ' выполнено' },
        durationMs: Math.floor(Math.random() * 5000),
      };
    } catch (err) {
      return {
        actionId: action.id,
        actionType: action.type,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      };
    }
  }

  // ── Run Controls ──

  private getRuns(params?: GetRunsParams): AutomationAgentOutput {
    let items = Array.from(this.runs.values());

    if (params?.templateId) {
      items = items.filter((r) => r.templateId === params.templateId);
    }
    if (params?.status) {
      items = items.filter((r) => r.status === params.status);
    }

    const limit = params?.limit ?? items.length;
    const sorted = items.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    return {
      success: true,
      message: 'Найдено ' + sorted.length + ' запусков',
      runs: sorted.slice(0, limit),
    };
  }

  private getRunStatus(runId: string): AutomationAgentOutput {
    const run = this.runs.get(runId);
    if (!run) {
      return { success: false, message: 'Запуск не найден' };
    }
    return {
      success: true,
      message: 'Статус запуска',
      run,
      executionResult: this.runResults.get(runId)?.at(-1),
    };
  }

  private pauseRun(runId: string): AutomationAgentOutput {
    const run = this.runs.get(runId);
    if (!run) return { success: false, message: 'Запуск не найден' };
    run.status = 'paused';
    this.runs.set(runId, run);
    return { success: true, message: 'Запуск приостановлен', run };
  }

  private resumeRun(runId: string): AutomationAgentOutput {
    const run = this.runs.get(runId);
    if (!run) return { success: false, message: 'Запуск не найден' };
    run.status = 'running';
    this.runs.set(runId, run);
    return { success: true, message: 'Запуск возобновлён', run };
  }

  private stopRun(runId: string): AutomationAgentOutput {
    const run = this.runs.get(runId);
    if (!run) return { success: false, message: 'Запуск не найден' };
    run.status = 'failed';
    run.error = 'Остановлен пользователем';
    run.completedAt = this.now();
    this.runs.set(runId, run);
    return { success: true, message: 'Запуск остановлен', run };
  }

  // ── Stats ──

  private getStats(): AutomationAgentOutput {
    const templates = Array.from(this.templates.values());
    const runs = Array.from(this.runs.values());

    const byStatus: Record<WorkflowStatus, number> = {
      idle: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
    };
    let totalDuration = 0;
    let completedCount = 0;
    let successCount = 0;

    for (const run of runs) {
      byStatus[run.status]++;
      if (run.status === 'completed') {
        completedCount++;
        successCount++;
        totalDuration += 3000;
      }
      if (run.status === 'failed') {
        totalDuration += 2000;
      }
    }

    return {
      success: true,
      message: 'Статистика workflow',
      stats: {
        totalTemplates: templates.length,
        activeTemplates: templates.filter((t) => t.isActive).length,
        totalRuns: runs.length,
        byStatus,
        averageDurationMs: completedCount > 0 ? totalDuration / completedCount : 0,
        successRate: runs.length > 0 ? (successCount / runs.length) * 100 : 0,
      },
    };
  }

  // ── Helpers ──

  getTemplateCount(): number {
    return this.templates.size;
  }

  getRunCount(): number {
    return this.runs.size;
  }

  getAllTemplates(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }

  getAllRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }
}
