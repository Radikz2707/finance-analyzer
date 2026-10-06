/**
 * DirectorDelegationPlanner — построение плана делегирования.
 *
 * Превращает интерпретированный вопрос пользователя в конкретный DirectorPlan:
 * - какие агенты подключаются и ПОЧЕМУ (явное обоснование для каждого);
 * - какая задача назначена каждому агенту;
 * - какие входные данные получает каждый агент;
 * - какие вопросы требуют обсуждения;
 * - нужен ли Consilium.
 */

import type {
  AgentRole,
  AgentTask,
  DirectorPlan,
  InterpretedQuestion,
} from './director-types.js';

// ──────────────────────────────────────────────
// 1. Обоснования ролей агентов
// ──────────────────────────────────────────────

/** Почему Director подключает конкретного агента */
const AGENT_RATIONALE: Record<AgentRole, string> = {
  analysis:
    'Детерминированная математика: структура, концентрация, отклонения от целевых долей. ' +
    'Нужен как фактический базис вопроса — без него ответы агентов не на что опирать.',
  research:
    'Факты, фундаментал, новости, макроэкономика. Источники данных, а не догадки: ' +
    'ответ должен опираться на официальные/внешние данные.',
  ai:
    'Основной инвестиционный reasoning. Формирует рекомендацию с полной свободой ' +
    'инвестиционного решения и правом не согласиться с математикой или целями.',
  strategist:
    'Независимый стратегический анализ и оценка рисков (концентрация, просадки, устойчивость). ' +
    'НЕ имеет veto и не может принудительно изменить решение AI.',
  scenario:
    'Сценарное моделирование «что если»: как изменится портфель при каждом варианте действий. ' +
    'Не исключает сценарии заранее из-за возможного убытка.',
  review:
    'Контроль качества: поиск ошибок, противоречий и пропущенных рисков в собранных результатах.',
  file:
    'Файловые операции: чтение, создание, редактирование, удаление и поиск ' +
    'файлов в пределах разрешённого корня проекта.',
  terminal:
    'Терминальные операции: безопасное выполнение команд (чтение, npm, git) ' +
    'в пределах корня проекта с whitelist/blacklist и таймаутами.',
};

/** Приоритет задачи по роли */
const ROLE_PRIORITY: Record<AgentRole, AgentTask['priority']> = {
  analysis: 'high',
  research: 'high',
  ai: 'high',
  strategist: 'normal',
  scenario: 'normal',
  review: 'low',
  file: 'normal',
  terminal: 'normal',
};

/** Участвует ли результат роли в Consilium */
const ROLE_FOR_CONSILIUM: Record<AgentRole, boolean> = {
  analysis: false,
  research: true,
  ai: true,
  strategist: true,
  scenario: true,
  review: false,
  file: false,
  terminal: false,
};

// ──────────────────────────────────────────────
// 2. Планировщик
// ──────────────────────────────────────────────

/**
 * Планировщик делегирования задач Director.
 */
export class DirectorDelegationPlanner {
  /** Максимум агентов на задачу (0 = без лимита) */
  private readonly maxAgents: number;

  /** Порог сложности для созыва Consilium (0-5) */
  private readonly consiliumThreshold: number;

  constructor(opts?: { maxAgents?: number; consiliumThreshold?: number }) {
    this.maxAgents = opts?.maxAgents ?? 0;
    this.consiliumThreshold = opts?.consiliumThreshold ?? 3;
  }

  /**
   * Построить план задачи Director.
   *
   * @param question — интерпретированный вопрос
   * @param memoryContext — контекст из памяти (прошлые решения, разговоры)
   */
  buildPlan(
    question: InterpretedQuestion,
    memoryContext?: string,
  ): DirectorPlan {
    const taskId = this.newTaskId();
    const goal = this.buildGoal(question);
    const connected = this.selectAgents(question);
    const tickersLabel =
      question.tickers.length > 0 ? question.tickers.join(', ') : 'портфель';

    const assignments = connected.map((role) => ({
      role,
      task: this.buildTaskDescription(role, question),
      inputData: this.buildInputDescription(role, question, memoryContext),
      rationale: AGENT_RATIONALE[role],
    }));

    return {
      taskId,
      userQuestion: question.text,
      goal,
      connectedAgents: connected,
      agentAssignments: assignments,
      discussionTopics: this.buildDiscussionTopics(question, tickersLabel),
      needsConsilium: this.needsConsilium(question),
      directorSynthesis: '',
    };
  }

