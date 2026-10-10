/**
 * CLI управления goals-хранилищем (`npm run goals`).
 *
 * Отдельный от autonomous-session инструмент: только добавляет/смотрит/
 * меняет цели в data/goals.json — НЕ запускает автономный цикл. Пишет
 * цели в то же хранилище, которое подхватывает watch-режим
 * (`npm run autonomous -- --watch`) на следующем тике.
 *
 * Команды:
 *   npm run goals -- list                     # список всех целей
 *   npm run goals -- add "Текст задачи"       # добавить и активировать
 *   npm run goals -- activate <id>            # сделать цель активной
 *   npm run goals -- pause <id>               # приостановить
 *   npm run goals -- resume <id>              # возобновить
 *   npm run goals -- done <id>                # завершить
 *   npm run goals -- remove <id>              # удалить
 *
 * Остановка watch-процесса: Ctrl+C в его терминале.
 */

import { GoalAgent } from '../src/js/modules/pipeline/agents/goal-agent/goal-agent.js';
import type { Goal } from '../src/js/modules/pipeline/agents/goal-agent/types.js';

const HELP = `Команды:
  goals add "Текст задачи"     добавить цель и активировать её
  goals list                   показать все цели
  goals activate <id>          активировать цель
  goals pause <id>             приостановить цель
  goals resume <id>            возобновить цель
  goals done <id>              завершить цель
  goals remove <id>            удалить цель`;

const argv = process.argv.slice(2);
const command = (argv[0] ?? 'list').toLowerCase();
const agent = new GoalAgent({ name: 'GoalsCLI' });

function fail(message: string): never {
  console.error(`✖ ${message}`);
  console.error(`\n${HELP}`);
  process.exit(1);
}

function argValue(): string {
  const value = argv.slice(1).join(' ').trim();
  if (!value) fail('Не указан аргумент команды');
  return value;
}

function printGoal(goal: Goal): void {
  const marks: Record<string, string> = {
    pending: '⏳',
    active: '▶',
    paused: '⏸',
    completed: '✅',
    cancelled: '✖',
  };
  console.log(
    `${marks[goal.status] ?? '•'} [${goal.id.slice(0, 8)}] ${goal.status.padEnd(9)} ${goal.priority.padEnd(8)} ${goal.name}`,
  );
}

async function mutate(
  id: string,
  params: Record<string, unknown>,
): Promise<void> {
  const result = await agent.execute({
    action: 'update',
    params: { id, ...params },
  });
  if (!result.success) {
    fail(
      result.error instanceof Error ? result.error.message : 'Цель не найдена',
    );
  }
  const goal = (result.data as { goal: Goal } | undefined)?.goal;
  console.log(`✔ Обновлено: ${goal ? goal.name : id}`);
}

async function main(): Promise<void> {
  switch (command) {
    case 'add': {
      const text = argValue();
      const added = await agent.execute({
        action: 'add',
        params: {
          name: text.length > 80 ? `${text.slice(0, 77)}...` : text,
          description: text,
          type: 'action',
          priority: 'high',
        },
      });
      if (!added.success) {
        fail(
          added.error instanceof Error
            ? added.error.message
            : 'Не удалось добавить цель',
        );
      }
      const goal = (added.data as { goal: Goal }).goal;
      await agent.execute({
        action: 'update',
        params: { id: goal.id, status: 'active' },
      });
      console.log(`🎯 Цель добавлена и активирована:`);
      printGoal(goal);
      break;
    }

    case 'list': {
      const result = await agent.execute({ action: 'list' });
      const goals = (result.data as { goals: Goal[] }).goals;
      if (goals.length === 0) {
        console.log(
          '📭 Целей нет. Добавьте: npm run goals -- add "Текст задачи"',
        );
        break;
      }
      for (const goal of goals) printGoal(goal);
      console.log(
        `\nВсего: ${goals.length} (полные id — в ${'data/goals.json'})`,
      );
      break;
    }

    case 'activate':
      await mutate(argValue(), { status: 'active' });
      break;
    case 'pause':
      await mutate(argValue(), { status: 'paused' });
      break;
    case 'resume':
      await mutate(argValue(), { status: 'active' });
      break;
    case 'done': {
      const id = argValue();
      const result = await agent.execute({
        action: 'complete',
        params: { id },
      });
      if (!result.success) fail('Цель не найдена');
      console.log(`✅ Цель завершена`);
      break;
    }
    case 'remove': {
      const id = argValue();
      const result = await agent.execute({ action: 'delete', params: { id } });
      if (!result.success) fail('Цель не найдена');
      console.log(`🗑 Цель удалена`);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;

    default:
      fail(`Неизвестная команда: ${command}`);
  }
}

await main();
