/**
 * DirectorAgentFacade — фасад делегирования задач реальным агентам.
 *
 * Director решает, КАКИЕ агенты нужны (см. delegation-planner), а этот
 * фасад запускает именно их и собирает результаты в AgentResultEntry[].
 *
 * Принципы:
 * - Агенты получают ТОЛЬКО копии фактов (факты не мутируются).
 * - Детерминированные агенты (analysis/strategist/scenario) вызываются
 *   напрямую; research/ai/review могут быть заменены инжектируемыми
 *   исполнителями (в тестах и при отсутствии сетевых провайдеров).
 * - AI имеет полную свободу решения: исполнитель может не соглашаться
 *   с PortfolioMath и с USER_TARGET_PERCENT.
 */

import type { AiAction } from '../../research/types.js';
import type { AssetAnalysis } from '../../portfolio-math/portfolio-math.js';
import { NewsDriver } from '../news-driver/news-driver.js';
import type { NewsCacheLike, NewsImpact } from '../news-driver/types.js';
import type { ActivityStream } from '../agent-activity/activity-stream.js';
import type { AgentActivityEvent } from '../agent-activity/types.js';
import {
  StrategistAgent,
  type StrategistAgentOutput,
  type StrategistProposal,
} from '../agents/strategist-agent.js';
import {
  ScenarioAgent,
  type ScenarioAgentOutput,
  type ScenarioChange,
} from '../agents/scenario-agent.js';
import type { DirectorActionAgents } from '../agents/agent-factory.js';
import type { FileAgentInput, FileAgentOutput } from '../agents/file-agent.js';
import type {
  ProcessAgentInput,
  ProcessAgentOutput,
} from '../agents/process-agent.js';
import type {
  PackageAgentInput,
  PackageAgentOutput,
} from '../agents/package-agent.js';
import type {
  SystemResourceInput,
  SystemResourceOutput,
} from '../agents/system-resource-agent.js';
import type {
  TerminalAgentInput,
  TerminalAgentOutput,
} from '../agents/terminal-agent.js';
import type {
  AutomationAgentInput,
  AutomationAgentOutput,
} from '../agents/automation-agent/types.js';
import type {
  CodingWorkflowInput,
  CodingWorkflowOutput,
} from '../coding-workflow/types.js';
import {
  buildAutomationAgentInput,
  buildCodingWorkflowInput,
  buildFileAgentInput,
  buildPackageAgentInput,
  buildProcessAgentInput,
  buildSystemResourceInput,
  buildTerminalAgentInput,
} from './action-input-builder.js';
import type {
  SecurityActionRequest,
  SecurityDecision,
} from '../agents/security-agent.js';
import type {
  AgentOpinion,
  AgentResultEntry,
  AgentRole,
  DirectorFactsContext,
  InterpretedQuestion,
} from './director-types.js';

// ──────────────────────────────────────────────
// 1. Типы исполнителей
// ──────────────────────────────────────────────

/** Запрос на формирование мнения AI */
export interface AiDecisionRequest {
  question: InterpretedQuestion;
  facts: DirectorFactsContext;
  /** Результаты других агентов (для полноты контекста) */
  agentResults: AgentResultEntry[];
  /** Новостные impact'ы (NewsDriver) — влияют на мнение AI */
  newsImpacts?: readonly NewsImpact[];
}

/** Исполнитель инвестиционного reasoning (роль ai) */
export type AiDecisionExecutor = (
  req: AiDecisionRequest,
) => Promise<AgentOpinion>;

/** Исполнитель контроля качества (роль review) */
export interface ReviewExecutorResult {
  warnings: string[];
  summary: string;
  confidence: number;
}
export type ReviewExecutor = (
  req: AiDecisionRequest,
) => Promise<ReviewExecutorResult>;

/**
 * Карта подключённых action-агентов (file/terminal/process/automation/code).
 * ЕДИНЫЙ источник типа — agents/agent-factory.ts (Node-контур, там же
 * фабрика). Type-only импорт стирается при сборке: в браузерной сборке
 * агентов нет → фасад честно отвечает «доступно в десктопном режиме».
 */
export type { DirectorActionAgents } from '../agents/agent-factory.js';

/**
 * Шлюз безопасности action-операций (обёртка над SecurityAgent).
 * Метод `check` возвращает вердикт ДО выполнения операции.
 */
export interface ActionSecurityGate {
  check(
    request: SecurityActionRequest,
  ): SecurityDecision | Promise<SecurityDecision>;
}

/**
 * Входы action-агентов из извлечённой задачи (роль → вход).
 * Позволяет передать структурированный вход (FileAgentInput,
 * TerminalAgentInput, ...) напрямую, минуя повторный парсинг текста.
 */
export type TaskRoleInputs = Partial<Record<AgentRole, unknown>>;

/** Опции фасада (DI) */
export interface DirectorFacadeOptions {
  strategist?: StrategistAgent;
  scenario?: ScenarioAgent;
  aiExecutor?: AiDecisionExecutor;
  reviewExecutor?: ReviewExecutor;
  /** Action-агенты (file/terminal) — только для Node-контура */
  actionAgents?: DirectorActionAgents;
  /** Шлюз безопасности action-операций (SecurityAgent) */
  security?: ActionSecurityGate;
  /** Стрим активности агентов (для живых шагов в UI) */
  activity?: ActivityStream;
  /** Новостной драйвер (роль research/ai использует новостной фон) */
  newsDriver?: NewsDriver;
  /** Кэш новостей (gatekeeper); без него новостной фон не анализируется */
  newsCache?: NewsCacheLike;
}