  /**
   * Построить список задач для DirectorTask.agents (с taskId, expectedOutput и т.д.).
   */
  buildAgentTasks(question: InterpretedQuestion): AgentTask[] {
    const connected = this.selectAgents(question);
    const tickersLabel =
      question.tickers.length > 0 ? question.tickers.join(', ') : 'портфель';

    return connected.map((role) => ({
      taskId: `${this.newTaskId()}-${role}`,
      role,
      description: this.buildTaskDescription(role, question),
      inputData: {
        topic: question.topic,
        tickers: question.tickers,
        tickersLabel,
        category: question.category,
      },
      expectedOutput: this.expectedOutputs(role),
      priority: ROLE_PRIORITY[role],
      forConsilium: ROLE_FOR_CONSILIUM[role],
    }));
  }

  // ── Selection ──

  /**
   * Выбор агентов: Director подключает ТОЛЬКО тех, кто нужен для ответа.
   * Это осознанное решение, а не запуск всех агентов подряд.
   */
  private selectAgents(question: InterpretedQuestion): AgentRole[] {
    const requested = question.requiredAgents;
    let agents = [...requested];

    // Если парсер не определил ни одного агента — минимальный набор:
    // анализ для фактов + AI для reasoning.
    if (agents.length === 0) {
      agents = ['analysis', 'ai'];
    }

    // Ограничение числа агентов на задачу
    if (this.maxAgents > 0 && agents.length > this.maxAgents) {
      const prioritized = [...agents].sort((a, b) =>
        ROLE_PRIORITY[a].localeCompare(ROLE_PRIORITY[b]) === 0
          ? a.localeCompare(b)
          : ROLE_PRIORITY[a] === 'high'
            ? -1
            : 1,
      );
      agents = prioritized.slice(0, this.maxAgents);
    }

    return [...new Set(agents)];
  }

  /** Нужен ли Consilium для этого вопроса */
  private needsConsilium(question: InterpretedQuestion): boolean {
    if (question.needsConsilium) return true;
    if (question.complexity >= this.consiliumThreshold) return true;
    if (question.category === 'comparison' && question.tickers.length > 1) {
      return true;
    }
    if (question.category === 'scenario') return true;
    if (question.category === 'strategy') return true;
    return false;
  }

  // ── Descriptions ──

  /** Человекочитаемая цель задачи */
  private buildGoal(question: InterpretedQuestion): string {
    const tickersLabel =
      question.tickers.length > 0 ? ` по ${question.tickers.join(', ')}` : '';
    switch (question.intent) {
      case 'understand':
        return `Объяснить ситуацию${tickersLabel}: ${question.topic.toLowerCase()}`;
      case 'decide-action':
        return `Выработать рекомендацию по действию${tickersLabel}: ${question.topic.toLowerCase()}`;
      case 'compare-options':
        return `Сравнить варианты${tickersLabel}: ${question.topic.toLowerCase()}`;
      case 'explore-scenario':
        return `Проверить сценарий${tickersLabel}: ${question.topic.toLowerCase()}`;
      case 'review-past':
        return `Пересмотреть прошлое решение${tickersLabel}`;
      case 'plan-future':
        return `Сформировать план${tickersLabel}: ${question.topic.toLowerCase()}`;
      case 'critique-system':
        return `Оценить качество работы системы по теме: ${question.topic.toLowerCase()}`;
      default:
        return `Ответить на вопрос: ${question.topic.toLowerCase()}`;
    }
  }

