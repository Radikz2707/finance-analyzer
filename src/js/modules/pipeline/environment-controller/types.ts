/**
 * EnvironmentController Types — типы и интерфейсы для контроллера окружения.
 *
 * EnvironmentController — управление зависимостями проекта:
 * 1. Обновление node_modules (npm/yarn/pnpm)
 * 2. Установка/обновление pip-пакетов (Python)
 * 3. Управление VS Code расширениями
 * 4. Проверка версий инструментов (Node.js, Python, npm)
 * 5. CLI-интерфейс для Director
 */

// ──────────────────────────────────────────────
// 1. Состояние контроллера
// ──────────────────────────────────────────────

/** Состояние EnvironmentController */
export type ControllerState = 'idle' | 'checking' | 'installing' | 'updating' | 'stopped' | 'error';

/** Тип операции окружения */
export type EnvironmentOperation = 'npm_install' | 'npm_update' | 'pip_install' | 'pip_update' | 'vscode_extensions';

// ──────────────────────────────────────────────
// 2. Инструменты и версии
// ──────────────────────────────────────────────

/** Версия инструмента */
export interface ToolVersion {
  /** Название инструмента */
  name: string;
  /** Текущая версия */
  current: string;
  /** Требуемая версия (из package.json/pip) */
  required?: string;
  /** Соответствует ли требованию */
  matches: boolean;
}

/** Проверка всех инструментов */
export interface EnvironmentHealth {
  node?: ToolVersion;
  npm?: ToolVersion;
  python?: ToolVersion;
  pip?: ToolVersion;
  allHealthy: boolean;
  issues: string[];
}

// ──────────────────────────────────────────────
// 3. Зависимости
// ──────────────────────────────────────────────

/** Запись зависимости npm */
export interface NpmDependency {
  /** Название пакета */
  name: string;
  /** Текущая версия */
  current: string;
  /** Доступная версия */
  latest: string;
  /** Требуется обновление */
  needsUpdate: boolean;
}

/** Запись зависимости pip */
export interface PipDependency {
  /** Название пакета */
  name: string;
  /** Текущая версия */
  current: string;
  /** Доступная версия */
  latest: string;
  /** Требуется обновление */
  needsUpdate: boolean;
}

/** Статус зависимостей */
export interface DependenciesStatus {
  npm: NpmDependency[];
  pip: PipDependency[];
  totalNpm: number;
  totalPip: number;
  npmUpdatesNeeded: number;
  pipUpdatesNeeded: number;
}

// ──────────────────────────────────────────────
// 4. VS Code расширения
// ──────────────────────────────────────────────

/** Расширение VS Code */
export interface VsCodeExtension {
  /** ID расширения (например, dbaeumer.vscode-eslint) */
  id: string;
  /** Название */
  name: string;
  /** Текущая версия */
  currentVersion: string;
  /** Доступная версия */
  latestVersion: string;
  /** Требуется обновление */
  needsUpdate: boolean;
  /** Установлено */
  installed: boolean;
}

/** Результат проверки расширений */
export interface ExtensionsStatus {
  extensions: VsCodeExtension[];
  total: number;
  installed: number;
  outdated: number;
  missing: number;
}

// ──────────────────────────────────────────────
// 5. Результат операции
// ──────────────────────────────────────────────

/** Результат выполнения операции */
export interface OperationResult {
  /** Успешна ли операция */
  success: boolean;
  /** Тип операции */
  operation: EnvironmentOperation;
  /** Сообщение */
  message: string;
  /** Затраченное время (мс) */
  durationMs: number;
  /** Вывод команды (stdout) */
  stdout?: string;
  /** Ошибка (если была) */
  error?: string;
}

// ──────────────────────────────────────────────
// 6. Конфигурация
// ──────────────────────────────────────────────

/** Конфигурация EnvironmentController */
export interface EnvironmentControllerConfig {
  /** Путь к package.json */
  packageJsonPath?: string;
  /** Путь к requirements.txt */
  requirementsTxtPath?: string;
  /** Путь к VS Code CLI */
  vscodeCliPath?: string;
  /** Расширения для установки */
  requiredExtensions?: string[];
  /** Менеджер пакетов npm/yarn/pnpm */
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  /** verbose */
  verbose?: boolean;
}

/** Дефолтные расширения VS Code */
export const DEFAULT_REQUIRED_EXTENSIONS = [
  'dbaeumer.vscode-eslint',
  'esbenp.prettier-vscode',
  'ms-python.python',
  'ms-python.vscode-pylance',
  'ms-vscode.vscode-typescript-next',
  'eamodio.gitlens',
];

/** Дефолтный менеджер пакетов */
export const DEFAULT_PACKAGE_MANAGER = 'npm' as const;
