/**
 * Автономная смена Директора (`npm run autonomous`).
 *
 * Собирает «организм» в одну работающую связку:
 * - GoalAgent — источник целей (что делать);
 * - ActionAgentRegistry — «руки» (file/terminal/process/automation/code);
 * - SecurityAgent — иммунитет (гейт всех опасных операций);
 * - DirectorAgent + Facade — мозг (делегирование и синтез);
 * - FeedbackLoop — самообучение (решение → результат → RL-награда);
 * - AutonomousLoop — нервная система (цикл цель → действие → урок).
 *
 * Безопасность по умолчанию:
 * - terminal/process ЗАПРЕЩЕНЫ в автономном режиме (limits.forbiddenRoles);
 * - SecurityAgent реально проверяет каждую заявку;
 * - лимиты: --max-iterations N (3), --max-minutes N (5), 2 провала подряд →
 *   аварийная остановка.
 *
 * Запуск:
 *   npm run autonomous            # полная смена
 *   npm run autonomous -- --dry-run   # только план, без выполнения
 *   npm run autonomous -- --max-iterations 5 --max-minutes 10
 *
 * Цели задаются заранее через GoalAgent (или попадают в goals-хранилище).
 * Пример добавления цели из кода:
 *   goalAgent.execute({ action: 'add', params: { name: '...', description: '...', type: 'analysis', priority: 'high' } })
 */

import { GoalAgent } from '../src/js/modules/pipeline/agents/goal-agent/goal-agent.js';
import { SecurityAgent } from '../src/js/modules/pipeline/agents/security-agent.js';
import { ActionAgentRegistry } from '../src/js/modules/pipeline/agents/agent-factory.js';
import { FeedbackLoop } from '../src/js/modules/pipeline/feedback-loop/feedback-loop.js';
import { DirectorAgentFacade } from '../src/js/modules/pipeline/director/agent-facade.js';
import { DirectorAgent } from '../src/js/modules/pipeline/director/director.js';
import {
  AutonomousLoop,
  createGoalSourceFromGoalAgent,
} from '../src/js/modules/pipeline/autonomous-loop/autonomous-loop.js';
import type {
  AutonomousGoalContext,
  AutonomousLimits,
  GoalPlanResult,
} from '../src/js/modules/pipeline/autonomous-loop/types.js';

// ─── CLI ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

function numFlag(name: string): number | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const maxIterations = numFlag('--max-iterations');
const maxMinutes = numFlag('--max-minutes');

// ─── Сборка организма ────────────────────────────────────────────────

console.log(
  '🧬 Сборка организма: GoalAgent + ActionAgents + Security + Director + Feedback + Loop',
);

const goalAgent = new GoalAgent({ name: 'GoalAgent' });
const feedback = new FeedbackLoop();

// «Руки»: полный набор action-агентов с безопасными корнями (process.cwd())
const registry = new ActionAgentRegistry();

// «Иммунитет»: реальный SecurityAgent гейтит каждую заявку
// (адаптер validate() → ActionSecurityGate.check())
const securityAgent = new SecurityAgent({ name: 'SecurityAgent' });
const security = {
  check: (request: Parameters<SecurityAgent['validate']>[0]) =>
    securityAgent.validate(request),
};

const facade = new DirectorAgentFacade({
  actionAgents: registry.createDefaultActionAgents(),
  security,
});

// «Мозг»: факты портфеля пустые — автономные цели не обязаны быть про портфель
const director = new DirectorAgent(
  {
    facade,
    initialFacts: {
      assetsAnalysis: [],
      totalPortfolioValue: 0,
      freeCashRub: 0,
    },
  },
  { maxConsiliumRounds: 2 },
);
director.createSession();

// «Руки» автономного цикла: план цели → вопрос Директору
const executor = async (
  goal: AutonomousGoalContext,
  limits: AutonomousLimits,
): Promise<GoalPlanResult> => {
  const userQuestion = `[autonomous] ${goal.name}: ${goal.description}`;
  console.log(`\n🎯 Цель: ${goal.name} (${goal.priority})`);
  console.log(`   ${goal.description}`);

  const response = await director.processUserMessage(userQuestion);

  const agentRoles =
    response.task?.agentResults.map((entry) => entry.role) ?? [];

  // Контроль forbiddenRoles: опасные роли не должны выполняться автономно
  const forbidden = agentRoles.filter((role) =>
    limits.forbiddenRoles.includes(role),
  );
  if (forbidden.length > 0) {
    console.log(
      `   ⛔ Запрещённые роли в автономном режиме: ${forbidden.join(', ')}`,
    );
    return {
      userQuestion,
      recommendedAction: 'BLOCKED',
      success: false,
      confidence: 0,
      agentRoles,
      reasoning: `Автономный режим: выполнены запрещённые роли (${forbidden.join(', ')})`,
    };
  }

  const allSucceeded =
    response.task?.agentResults.every((entry) => entry.success) ?? false;
  const action = String(response.recommendation?.action ?? 'NONE');
  console.log(
    `   → агенты: ${agentRoles.join(', ') || 'нет'}; действие: ${action}`,
  );

  return {
    userQuestion,
    recommendedAction: action,
    success: allSucceeded,
    confidence: response.recommendation?.confidence ?? 0.5,
    agentRoles,
    reasoning: (response.text ?? '').slice(0, 500),
  };
};

// «Нервная система»
const loop = new AutonomousLoop({
  goalSource: createGoalSourceFromGoalAgent(goalAgent),
  executor,
  feedback,
  limits: {
    ...(maxIterations ? { maxIterationsPerCycle: maxIterations } : {}),
    ...(maxMinutes ? { maxCycleDurationMs: maxMinutes * 60 * 1000 } : {}),
  },
});

// ─── Смена ───────────────────────────────────────────────────────────

const output = dryRun
  ? await loop.execute('dry-run')
  : await loop.execute('run-cycle');

console.log(`\n${'='.repeat(60)}`);
console.log(`📋 Итог смены: ${output.message}`);
if (output.lessons && output.lessons.length > 0) {
  console.log('\n📚 Уроки (записаны в FeedbackLoop):');
  for (const lesson of output.lessons) {
    console.log(`  • ${lesson}`);
  }
}
if (output.iterations && output.iterations.length > 0) {
  console.log('\n🗂 Итерации:');
  for (const iteration of output.iterations) {
    const mark = iteration.success ? '✅' : '❌';
    console.log(
      `  ${mark} [${iteration.goalName}] ${iteration.outcome ?? '—'}`,
    );
  }
}
console.log(`\n📊 Статус: ${JSON.stringify(output.status)}`);
process.exit(0);