  /** Описание задачи для агента */
  private buildTaskDescription(
    role: AgentRole,
    question: InterpretedQuestion,
  ): string {
    const subject =
      question.tickers.length > 0
        ? question.tickers.join(', ')
        : 'портфель в целом';
    switch (role) {
      case 'analysis':
        return `Детерминированный анализ структуры и математики по ${subject}: концентрация, отклонения от целевых долей, P&L.`;
      case 'research':
        return `Собрать факты по ${subject}: цены, фундаментал, новости, макроэкономика. Не менять фактические данные.`;
      case 'ai':
        return `Сформулировать инвестиционную рекомендацию по ${subject} с полной свободой решения (можно не соглашаться с математикой и целевыми долями).`;
      case 'strategist':
        return `Независимая стратегическая оценка рисков по ${subject}: концентрация, просадки, устойчивость. Без veto.`;
      case 'scenario':
        return `Построить сценарии «что если» по ${subject}: удержание, предложение AI, альтернативы. Не отбрасывать убыточные варианты заранее.`;
      case 'review':
        return `Проверить качество и непротиворечивость результатов по ${subject}: найти ошибки, противоречия, пропущенные риски.`;
      case 'file':
        return `Выполнить файловую операцию в рамках вопроса: ${question.text}. Операции ограничены корнем проекта и не затрагивают служебные пути.`;
      case 'terminal':
        return `Выполнить команду терминала в рамках вопроса: ${question.text}. Команды проходят whitelist/blacklist и не выходят за пределы корня проекта.`;
      default:
        return `Проанализировать вопрос по ${subject}.`;
    }
  }

  /** Описание входных данных для агента */
  private buildInputDescription(
    _role: AgentRole,
    question: InterpretedQuestion,
    memoryContext?: string,
  ): string {
    const parts: string[] = [];
    parts.push(`Вопрос: ${question.text}`);
    if (question.tickers.length > 0) {
      parts.push(`Тикеры: ${question.tickers.join(', ')}`);
    }
    parts.push(`Категория: ${question.category}`);
    if (memoryContext) {
      parts.push('Контекст памяти: включён (прошлые решения и разговоры)');
    }
    return parts.join('; ');
  }

  /** Какие данные ожидаются от агента */
  private expectedOutputs(role: AgentRole): string[] {
    switch (role) {
      case 'analysis':
        return ['assetsAnalysis', 'riskValidation', 'income'];
      case 'research':
        return ['snapshots', 'allConflicts'];
      case 'ai':
        return ['recommendation', 'rationale', 'confidence'];
      case 'strategist':
        return ['decisions', 'summary'];
      case 'scenario':
        return ['scenarios', 'bestScenarioId'];
      case 'review':
        return ['warnings', 'agreementPercent', 'finalRecommendation'];
      case 'file':
        return ['action', 'path', 'message'];
      case 'terminal':
        return ['command', 'stdout', 'stderr', 'exitCode', 'truncated'];
      default:
        return ['result'];
    }
  }

  /** Темы, требующие обсуждения */
  private buildDiscussionTopics(
    question: InterpretedQuestion,
    tickersLabel: string,
  ): string[] {
    const topics: string[] = [];
    if (question.tickers.length > 0) {
      topics.push(`Инвестиционное решение по ${tickersLabel}`);
    }
    if (question.category === 'scenario') {
      topics.push('Какие сценарии рассмотреть и какой выбрать');
    }
    if (question.category === 'comparison') {
      topics.push('Какой вариант предпочтительнее и почему');
    }
    if (question.category === 'strategy' || question.category === 'plan') {
      topics.push('Стратегические риски и горизонт плана');
    }
    if (topics.length === 0) {
      topics.push(`Интерпретация текущей ситуации: ${question.topic}`);
    }
    return topics;
  }

  private newTaskId(): string {
    return `dir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Утилита: человекочитаемая метка роли агента */
export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  analysis: 'AnalysisAgent (математика портфеля)',
  research: 'ResearchAgent (факты и новости)',
  ai: 'AI Agent (инвестиционный reasoning)',
  strategist: 'StrategistAgent (стратегия и риски)',
  scenario: 'ScenarioAgent (сценарии «что если»)',
  review: 'ReviewAgent (контроль качества)',
  file: 'FileAgent (файловые операции)',
  terminal: 'TerminalAgent (безопасный терминал)',
};