/** Содержимое результата агента (данные внутри AgentResultEntry.data) */
export interface DirectorAgentPayload {
  /** Мнение агента (для Consilium) */
  opinion?: AgentOpinion;
  /** Человекочитаемая сводка работы агента */
  summary: string;
  /** Ссылки на фактические источники */
  sources: string[];
  /** Дополнительные данные (для детализации в UI) */
  detail?: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// 2. Фасад
// ──────────────────────────────────────────────

/**
 * Фасад делегирования: запускает нужные роли и возвращает результаты.
 */
export class DirectorAgentFacade {
  private readonly strategist: StrategistAgent;
  private readonly scenario: ScenarioAgent;
  private readonly aiExecutor: AiDecisionExecutor;
  private readonly reviewExecutor: ReviewExecutor;
  private readonly actionAgents?: DirectorActionAgents;
  private readonly security?: ActionSecurityGate;
  private readonly activity?: ActivityStream;
  private readonly newsDriver: NewsDriver;
  private readonly newsCache?: NewsCacheLike;

  constructor(opts?: DirectorFacadeOptions) {
    this.strategist = opts?.strategist ?? new StrategistAgent();
    this.scenario = opts?.scenario ?? new ScenarioAgent();
    this.aiExecutor = opts?.aiExecutor ?? defaultAiExecutor;
    this.reviewExecutor = opts?.reviewExecutor ?? defaultReviewExecutor;
    this.actionAgents = opts?.actionAgents;
    this.security = opts?.security;
    this.activity = opts?.activity;
    this.newsDriver = opts?.newsDriver ?? new NewsDriver();
    this.newsCache = opts?.newsCache;
  }

  /**
   * Новостные impact'ы по портфелю (NewsDriver).
   * Пусто, если кэш новостей не подключён.
   */
  private analyzeNews(facts: DirectorFactsContext): NewsImpact[] {
    if (!this.newsCache) return [];
    return this.newsDriver.analyzePortfolio(facts, this.newsCache);
  }

  /**
   * Опубликовать событие активности агента (no-op без подключённого стрима).
   */
  private emitActivity(
    phase: AgentActivityEvent['phase'],
    role: AgentRole,
    taskId: string,
    message: string,
    detail?: Record<string, unknown>,
    durationMs?: number,
  ): void {
    this.activity?.emit({
      taskId,
      role,
      phase,
      message,
      detail,
      durationMs,
    });
  }

  /**
   * Выполнить роли, выбранные Director.
   * Результаты сохраняют оригинальные факты — входные данные не мутируются.
   */
  async executeRoles(
    roles: AgentRole[],
    question: InterpretedQuestion,
    facts: DirectorFactsContext,
    taskInputs?: TaskRoleInputs,
  ): Promise<AgentResultEntry[]> {
    const uniqueRoles = [...new Set(roles)];
    const results: AgentResultEntry[] = [];

    // Все задачи запускаются параллельно (независимые агенты)
    const tasks = uniqueRoles.map(async (role) => {
      const startedAt = Date.now();
      const taskId = `${question.topic}-${role}`;
      this.emitActivity('started', role, taskId, 'стартовал');
      try {
        const payload = await this.executeRole(
          role,
          question,
          facts,
          taskId,
          taskInputs,
        );
        const durationMs = Date.now() - startedAt;
        this.emitActivity(
          'completed',
          role,
          taskId,
          'готово',
          undefined,
          durationMs,
        );
        return this.makeEntry(role, true, payload, startedAt, question);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emitActivity('failed', role, taskId, `ошибка: ${message}`);
        return this.makeEntry(
          role,
          false,
          {
            summary: `Агент «${role}» не выполнен: ${message}`,
            sources: [],
          },
          startedAt,
          question,
          err,
        );
      }
    });

    const entries = await Promise.all(tasks);
    for (const entry of entries) {
      results.push(entry);
    }
    return results;
  }

  /**
   * Выполнить одну роль. Эмитит step-события для фаз роли
   * (например, security-gate → выполнение для action-ролей).
   */
  private async executeRole(
    role: AgentRole,
    question: InterpretedQuestion,
    facts: DirectorFactsContext,
    taskId: string,
    taskInputs?: TaskRoleInputs,
  ): Promise<DirectorAgentPayload> {
    const overrideInput = taskInputs?.[role];
    switch (role) {
      case 'analysis':
        this.emitActivity(
          'step',
          role,
          taskId,
          'анализирую структуру портфеля',
        );
        return analyzeStructure(question, facts);
      case 'research': {
        this.emitActivity(
          'step',
          role,
          taskId,
          `собираю факты по ${question.tickers.join(', ') || 'портфелю'}`,
        );
        const newsImpacts = this.analyzeNews(facts);
        return summarizeResearch(question, facts, newsImpacts);
      }
      case 'ai': {
        this.emitActivity('step', role, taskId, 'формирую мнение');
        const newsImpacts = this.analyzeNews(facts);
        const opinion = await this.aiExecutor({
          question,
          facts,
          agentResults: [],
          newsImpacts,
        });
        return {
          opinion,
          summary:
            `AI Agent: «${opinion.action ?? 'нет действия'}» ` +
            `(уверенность ${Math.round(opinion.confidence * 100)}%).`,
          sources: factSources(facts),
        };
      }
      case 'strategist':
        this.emitActivity(
          'step',
          role,
          taskId,
          'провожу стратегический анализ',
        );
        return this.runStrategist(question, facts);
      case 'scenario':
        this.emitActivity('step', role, taskId, 'строю сценарии «что если»');
        return this.runScenario(question, facts);
      case 'review': {
        this.emitActivity('step', role, taskId, 'проверяю качество решения');
        const review = await this.reviewExecutor({
          question,
          facts,
          agentResults: [],
        });
        return {
          opinion: {
            role: 'review',
            position:
              review.warnings.length > 0
                ? `Обнаружено замечаний: ${review.warnings.length}.`
                : 'Замечаний нет.',
            action: null,
            confidence: review.confidence,
            arguments: review.warnings,
          },
          summary: `ReviewAgent: ${review.summary}`,
          sources: factSources(facts),
        };
      }
      case 'file':
        this.emitActivity(
          'step',
          role,
          taskId,
          'проверка безопасности → выполнение',
        );
        return this.runFileRole(question, overrideInput);
      case 'terminal':
        this.emitActivity(
          'step',
          role,
          taskId,
          'проверка безопасности → выполнение',
        );
        return this.runTerminalRole(question, overrideInput);
      case 'package':
        this.emitActivity(
          'step',
          role,
          taskId,
          'выполняю операцию с зависимостями',
        );
        return this.runPackageRole(question, overrideInput);
      case 'system':
        this.emitActivity(
          'step',
          role,
          taskId,
          'снимаю показатели системных ресурсов',
        );
        return this.runSystemRole(question, overrideInput);
      case 'process':
        this.emitActivity(
          'step',
          role,
          taskId,
          'проверка безопасности → выполнение',
        );
        return this.runProcessRole(question, overrideInput);
      case 'automation':
        this.emitActivity(
          'step',
          role,
          taskId,
          'проверка безопасности → выполнение',
        );
        return this.runAutomationRole(question, overrideInput);
      case 'code':
        this.emitActivity(
          'step',
          role,
          taskId,
          'проверка безопасности → конвейер разработки',
        );
        return this.runCodeRole(question, overrideInput);
      default:
        return {
          summary: `Роль «${role}» не реализована`,
          sources: [],
        };
    }
  }

