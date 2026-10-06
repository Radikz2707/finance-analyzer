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
import type { IAgent } from '../agent/types.js';
import type { FileAgentInput } from '../agents/file-agent.js';
import type { TerminalAgentInput } from '../agents/terminal-agent.js';
import type {
  SecurityActionRequest,
  SecurityDecision,
} from '../agents/security-agent.js';
import {
  buildFileAgentInput,
  buildTerminalAgentInput,
} from './action-input-builder.js';
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
 * Карта подключённых action-агентов (file/terminal).
 * Заполняется ТОЛЬКО в Node-контуре (см. agents/agent-factory.ts);
 * в браузерной сборке отсутствует → фасад честно отвечает
 * «доступно в десктопном режиме».
 */
export interface DirectorActionAgents {
  file?: IAgent<FileAgentInput>;
  terminal?: IAgent<TerminalAgentInput>;
}

/**
 * Шлюз безопасности action-операций (обёртка над SecurityAgent).
 * Метод `check` возвращает вердикт ДО выполнения операции.
 */
export interface ActionSecurityGate {
  check(
    request: SecurityActionRequest,
  ): SecurityDecision | Promise<SecurityDecision>;
}

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
  private readonly actionAgents: DirectorActionAgents;
  private readonly security: ActionSecurityGate | null;

  constructor(opts?: DirectorFacadeOptions) {
    this.strategist = opts?.strategist ?? new StrategistAgent();
    this.scenario = opts?.scenario ?? new ScenarioAgent();
    this.aiExecutor = opts?.aiExecutor ?? defaultAiExecutor;
    this.reviewExecutor = opts?.reviewExecutor ?? defaultReviewExecutor;
    this.actionAgents = opts?.actionAgents ?? {};
    this.security = opts?.security ?? null;
  }

  /**
   * Выполнить роли, выбранные Director.
   * Результаты сохраняют оригинальные факты — входные данные не мутируются.
   */
  async executeRoles(
    roles: AgentRole[],
    question: InterpretedQuestion,
    facts: DirectorFactsContext,
  ): Promise<AgentResultEntry[]> {
    const uniqueRoles = [...new Set(roles)];
    const results: AgentResultEntry[] = [];

    // Все задачи запускаются параллельно (независимые агенты)
    const tasks = uniqueRoles.map(async (role) => {
      const startedAt = Date.now();
      try {
        const payload = await this.executeRole(role, question, facts);
        return this.makeEntry(role, true, payload, startedAt, question);
      } catch (err) {
        return this.makeEntry(
          role,
          false,
          {
            summary: `Агент «${role}» не выполнен: ${err instanceof Error ? err.message : String(err)}`,
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

  /** Выполнить одну роль */
  private async executeRole(
    role: AgentRole,
    question: InterpretedQuestion,
    facts: DirectorFactsContext,
  ): Promise<DirectorAgentPayload> {
    switch (role) {
      case 'analysis':
        return analyzeStructure(question, facts);
      case 'research':
        return summarizeResearch(question, facts);
      case 'ai': {
        const opinion = await this.aiExecutor({
          question,
          facts,
          agentResults: [],
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
        return this.runStrategist(question, facts);
      case 'scenario':
        return this.runScenario(question, facts);
      case 'review': {
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
            arguments: review.warnings.slice(0, 3),
          },
          summary: review.summary,
          sources: factSources(facts),
          detail: { warnings: review.warnings },
        };
      }
      case 'file':
      case 'terminal':
        return this.runActionAgent(role, question);
      default:
        throw new Error(`Неизвестная роль агента: ${role}`);
    }
  }

  /**
   * Выполнить action-агента (file/terminal) с прогоном через шлюз
   * безопасности. При отсутствии агента (браузерная сборка) — честный
   * ответ, а не ошибка.
   */
  private async runActionAgent(
    role: 'file' | 'terminal',
    question: InterpretedQuestion,
  ): Promise<DirectorAgentPayload> {
    const agent: IAgent | null =
      role === 'file'
        ? (this.actionAgents.file ?? null)
        : (this.actionAgents.terminal ?? null);

    // Браузерная сборка: action-агентов нет — честный ответ, а не throw
    if (!agent) {
      return {
        summary:
          role === 'file'
            ? 'Файловые операции доступны в десктопном режиме'
            : 'Терминальные операции доступны в десктопном режиме',
        sources: [],
      };
    }

    const input: unknown =
      role === 'file'
        ? buildFileAgentInput(question)
        : buildTerminalAgentInput(question);
    if (!input) {
      return {
        summary:
          role === 'file'
            ? 'Не удалось определить файловую операцию из запроса — укажите путь к файлу.'
            : 'Не удалось определить команду из запроса — уточните, что выполнить.',
        sources: [],
      };
    }

    // Прогон через SecurityAgent (если подключён в Node-контуре)
    if (this.security) {
      const decision = await this.security.check(
        this.buildSecurityRequest(
          role,
          input as FileAgentInput | TerminalAgentInput,
          question,
        ),
      );
      if (decision.verdict === 'deny') {
        return {
          summary: `Операция отклонена: ${decision.reason ?? 'запрещено правилами безопасности'}`,
          sources: [],
          detail: this.securityDetail(decision),
        };
      }
      if (decision.verdict === 'require-confirmation') {
        return {
          summary: `Требуется подтверждение: ${decision.description ?? decision.reason ?? 'действие требует ручного подтверждения'}`,
          sources: [],
          detail: this.securityDetail(decision),
        };
      }
    }

    const result = await agent.execute(input);
    if (!result.success) {
      throw new Error(result.error?.message ?? `Агент «${role}» не выполнен`);
    }
    const output = (result.data ?? {}) as Record<string, unknown>;

    return {
      summary:
        typeof output.message === 'string' && output.message !== ''
          ? output.message
          : role === 'file'
            ? 'Файловая операция выполнена'
            : this.describeTerminalOutput(output),
      sources: [],
      detail: output,
    };
  }

  /** Заявка на проверку безопасности по входу action-агента */
  private buildSecurityRequest(
    role: 'file' | 'terminal',
    input: FileAgentInput | TerminalAgentInput,
    question: InterpretedQuestion,
  ): SecurityActionRequest {
    if (role === 'file') {
      const fileInput = input as FileAgentInput;
      return {
        kind: 'file',
        action: fileInput.action,
        path: fileInput.path ?? '',
        description: question.text,
      };
    }
    const termInput = input as TerminalAgentInput;
    return {
      kind: 'terminal',
      command: termInput.command,
      args: termInput.args,
      description: question.text,
    };
  }

  /** Детали вердикта безопасности для payload */
  private securityDetail(decision: SecurityDecision): Record<string, unknown> {
    return {
      verdict: decision.verdict,
      dangerLevel: decision.dangerLevel,
      reason: decision.reason,
      description: decision.description,
      matchedRules: decision.matchedRules,
    };
  }

  /** Человекочитаемое описание вывода терминала (нет поля message) */
  private describeTerminalOutput(output: Record<string, unknown>): string {
    const exitCode = output.exitCode;
    const stdout = typeof output.stdout === 'string' ? output.stdout : '';
    const snippet = stdout.slice(0, 200).trim();
    if (exitCode === 0) {
      return snippet !== ''
        ? `Команда выполнена: ${snippet}`
        : 'Команда выполнена';
    }
    return `Команда завершилась с кодом ${String(exitCode)}`;
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

  const newsSummary = facts.newsContext
    ? facts.newsContext.slice(0, 200)
    : 'новостной контекст не передан';

  return {
    summary:
      `ResearchAgent: ${alertsText}. ` +
      `Новости: ${newsSummary}. ` +
      'Факты переданы без изменения.',
    sources: factSources(facts),
    detail: { priceAlerts: priceAlerts.length },
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
