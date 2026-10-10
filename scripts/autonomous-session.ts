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
 * Watch-режим (непрерывный демон):
 *   npm run autonomous -- --watch                    # цикл раз в 60 c
 *   npm run autonomous -- --watch --watch-interval 30 # цикл раз в 30 c
 *
 * В watch-режиме процесс не завершается: каждый тик он перечитывает
 * goals-хранилище (data/goals.json), выполняет один цикл по активным
 * целям и ждёт интервала. Новые цели можно добавлять извне:
 *   npm run autonomous -- --goal "Новая задача"   (другим процессом)
 * Остановка: Ctrl+C (SIGINT обрабатывается gracefully).
 *
 * Цели:
 *   npm run autonomous -- --goal "Проверь здоровье проекта и исправь ошибки"
 *   npm run autonomous -- --goal "Задача 1" --goal "Задача 2"
 *   (флаг --goal можно повторять; цели добавляются в GoalAgent перед сменой)
 *
 * Без --goal смена работает по целям, заранее записанным в goals-хранилище:
 * GoalAgent персистентен — цели хранятся в JSON-файле (<dataDir>/goals.json,
 * в dev: data/goals.json) и переживают перезапуск процесса. Пример добавления
 * цели из кода:
 *   goalAgent.execute({ action: 'add', params: { name: '...', description: '...', type: 'analysis', priority: 'high' } })
 *   goalAgent.execute({ action: 'update', params: { id: '<goalId>', status: 'active' } })
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
  AutonomousLoopOutput,
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

/** Watch-режим: непрерывный цикл с ожиданием новых целей */
const watch = argv.includes('--watch');
/** Интервал между циклами в watch-режиме (секунды, по умолчанию 60) */
const watchIntervalSec = numFlag('--watch-interval') ?? 60;

/** Разовые цели из CLI: --goal "текст" (флаг можно повторять) */
function strFlags(name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) {
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) {
        values.push(value);
      }
    }
  }
  return values;
}

const cliGoals = strFlags('--goal');

// ─── Сборка организма ────────────────────────────────────────────────

console.log(
  '🧬 Сборка организма: GoalAgent + ActionAgents + Security + Director + Feedback + Loop',
);

const goalAgent = new GoalAgent({ name: 'GoalAgent' });

// Разовые цели из CLI: добавляются в GoalAgent до старта смены
for (const goalText of cliGoals) {
  const added = await goalAgent.execute({
    action: 'add',
    params: {
      name: goalText.length > 80 ? `${goalText.slice(0, 77)}...` : goalText,
      description: goalText,
      type: 'action',
      priority: 'high',
    },
  });
  if (!added.success) {
    console.error(
      `⚠ Не удалось добавить цель из CLI: ${
        added.error instanceof Error ? added.error.message : added.error
      }`,
    );
  } else {
    // add создаёт цель в статусе 'pending' — активируем для цикла
    const goalId = (added.data as { goal?: { id: string } } | undefined)?.goal
      ?.id;
    if (!goalId) {
      console.error(
        `⚠ Цель добавлена без ID, активация невозможна: «${goalText}»`,
      );
      continue;
    }
    const activated = await goalAgent.execute({
      action: 'update',
      params: { id: goalId, status: 'active' },
    });
    console.log(
      `🎯 Цель из CLI ${activated.success ? 'добавлена и активирована' : 'добавлена, но НЕ активирована'}: «${goalText}»`,
    );
  }
}

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

/** Печать итогов смены (общая для one-shot и watch) */
function printShiftSummary(output: AutonomousLoopOutput): void {
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
}

// One-shot: одна смена и выход (прежнее поведение)
if (!watch) {
  const output = dryRun
    ? await loop.execute('dry-run')
    : await loop.execute('run-cycle');
  printShiftSummary(output);
  process.exit(0);
}

// ─── Watch-режим: непрерывный цикл с ожиданием новых целей ───────────

console.log(
  `\n👀 Watch-режим: цикл каждые ${watchIntervalSec} с. Стоп — Ctrl+C.\n` +
    `Новые цели (из другого терминала): npm run goals -- add "текст задачи"\n` +
    `Список целей: npm run goals -- list. Общение с Директором: npm run chat`,
);

process.on('SIGINT', () => {
  console.log('\n🛑 Получен SIGINT — останавливаюсь…');
  process.exit(0);
});

for (;;) {
  try {
    // Подхватить цели, добавленные извне после запуска (data/goals.json)
    await goalAgent.reload();
    const output = await loop.execute('run-cycle');
    printShiftSummary(output);
  } catch (err) {
    console.error(
      `⚠ Цикл упал, продолжаю по расписанию: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, watchIntervalSec * 1000));
}