  /**
   * Роль file: парсинг запроса → security-gate → выполнение FileAgent.
   * Без подключённого агента (браузерный контур) — человечный ответ.
   */
  private async runFileRole(
    question: InterpretedQuestion,
    overrideInput?: unknown,
  ): Promise<DirectorAgentPayload> {
    const agent = this.actionAgents?.file;
    if (!agent) {
      return {
        summary: 'Файловые операции доступны в десктопном режиме',
        sources: [],
      };
    }

    const intent =
      (overrideInput as FileAgentInput | undefined) ??
      buildFileAgentInput(question);
    if (!intent) {
      return {
        summary: `Не удалось распознать файловую операцию в запросе: «${question.text}»`,
        sources: [],
      };
    }

    if (this.security) {
      const decision = await this.security.check({
        kind: 'file',
        path: intent.path,
        action: intent.action,
        description: `Файловая операция «${intent.action}» для «${intent.path ?? ''}»`,
      });
      if (decision.verdict === 'deny') {
        return {
          summary: `Операция отклонена: ${
            decision.reason ?? decision.description ?? 'политика безопасности'
          }`,
          sources: [],
          detail: { matchedRules: decision.matchedRules },
        };
      }
      if (decision.verdict === 'require-confirmation') {
        return {
          summary: `Требуется подтверждение: ${
            decision.description ??
            decision.reason ??
            'подтвердите операцию вручную'
          }`,
          sources: [],
          detail: {
            matchedRules: decision.matchedRules,
            dangerLevel: decision.dangerLevel,
          },
        };
      }
    }

    const result = await agent.execute(intent);
    if (!result.success || !result.data) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? 'неизвестная ошибка');
      return {
        summary: `Файловая операция не выполнена: ${message}`,
        sources: [],
      };
    }
    const output = result.data as FileAgentOutput;
    return {
      summary: output.message,
      sources: [],
      detail: { action: output.action, path: output.path },
    };
  }

  /**
   * Роль terminal: парсинг запроса → security-gate → выполнение TerminalAgent.
   */
  private async runTerminalRole(
    question: InterpretedQuestion,
    overrideInput?: unknown,
  ): Promise<DirectorAgentPayload> {
    const agent = this.actionAgents?.terminal;
    if (!agent) {
      return {
        summary: 'Терминальные операции доступны в десктопном режиме',
        sources: [],
      };
    }

    const intent =
      (overrideInput as TerminalAgentInput | undefined) ??
      buildTerminalAgentInput(question);
    if (!intent) {
      return {
        summary: `Не удалось распознать команду в запросе: «${question.text}»`,
        sources: [],
      };
    }

    if (this.security) {
      const decision = await this.security.check({
        kind: 'terminal',
        command: intent.command,
        args: intent.args,
        description: `Терминальная команда «${[intent.command, ...(intent.args ?? [])].join(' ')}»`,
      });
      if (decision.verdict === 'deny') {
        return {
          summary: `Операция отклонена: ${
            decision.reason ?? decision.description ?? 'политика безопасности'
          }`,
          sources: [],
          detail: { matchedRules: decision.matchedRules },
        };
      }
      if (decision.verdict === 'require-confirmation') {
        return {
          summary: `Требуется подтверждение: ${
            decision.description ??
            decision.reason ??
            'подтвердите операцию вручную'
          }`,
          sources: [],
          detail: {
            matchedRules: decision.matchedRules,
            dangerLevel: decision.dangerLevel,
          },
        };
      }
    }

    const result = await agent.execute(intent);
    if (!result.success || !result.data) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? 'неизвестная ошибка');
      return {
        summary: `Команда не выполнена: ${message}`,
        sources: [],
      };
    }
    const output = result.data as TerminalAgentOutput;
    const summary =
      output.exitCode === 0
        ? `Команда выполнена: ${output.command}`
        : `Команда завершилась с ошибкой (exit ${output.exitCode}): ${
            output.stderr || output.stdout || 'без вывода'
          }`;
    return {
      summary,
      sources: [],
      detail: { ...output },
    };
  }

  /**
   * Роль package: парсинг запроса → выполнение PackageAgent.
   * PackageAgent сам ограничен whitelist-командами npm/pip и
   * блокирует мутации при error-конфликтах манифеста.
   */
  private async runPackageRole(
    question: InterpretedQuestion,
    overrideInput?: unknown,
  ): Promise<DirectorAgentPayload> {
    const agent = this.actionAgents?.package;
    if (!agent) {
      return {
        summary: 'Управление зависимостями доступно в десктопном режиме',
        sources: [],
      };
    }

    const intent =
      (overrideInput as PackageAgentInput | undefined) ??
      buildPackageAgentInput(question);
    if (!intent) {
      return {
        summary: `Не удалось распознать операцию с зависимостями в запросе: «${question.text}»`,
        sources: [],
      };
    }

    const result = await agent.execute(intent);
    if (!result.success || !result.data) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? 'неизвестная ошибка');
      return {
        summary: `Операция с зависимостями не выполнена: ${message}`,
        sources: [],
      };
    }
    const output = result.data as PackageAgentOutput;
    return {
      summary: output.message,
      sources: [],
      detail: {
        action: output.action,
        manager: output.manager,
        commands: output.commands,
        conflicts: output.conflicts,
        changed: output.changed,
      },
    };
  }

  /**
   * Роль system: снимок системных ресурсов (CPU/RAM) через
   * SystemResourceAgent. Операция только для чтения — security-gate
   * не требуется.
   */
  private async runSystemRole(
    question: InterpretedQuestion,
    overrideInput?: unknown,
  ): Promise<DirectorAgentPayload> {
    const agent = this.actionAgents?.system;
    if (!agent) {
      return {
        summary: 'Мониторинг системных ресурсов доступен в десктопном режиме',
        sources: [],
      };
    }

    const intent =
      (overrideInput as SystemResourceInput | undefined) ??
      buildSystemResourceInput(question);
    if (!intent) {
      return {
        summary: `Не удалось распознать запрос о системных ресурсах: «${question.text}»`,
        sources: [],
      };
    }

    const result = await agent.execute(intent);
    if (!result.success || !result.data) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? 'неизвестная ошибка');
      return {
        summary: `Снимок системных ресурсов не выполнен: ${message}`,
        sources: [],
      };
    }
    const output = result.data as SystemResourceOutput;
    return {
      summary: output.message,
      sources: [],
      detail: { ...output },
    };
  }

  /**
   * Роль process: парсинг запроса → security-gate → выполнение ProcessAgent.
   * start/stop/restart проверяются ДО выполнения (kind 'process'); status
   * безопасен и не требует проверки.
   */
  private async runProcessRole(
    question: InterpretedQuestion,
    overrideInput?: unknown,
  ): Promise<DirectorAgentPayload> {
    const agent = this.actionAgents?.process;
    if (!agent) {
      return {
        summary: 'Управление процессами доступно в десктопном режиме',
        sources: [],
      };
    }

    const intent =
      (overrideInput as ProcessAgentInput | undefined) ??
      buildProcessAgentInput(question);
    if (!intent) {
      return {
        summary: `Не удалось распознать операцию с процессом в запросе: «${question.text}»`,
        sources: [],
      };
    }

    if (this.security && intent.action !== 'status') {
      const commandLine = [
        intent.command ?? '',
        ...(intent.args ?? []),
        ...(intent.name !== undefined ? [String(intent.name)] : []),
      ]
        .filter(Boolean)
        .join(' ');
      const decision = await this.security.check({
        kind: 'process',
        command: commandLine || String(intent.name ?? ''),
        description: `Операция с процессами «${intent.action}»`,
      });
      if (decision.verdict === 'deny') {
        return {
          summary: `Операция отклонена: ${
            decision.reason ?? decision.description ?? 'политика безопасности'
          }`,
          sources: [],
          detail: { matchedRules: decision.matchedRules },
        };
      }
      if (decision.verdict === 'require-confirmation') {
        return {
          summary: `Требуется подтверждение: ${
            decision.description ??
            decision.reason ??
            'подтвердите операцию вручную'
          }`,
          sources: [],
          detail: {
            matchedRules: decision.matchedRules,
            dangerLevel: decision.dangerLevel,
          },
        };
      }
    }

    const result = await agent.execute(intent);
    if (!result.success || !result.data) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? 'неизвестная ошибка');
      return {
        summary: `Операция с процессами не выполнена: ${message}`,
        sources: [],
      };
    }
    const output = result.data as ProcessAgentOutput;
    return {
      summary: output.message,
      sources: [],
      detail: { action: output.action, processes: output.processes },
    };
  }

  /**
   * Роль automation: парсинг запроса → security-gate → AutomationAgent.
   * Чтения (get-*) безопасны; запуск workflow проверяется как операция с
   * процессами (внутри workflow могут выполняться команды).
   */
  private async runAutomationRole(
    question: InterpretedQuestion,
    overrideInput?: unknown,
  ): Promise<DirectorAgentPayload> {
    const agent = this.actionAgents?.automation;
    if (!agent) {
      return {
        summary: 'Автоматизация workflow доступна в десктопном режиме',
        sources: [],
      };
    }

    const intent =
      (overrideInput as AutomationAgentInput | undefined) ??
      buildAutomationAgentInput(question);
    if (!intent) {
      return {
        summary:
          `Не удалось распознать операцию автоматизации в запросе: «${question.text}». ` +
          'Создание и редактирование шаблонов задаётся программно или через UI.',
        sources: [],
      };
    }

    if (
      this.security &&
      (intent.action === 'run-now' || intent.action === 'run-template')
    ) {
      const templateId =
        intent.action === 'run-now'
          ? intent.params.templateId
          : (intent.params as { templateId?: string }).templateId;
      const decision = await this.security.check({
        kind: 'process',
        command: `automation run ${templateId ?? ''}`.trim(),
        description: `Запуск workflow «${templateId ?? ''}»`,
      });
      if (decision.verdict === 'deny') {
        return {
          summary: `Операция отклонена: ${
            decision.reason ?? decision.description ?? 'политика безопасности'
          }`,
          sources: [],
          detail: { matchedRules: decision.matchedRules },
        };
      }
      if (decision.verdict === 'require-confirmation') {
        return {
          summary: `Требуется подтверждение: ${
            decision.description ??
            decision.reason ??
            'подтвердите операцию вручную'
          }`,
          sources: [],
          detail: {
            matchedRules: decision.matchedRules,
            dangerLevel: decision.dangerLevel,
          },
        };
      }
    }

    const result = await agent.execute(intent);
    if (!result.success || !result.data) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? 'неизвестная ошибка');
      return {
        summary: `Операция автоматизации не выполнена: ${message}`,
        sources: [],
      };
    }
    const output = result.data as AutomationAgentOutput;
    return {
      summary: output.message,
      sources: [],
      detail: {
        success: output.success,
        run: output.run ?? null,
        stats: output.stats ?? null,
      },
    };
  }

  /**
   * Роль code: конвейер разработки (write → test → analyze → repair →
   * retest → report). Целиком проходит security-gate; файлы/проверки
   * внутри выполняют FileAgent/TerminalAgent со своими whitelist'ами.
   */
  private async runCodeRole(
    question: InterpretedQuestion,
    overrideInput?: unknown,
  ): Promise<DirectorAgentPayload> {
    const agent = this.actionAgents?.code;
    if (!agent) {
      return {
        summary: 'Разработка кода доступна в десктопном режиме',
        sources: [],
      };
    }

    const intent =
      (overrideInput as CodingWorkflowInput | undefined) ??
      buildCodingWorkflowInput(question);
    if (!intent || intent.files.length === 0) {
      return {
        summary:
          'Не удалось определить файлы для разработки из запроса. Укажите ' +
          'пути (например: «Реализуй функционал в src/js/modules/x/y.ts») ' +
          'или задайте цель через GoalAgent для автономного цикла.',
        sources: [],
      };
    }

    if (this.security) {
      const decision = await this.security.check({
        kind: 'process',
        command: 'coding-workflow',
        description: `Разработка кода: ${intent.files.map((file) => file.path).join(', ')}`,
      });
      if (decision.verdict === 'deny') {
        return {
          summary: `Операция отклонена: ${
            decision.reason ?? decision.description ?? 'политика безопасности'
          }`,
          sources: [],
          detail: { matchedRules: decision.matchedRules },
        };
      }
      if (decision.verdict === 'require-confirmation') {
        return {
          summary: `Требуется подтверждение: ${
            decision.description ??
            decision.reason ??
            'подтвердите разработку вручную'
          }`,
          sources: [],
          detail: {
            matchedRules: decision.matchedRules,
            dangerLevel: decision.dangerLevel,
          },
        };
      }
    }

    const result = await agent.execute(intent);
    if (!result.success || !result.data) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error ?? 'неизвестная ошибка');
      return {
        summary: `Разработка не выполнена: ${message}`,
        sources: [],
      };
    }
    const output = result.data as CodingWorkflowOutput;
    return {
      summary: output.message,
      sources: [],
      detail: {
        testPassed: output.testPassed,
        repairIterations: output.repairIterations,
        filesWritten: output.filesWritten,
        steps: output.steps,
      },
    };
  }

  /**
   * Запустить полный pipeline-анализ портфеля (для ленивой загрузки).
   * Возвращает сводку результатов анализа.
   */
  async runFullAnalysis(facts: DirectorFactsContext): Promise<string> {
    // Создаём фиктивный вопрос для запуска всех ролей
    const dummyQuestion: InterpretedQuestion = {
      category: 'portfolio',
      tickers: [],
      topic: 'Полный анализ портфеля',
      text: 'Проведи полный анализ портфеля',
      requiredAgents: [
        'analysis',
        'research',
        'ai',
        'strategist',
        'scenario',
        'review',
      ],
      needsConsilium: true,
      complexity: 5,
      intent: 'understand',
    };

    // Запускаем все роли параллельно
    const results = await this.executeRoles(
      ['analysis', 'research', 'ai', 'strategist', 'scenario', 'review'],
      dummyQuestion,
      facts,
    );

    // Формируем сводку
    const summaryLines: string[] = [];
    for (const result of results) {
      if (result.success && result.data) {
        const data = result.data as unknown as DirectorAgentPayload;
        summaryLines.push(data.summary);
      } else {
        summaryLines.push(
          `Ошибка ${result.role}: ${result.error || 'неизвестно'}`,
        );
      }
    }

    return `Pipeline-анализ завершён:\n${summaryLines.join('\n')}`;
  }

  /** StrategistAgent: независимая оценка рисков (реальный агент, синхронно) */
  private async runStrategist(
    question: InterpretedQuestion,
    facts: DirectorFactsContext,
  ): Promise<DirectorAgentPayload> {
    const assets = toAssetAnalysisList(facts.assetsAnalysis);
    const proposals = buildProposals(facts, assets);

    const result = await this.strategist.execute({
      assetsAnalysis: assets,
      proposals,
    });
    const output = result.data as StrategistAgentOutput | undefined;

    const decisions = output?.decisions ?? [];
    const notes = decisions
      .filter((d) => d.note)
      .map((d) => `${d.ticker}: ${d.note}`);

    // Мнение стратега: независимое, может отличаться от AI
    const opinion = buildStrategistOpinion(question, facts, decisions);

    return {
      opinion,
      summary:
        `StrategistAgent: проверено активов — ${output?.summary.assetsChecked ?? 0}; ` +
        (notes.length > 0
          ? `замечания: ${notes.slice(0, 3).join('; ')}.`
          : 'замечаний нет.'),
      sources: ['PortfolioMath (структура)', 'P&L портфеля'],
      detail: { decisions },
    };
  }

  /** ScenarioAgent: сценарии «что если» (реальный агент, синхронно) */
  private async runScenario(
    _question: InterpretedQuestion,
    facts: DirectorFactsContext,
  ): Promise<DirectorAgentPayload> {
    const assets = toAssetAnalysisList(facts.assetsAnalysis);
    const proposedChanges = buildProposedChanges(facts);

    const result = await this.scenario.execute({
      assetsAnalysis: assets,
      totalPortfolioValue: facts.totalPortfolioValue,
      freeCashRub: facts.freeCashRub,
      proposedChanges,
    });
    const output = result.data as ScenarioAgentOutput | undefined;

    const best = output?.scenarios.find((s) => s.id === output?.bestScenarioId);
    const summaryParts: string[] = [
      `ScenarioAgent: построено сценариев — ${output?.scenarios.length ?? 0}.`,
    ];
    if (best) {
      summaryParts.push(`Лучший: ${best.title} (${best.verdict}).`);
    }

    return {
      opinion: {
        role: 'scenario',
        position:
          best?.verdict === 'WORSENS'
            ? 'Лучший сценарий ухудшает структуру — альтернативы не найдено.'
            : best
              ? `Лучший сценарий: ${best.title}.`
              : 'Сценарии не построены.',
        action: best?.changes[0]?.action ?? null,
        confidence: 0.65,
        arguments:
          output?.scenarios.map((s) => `${s.id}: ${s.rationale}`) ?? [],
      },
      summary: summaryParts.join(' '),
      sources: [
        'PortfolioMath (структура)',
        'P&L портфеля',
        'Свободные средства',
      ],
      detail: {
        scenarios: output?.scenarios ?? [],
        bestScenarioId: output?.bestScenarioId ?? null,
      },
    };
  }

  private makeEntry(
    role: AgentRole,
    success: boolean,
    payload: DirectorAgentPayload,
    startedAt: number,
    question: InterpretedQuestion,
    error?: unknown,
  ): AgentResultEntry {
    return {
      role,
      taskId: `${question.topic}-${role}`,
      success,
      data: success
        ? (payload as unknown as Record<string, unknown>)
        : undefined,
      error: success
        ? undefined
        : error instanceof Error
          ? error.message
          : String(error),
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}

// ──────────────────────────────────────────────
// 3. Детерминированные исполнители по умолчанию
// ──────────────────────────────────────────────

/**
 * Базовый исполнитель роли AI (когда LLM не подключён).
 *
 * Работает ТОЛЬКО с фактами портфеля и имеет полную свободу решения:
 * может не соглашаться с USER_TARGET_PERCENT и с PortfolioMath.
 */
export const defaultAiExecutor: AiDecisionExecutor = async ({
  question,
  facts,
  newsImpacts,
}) => {
  const tickers = question.tickers;
  const assets = facts.assetsAnalysis;

  let asset = assets.find((a) =>
    tickers.some((t) => a.ticker.toUpperCase() === t.toUpperCase()),
  );
  if (!asset && assets.length > 0) {
    asset = assets[0];
  }

  // Свобода решения: если целевые доли не заданы или вопрос не про структуру —
  // AI судит по собственному усмотрению на основе фактов P&L и концентрации.
  if (!asset) {
    return {
      role: 'ai',
      position: 'Нет данных по активу — осторожная позиция.',
      action: 'HOLD',
      confidence: 0.4,
      arguments: [
        'Данные по активу отсутствуют, поэтому менять ничего не следует.',
      ],
    };
  }

  // Новостной фон (NewsDriver): критический негатив по активу перевешивает
  // структурную логику — не докупаем, а пересматриваем позицию.
  const relevantNews = (newsImpacts ?? []).filter(
    (i) =>
      tickers.length === 0 ||
      tickers.some((t) => t.toUpperCase() === i.ticker.toUpperCase()),
  );
  const criticalNegative = relevantNews.find(
    (i) => i.impactDirection === 'negative' && i.importance === 'critical',
  );
  if (criticalNegative) {
    return {
      role: 'ai',
      position: `Критический негатив по ${criticalNegative.ticker} — пересмотреть позицию.`,
      action: 'REDUCE',
      confidence: 0.7,
      arguments: [
        criticalNegative.reasoning,
        'Новостной риск перевешивает структурную логику: сокращение снижает уязвимость.',
      ],
    };
  }

  const drawdown =
    asset.balancePrice && asset.balancePrice > 0 && asset.currentPrice
      ? ((asset.currentPrice - asset.balancePrice) / asset.balancePrice) * 100
      : 0;
  const deviation =
    asset.targetPercent > 0
      ? Math.abs(asset.currentPercent - asset.targetPercent)
      : 0;

  // Инвестиционная логика (не математическая истина):
  if (asset.deficitRub > 0 && facts.freeCashRub > 5000) {
    return {
      role: 'ai',
      position: `Дефицит позиции ${asset.ticker} — докупить в пределах свободных средств.`,
      action: 'BUY',
      confidence: 0.72,
      arguments: [
        `Отклонение от целевой доли ${deviation.toFixed(1)} п.п., дефицит ${Math.round(asset.deficitRub)} ₽.`,
        `Свободные средства: ${Math.round(facts.freeCashRub)} ₽ — достаточно для выравнивания структуры.`,
      ],
    };
  }

  if (
    asset.currentPercent > asset.targetPercent * 1.5 &&
    asset.isConcentrated
  ) {
    return {
      role: 'ai',
      position: `Концентрация по ${asset.ticker} высокая — сократить позицию.`,
      action: 'REDUCE',
      confidence: 0.66,
      arguments: [
        `Доля ${asset.currentPercent.toFixed(1)}% против целевых ${asset.targetPercent.toFixed(1)}%.`,
        'Высокая концентрация повышает риск портфеля; сокращение снизит его без полного выхода.',
      ],
    };
  }

  if (drawdown < -30) {
    return {
      role: 'ai',
      position: `Глубокая просадка по ${asset.ticker} (${drawdown.toFixed(0)}%) — удерживать, не паниковать.`,
      action: 'HOLD',
      confidence: 0.58,
      arguments: [
        `Фиксация убытка ${Math.round(-drawdown)}% маловероятно оправдана без новых фундаментальных причин.`,
        'Рекомендуется проверить фундаментал и рынок перед любым действием.',
      ],
    };
  }

  return {
    role: 'ai',
    position: `Позиция ${asset.ticker} в допустимых пределах — удерживать.`,
    action: 'HOLD',
    confidence: 0.55,
    arguments: [
      `Текущая доля ${asset.currentPercent.toFixed(1)}% близка к целевой ${asset.targetPercent.toFixed(1)}%.`,
      'Оснований для активных действий нет.',
    ],
  };
};

/**
 * Базовый исполнитель роли review: детерминированная проверка качества.
 */
export const defaultReviewExecutor: ReviewExecutor = async ({
  question,
  facts,
}) => {
  const warnings: string[] = [];
  const tickers = question.tickers;

  for (const asset of facts.assetsAnalysis) {
    const relevant =
      tickers.length === 0 ||
      tickers.some((t) => asset.ticker.toUpperCase() === t.toUpperCase());
    if (!relevant) continue;

    if (asset.currentPercent > 25) {
      warnings.push(
        `Концентрация по ${asset.ticker}: ${asset.currentPercent.toFixed(1)}% портфеля — выше разумного уровня.`,
      );
    }
    if (
      asset.balancePrice &&
      asset.balancePrice > 0 &&
      asset.currentPrice &&
      asset.currentPrice < asset.balancePrice * 0.6
    ) {
      warnings.push(
        `Просадка по ${asset.ticker} превышает 40% от цены покупки — проверить тезис.`,
      );
    }
  }

  if (
    facts.newsContext &&
    /санкци|блокировк|конфискаци/i.test(facts.newsContext)
  ) {
    warnings.push(
      'В новостном фоне присутствуют санкционные/блокирующие сигналы.',
    );
  }

  return {
    warnings,
    summary:
      warnings.length > 0
        ? `ReviewAgent: найдено ${warnings.length} замечание(й).`
        : 'ReviewAgent: замечаний не найдено.',
    confidence: warnings.length > 0 ? 0.75 : 0.9,
  };
};

// ──────────────────────────────────────────────
// 4. Helpers
// ──────────────────────────────────────────────

/** Мнение стратега: независимое, основано на концентрации и просадках */
function buildStrategistOpinion(
  question: InterpretedQuestion,
  _facts: DirectorFactsContext,
  decisions: StrategistAgentOutput['decisions'],
): AgentOpinion {
  const tickers = question.tickers;
  const relevant = decisions.filter(
    (d) =>
      tickers.length === 0 ||
      tickers.some((t) => d.ticker.toUpperCase() === t.toUpperCase()),
  );

  const concentrated = relevant.find((d) => (d.concentrationPercent ?? 0) > 25);
  const deepDrawdown = relevant.find((d) => (d.drawdownPercent ?? 0) < -30);

  if (concentrated) {
    return {
      role: 'strategist',
      position: `Стратегический риск: концентрация по ${concentrated.ticker} ${concentrated.concentrationPercent?.toFixed(1)}%.`,
      action: 'REDUCE',
      confidence: 0.6,
      arguments: [
        'Концентрация >25% повышает уязвимость портфеля к движению одного актива.',
        'Сокращение — разумная превентивная мера, но это НЕ блокировка решения AI.',
      ],
    };
  }

  if (deepDrawdown) {
    return {
      role: 'strategist',
      position: `Глубокая просадка по ${deepDrawdown.ticker}: ${deepDrawdown.drawdownPercent?.toFixed(0)}%.`,
      action: null,
      confidence: 0.55,
      arguments: [
        'Устойчивость портфеля под вопросом; решение требует обсуждения.',
        'Стратег не навязывает действие — только обозначает риск.',
      ],
    };
  }

  return {
    role: 'strategist',
    position: 'Структурных аномалий не выявлено.',
    action: null,
    confidence: 0.7,
    arguments: ['Концентрация и просадки в допустимых пределах.'],
  };
}

/** Конвертация фактов в AssetAnalysis[] для реальных агентов (без мутации фактов) */
function toAssetAnalysisList(
  assets: DirectorFactsContext['assetsAnalysis'],
): AssetAnalysis[] {
  return assets.map((a) => ({
    name: a.name ?? a.ticker,
    ticker: a.ticker,
    assetType: 'STOCK' as const,
    currentPercent: a.currentPercent ?? 0,
    targetPercent: a.targetPercent ?? 0,
    deficitRub: a.deficitRub ?? 0,
    status: (a.status as AssetAnalysis['status']) ?? 'STABLE',
    dynamicsPercent: 0,
    nkdRub: 0,
    nominal: 0,
    quantity: a.quantity ?? 0,
    balancePrice: a.balancePrice ?? 0,
    currentPrice: a.currentPrice ?? 0,
    unrealizedProfitRub: a.unrealizedProfitRub ?? 0,
    priority: 0,
    isConcentrated: a.isConcentrated ?? false,
  }));
}

/** Предложения для стратега из фактов + предложений pipeline */
function buildProposals(
  facts: DirectorFactsContext,
  assets: AssetAnalysis[],
): StrategistProposal[] {
  const proposed = facts.proposals ?? [];
  const proposedByTicker = new Map(
    proposed.map((p) => [p.ticker.toUpperCase(), p.action]),
  );
  return assets.map((a) => ({
    ticker: a.ticker,
    action: proposedByTicker.get(a.ticker.toUpperCase()) ?? null,
    keyCatalysts: [],
  }));
}

/** Изменения для сценариста из предложений pipeline или дефицита */
function buildProposedChanges(facts: DirectorFactsContext): ScenarioChange[] {
  const changes: ScenarioChange[] = [];
  const proposed = facts.proposals ?? [];

  for (const p of proposed) {
    if (p.action === 'BUY') {
      const asset = facts.assetsAnalysis.find(
        (a) => a.ticker.toUpperCase() === p.ticker.toUpperCase(),
      );
      changes.push({
        ticker: p.ticker,
        action: 'BUY',
        amountRub: Math.max(1000, asset?.deficitRub ?? 10000),
      });
    } else if (p.action === 'REDUCE' || p.action === 'SELL') {
      changes.push({
        ticker: p.ticker,
        action: p.action === 'SELL' ? 'SELL' : 'REDUCE',
        amountRub: Math.round(
          ((p.action === 'SELL' ? 0.25 : 0.1) *
            (facts.totalPortfolioValue || 0) *
            (facts.assetsAnalysis.find(
              (a) => a.ticker.toUpperCase() === p.ticker.toUpperCase(),
            )?.currentPercent ?? 0)) /
            100,
        ),
      });
    }
  }

  // Если предложений нет — используем дефицит как кандидата на покупку
  if (changes.length === 0 && facts.freeCashRub > 5000) {
    const mostDeficit = [...facts.assetsAnalysis].sort(
      (a, b) => (b.deficitRub ?? 0) - (a.deficitRub ?? 0),
    )[0];
    if (mostDeficit && (mostDeficit.deficitRub ?? 0) > 0) {
      changes.push({
        ticker: mostDeficit.ticker,
        action: 'BUY',
        amountRub: Math.min(facts.freeCashRub, mostDeficit.deficitRub ?? 0),
      });
    }
  }

  return changes;
}

/** Анализ структуры (роль analysis): детерминированный, без мутаций */
function analyzeStructure(
  question: InterpretedQuestion,
  facts: DirectorFactsContext,
): DirectorAgentPayload {
  const tickers = question.tickers;
  const relevant =
    tickers.length === 0
      ? facts.assetsAnalysis
      : facts.assetsAnalysis.filter((a) =>
          tickers.some((t) => a.ticker.toUpperCase() === t.toUpperCase()),
        );

  const factsLines: string[] = [];
  let maxConcentration = 0;
  let maxDeviation = 0;
  let totalPnl = 0;

  for (const asset of relevant) {
    maxConcentration = Math.max(maxConcentration, asset.currentPercent ?? 0);
    maxDeviation = Math.max(
      maxDeviation,
      asset.targetPercent > 0
        ? Math.abs((asset.currentPercent ?? 0) - asset.targetPercent)
        : 0,
    );
    totalPnl += asset.unrealizedProfitRub ?? 0;
    factsLines.push(
      `${asset.ticker}: доля ${(asset.currentPercent ?? 0).toFixed(1)}% ` +
        `(цель ${(asset.targetPercent ?? 0).toFixed(1)}%), ` +
        `P&L ${Math.round(asset.unrealizedProfitRub ?? 0)} ₽.`,
    );
  }

  return {
    summary:
      `AnalysisAgent: активов в фокусе — ${relevant.length}; ` +
      `макс. концентрация ${maxConcentration.toFixed(1)}%, ` +
      `макс. отклонение от цели ${maxDeviation.toFixed(1)} п.п., ` +
      `суммарный P&L ${Math.round(totalPnl)} ₽.`,
    sources: ['PortfolioMath', 'USER_TARGET_PERCENT', 'PORTFOLIO_MATH_STATUS'],
    detail: { factsLines: factsLines.slice(0, 10) },
  };
}

/** Сводка по research: факты без интерпретации (роль research) */
function summarizeResearch(
  question: InterpretedQuestion,
  facts: DirectorFactsContext,
  newsImpacts: readonly NewsImpact[] = [],
): DirectorAgentPayload {
  const tickers = question.tickers;
  const priceAlerts = (facts.priceAlerts ?? []).filter(
    (a) =>
      tickers.length === 0 ||
      tickers.some((t) => a.ticker.toUpperCase() === t.toUpperCase()),
  );

  const alertsText =
    priceAlerts.length > 0
      ? priceAlerts
          .map(
            (a) =>
              `${a.ticker}: ${a.alertLevel ?? 'alert'} @ ${a.threshold ?? '?'}`,
          )
          .join('; ')
      : 'ценовых алертов нет';

  // Новостной фон: приоритет — impact'ы NewsDriver, иначе сырой newsContext
  const relevantImpacts = newsImpacts.filter(
    (i) =>
      tickers.length === 0 ||
      tickers.some((t) => t.toUpperCase() === i.ticker.toUpperCase()),
  );
  let newsSummary: string;
  if (relevantImpacts.length > 0) {
    newsSummary = relevantImpacts
      .slice(0, 3)
      .map(
        (i) =>
          `${i.ticker}: ${i.impactDirection} ` +
          `(сентимент ${i.sentimentScore.toFixed(2)}, важность «${i.importance}»)`,
      )
      .join('; ');
  } else if (facts.newsContext) {
    newsSummary = facts.newsContext.slice(0, 200);
  } else {
    newsSummary = 'новостной контекст не передан';
  }

  return {
    summary:
      `ResearchAgent: ${alertsText}. ` +
      `Новости: ${newsSummary}. ` +
      'Факты переданы без изменения.',
    sources: factSources(facts),
    detail: {
      priceAlerts: priceAlerts.length,
      newsImpacts: relevantImpacts.length,
    },
  };
}

/** Источники фактов, доступных Director */
function factSources(facts: DirectorFactsContext): string[] {
  const sources: string[] = ['PortfolioMath'];
  if (facts.userTargetPercent) sources.push('USER_TARGET_PERCENT');
  if (facts.portfolioMathStatus) sources.push('PORTFOLIO_MATH_STATUS');
  if (facts.newsContext) sources.push('Research/News providers');
  if (facts.priceAlerts && facts.priceAlerts.length > 0) {
    sources.push('Price alerts pipeline');
  }
  return sources;
}

/** Метка действия (для человекочитаемых строк) */
export function actionLabel(action: AiAction | null): string {
  const labels: Record<string, string> = {
    BUY: 'докупить',
    SELL: 'продать часть',
    EXIT: 'выйти полностью',
    REDUCE: 'сократить',
    HOLD: 'удерживать',
    AVOID: 'избегать',
    AVERAGE: 'усреднить',
  };
  return action ? (labels[action] ?? action) : 'без действия';
}
