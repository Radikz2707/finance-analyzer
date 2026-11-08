/**
 * Браузерная заглушка db-manager (browser-safe).
 *
 * Реальный db-manager работает с better-sqlite3 (Node-only, native binary)
 * и физически не может попасть в браузерный webpack-бандл. В браузерной
 * сборке этот модуль автоматически подставляется вместо db-manager.ts
 * через NormalModuleReplacementPlugin (см. gulp/scripts.js).
 *
 * Поведение заглушки:
 * - БД не открывается (SQLite в браузере невозможен);
 * - все репозитории возвращают пустые коллекции / null;
 * - функция dbManager() — no-op.
 *
 * Node-контур (tsx / npm scripts / pipeline) продолжает использовать
 * настоящий db-manager.ts — замена применяется ТОЛЬКО внутри webpack.
 */

// Типы берём из оригинального модуля (type-only — в бандл не попадают)
type DbType = typeof import('./db-manager.js').db;
type PositionsRepoType = typeof import('./db-manager.js').positionsRepo;
type TradesRepoType = typeof import('./db-manager.js').tradesRepo;
type QuikOrdersRepoType = typeof import('./db-manager.js').quikOrdersRepo;
type NewsRepoType = typeof import('./db-manager.js').newsRepo;
type PricesRepoType = typeof import('./db-manager.js').pricesRepo;
type MacroRepoType = typeof import('./db-manager.js').macroRepo;
type GoalsRepoType = typeof import('./db-manager.js').goalsRepo;
type AccountsRepoType = typeof import('./db-manager.js').accountsRepo;
type ResearchCacheRepoType = typeof import('./db-manager.js').researchCacheRepo;

/** Пустой результат для prepared statement */
function prepareStub(): {
  all: () => never[];
  get: () => null;
  run: () => { changes: number; lastInsertRowid: number };
  iterate: () => never[];
} {
  return {
    all: () => [],
    get: () => null,
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    iterate: () => [],
  };
}

/** Заглушка объекта БД */
const dbStub = {
  prepare: prepareStub,
  exec: () => undefined,
  pragma: () => undefined,
  close: () => undefined,
} as unknown as DbType;

/** Экспорт заглушки БД (структурно совместим с оригиналом) */
export const db = dbStub;

/**
 * Фабрика no-op репозитория.
 *
 * Любой метод возвращает пустой массив; методы, начинающиеся с 'get',
 * возвращают null (одиночные выборки). 'then' исключён — чтобы объект
 * не выглядел thenable для await.
 */
function makeNoopRepo<T>(): T {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (target, prop) => {
      if (typeof prop !== 'string' || prop === 'then') {
        return undefined;
      }
      if (prop in target) {
        return target[prop];
      }
      const fn = (): unknown => (prop.startsWith('get') ? null : []);
      target[prop] = fn;
      return fn;
    },
  };
  return new Proxy({} as Record<string, unknown>, handler) as unknown as T;
}

/** Экспорты репозиториев (все — no-op заглушки) */
export const positionsRepo = makeNoopRepo<PositionsRepoType>();
export const tradesRepo = makeNoopRepo<TradesRepoType>();
export const quikOrdersRepo = makeNoopRepo<QuikOrdersRepoType>();
export const newsRepo = makeNoopRepo<NewsRepoType>();
export const pricesRepo = makeNoopRepo<PricesRepoType>();
export const macroRepo = makeNoopRepo<MacroRepoType>();
export const goalsRepo = makeNoopRepo<GoalsRepoType>();
export const accountsRepo = makeNoopRepo<AccountsRepoType>();
export const researchCacheRepo = makeNoopRepo<ResearchCacheRepoType>();

/** No-op инициализация (в браузере БД отсутствует) */
export const dbManager = (): void => {
  // Намеренный no-op: SQLite недоступен в браузерном окружении.
};
