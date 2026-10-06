/**
 * Ambient-декларации gulp-плагинов, у которых нет собственных типов.
 *
 * Проверено по node_modules (package.json → types/typings и наличие @types/):
 * перечисленные ниже пакеты не поставляют деклараций. Декларации описывают
 * ТОЛЬКО те сигнатуры, которые реально используются в gulp/*.js.
 *
 * ⚠️ Стиль деклараций зависит от способа подключения в коде:
 * - `require(...)` (createRequire) → `export =` (CJS-экспорт целиком);
 * - `import ... from` (ESM) → `export default`.
 */

// ─── CJS-пакеты (загружаются через require()) ──────────────────────────────

declare module 'webpack-stream' {
  import type { Configuration } from 'webpack';
  import type { Transform } from 'node:stream';

  /** Колбэк статистики webpack (контракт: hasErrors + errors из toJson). */
  type WebpackStreamCallback = (
    err: unknown,
    stats?: {
      hasErrors(): boolean;
      toJson(): { errors: Array<{ message?: string }> };
    },
  ) => void;

  /**
   * Обёртка webpack в gulp-поток.
   * Вторым аргументом принимается сам модуль webpack, третьим — колбэк статистики.
   */
  function webpackStream(
    config: Configuration,
    webpack?: unknown,
    callback?: WebpackStreamCallback,
  ): Transform;

  export = webpackStream;
}

declare module 'gulp-clean-css' {
  import type { Transform } from 'node:stream';

  interface CleanCssLevel1 {
    all?: boolean;
    transform?: (name: string, value: string) => string;
  }

  interface CleanCssLevel2 {
    all?: boolean;
    mergeMedia?: boolean;
    mergeAdjacentRules?: boolean;
    removeDistinctSemicolons?: boolean;
    removeDuplicateRules?: boolean;
    restructureRules?: boolean;
  }

  interface CleanCssOptions {
    level?: {
      1?: CleanCssLevel1;
      2?: CleanCssLevel2;
    };
  }

  function cleancss(options?: CleanCssOptions): Transform;

  export = cleancss;
}

declare module 'gulp-rename' {
  import type { Transform } from 'node:stream';

  interface RenameOptions {
    basename?: string;
    suffix?: string;
    extname?: string;
    prefix?: string;
    dirname?: string;
  }

  function rename(options: RenameOptions): Transform;

  export = rename;
}

declare module 'gulp-sass' {
  import type { Transform } from 'node:stream';

  interface SassOptions {
    silenceDeprecations?: string[];
    loadPaths?: string[];
    sourceMap?: boolean;
  }

  /** Фабрика gulp-sass: принимает sass-компилятор, возвращает таск. */
  function gulpSass(
    compiler: unknown,
    options?: SassOptions,
  ): (options?: SassOptions) => Transform;

  export = gulpSass;
}

declare module 'node-notifier' {
  interface NotificationOptions {
    title?: string;
    message?: string;
    sound?: boolean;
    wait?: boolean;
  }

  const notifier: { notify(options: NotificationOptions): void };

  export = notifier;
}

// ─── ESM-пакеты (загружаются через import) ─────────────────────────────────

declare module 'gulp-plumber' {
  import type { Transform } from 'node:stream';

  interface PlumberOptions {
    /** Переопределение стандартного обработчика ошибок потока. */
    errorHandler?: (error: unknown) => void;
    inherit?: boolean;
  }

  const plumber: (options?: PlumberOptions) => Transform;
  export default plumber;
}

declare module 'gulp-zip' {
  import type { Transform } from 'node:stream';

  const zip: (filename: string, options?: Record<string, unknown>) => Transform;
  export default zip;
}

declare module 'gulp-postcss' {
  import type { Transform } from 'node:stream';

  const postcss: (plugins?: unknown[]) => Transform;
  export default postcss;
}

declare module 'webp-in-css/plugin.js' {
  /** Плагин webp-in-css (CommonJS): default и сам модуль могут дублироваться. */
  interface WebpInCssModule {
    default?: unknown;
    [key: string]: unknown;
  }

  const mod: WebpInCssModule;
  export default mod;
}

declare module 'gulp-file-include' {
  import type { Transform } from 'node:stream';

  interface FileIncludeOptions {
    prefix?: string;
    basepath?: string;
    filters?: Record<string, unknown>;
    indent?: boolean;
    context?: Record<string, unknown>;
  }

  const fileInclude: (options?: FileIncludeOptions) => Transform;
  export default fileInclude;
}

declare module 'gulp-html-beautify' {
  import type { Transform } from 'node:stream';

  const htmlBeautify: (options?: Record<string, unknown>) => Transform;
  export default htmlBeautify;
}

declare module 'gulp-htmlhint' {
  import type { Transform } from 'node:stream';

  type HtmlhintRules = Record<string, unknown>;

  function htmlhint(rules?: HtmlhintRules): Transform;

  namespace htmlhint {
    function reporter(
      name: string,
      options?: { failReporter?: boolean },
    ): Transform;
  }

  export = htmlhint;
}
