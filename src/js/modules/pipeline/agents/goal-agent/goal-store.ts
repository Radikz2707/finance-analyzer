/**
 * GoalStore — файловая персистентность целей GoalAgent.
 *
 * Хранит цели в JSON-файле (по умолчанию <dataDir>/goals.json):
 * - dev/CLI: <cwd>/data/goals.json;
 * - упакованное Electron-приложение: %APPDATA%/finance-analyzer/goals.json
 *   (через resolveAppDataDir()).
 *
 * Надёжность:
 * - атомарная запись (tmp → rename), чтобы не остаться с битым файлом
 *   при падении процесса посреди сохранения;
 * - битый/несовместимый файл не роняет агент: лог-предупреждение
 *   и старт с пустого списка целей.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAppDataDir } from '../../../app-paths.js';
import type { Goal, GoalPriority, GoalStatus, GoalType } from './types.js';

const GOAL_TYPES: GoalType[] = [
  'tracking',
  'analysis',
  'alert',
  'action',
  'research',
];
const GOAL_PRIORITIES: GoalPriority[] = ['low', 'medium', 'high', 'critical'];
const GOAL_STATUSES: GoalStatus[] = [
  'pending',
  'active',
  'paused',
  'completed',
  'cancelled',
];

/** Опции хранилища (DI для тестов) */
export interface GoalStoreOptions {
  /** Путь к JSON-файлу; по умолчанию <dataDir>/goals.json */
  filePath?: string;
}

export class GoalStore {
  /** Путь к файлу хранилища */
  public readonly filePath: string;

  constructor(options: GoalStoreOptions = {}) {
    this.filePath =
      options.filePath ?? path.join(resolveAppDataDir(), 'goals.json');
  }

  /**
   * Загрузить цели из файла.
   * Отсутствующий файл → пустой список; битый файл → предупреждение и [].
   */
  async load(): Promise<Goal[]> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if (isNotFoundError(err)) return [];
      console.warn(
        `[GoalStore] Не удалось прочитать ${this.filePath}: ${errorMessage(err)} — стартуем с пустого списка целей`,
      );
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn(
          `[GoalStore] Файл ${this.filePath} имеет неожиданный формат (ожидался массив) — стартуем с пустого списка целей`,
        );
        return [];
      }
      return parsed
        .map(normalizeGoal)
        .filter((goal): goal is Goal => goal !== null);
    } catch (err) {
      console.warn(
        `[GoalStore] Битый JSON в ${this.filePath}: ${errorMessage(err)} — стартуем с пустого списка целей`,
      );
      return [];
    }
  }

  /** Атомарно сохранить цели (tmp → rename). */
  async save(goals: readonly Goal[]): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.promises.writeFile(
      tmpPath,
      JSON.stringify(goals, null, 2),
      'utf-8',
    );
    await fs.promises.rename(tmpPath, this.filePath);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Валидация и нормализация одной цели из файла; null → запись отброшена */
function normalizeGoal(entry: unknown): Goal | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.name !== 'string' || raw.name.length === 0) return null;

  const now = new Date().toISOString();
  return {
    id: raw.id,
    name: raw.name,
    description:
      typeof raw.description === 'string' ? raw.description : raw.name,
    type: pickEnum(raw.type, GOAL_TYPES, 'analysis'),
    priority: pickEnum(raw.priority, GOAL_PRIORITIES, 'medium'),
    status: pickEnum(raw.status, GOAL_STATUSES, 'pending'),
    progress:
      typeof raw.progress === 'number'
        ? Math.max(0, Math.min(100, raw.progress))
        : 0,
    deadline: typeof raw.deadline === 'string' ? raw.deadline : undefined,
    parentId: typeof raw.parentId === 'string' ? raw.parentId : undefined,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === 'string')
      : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    completedAt:
      typeof raw.completedAt === 'string' ? raw.completedAt : undefined,
    metrics:
      typeof raw.metrics === 'object' &&
      raw.metrics !== null &&
      Object.values(raw.metrics).every((v) => typeof v === 'number')
        ? (raw.metrics as Record<string, number>)
        : undefined,
  };
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
