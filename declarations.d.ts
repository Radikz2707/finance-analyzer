// Изображения
declare module '*.svg';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.webp';
declare module '*.gif';

// Стили
declare module '*.scss';
declare module '*.css';

// Шрифты (на всякий случай)
declare module '*.woff';
declare module '*.woff2';

// Типизация process.env
interface EnvVariable {
  (name: string): string | undefined;
}

interface NodeJSProcessEnv {
  NODE_ENV?: 'development' | 'production' | 'test';
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ADMIN_IDS?: string;
  OPENROUTER_API_KEY?: string;
  GIGACHAT_API_KEY?: string;
  PROXYAPI_KEY?: string;
  YANDEXGPT_API_KEY?: string;
  EXCEL_FILE_PATH?: string;
  AI_CACHE_ENABLED?: string;
  AI_MODEL_ID?: string;
  LOCAL_SERVER_FOLDER?: string | null;
}

declare const process: {
  env: NodeJSProcessEnv;
  cwd: () => string;
  on: (event: string, callback: () => void) => void;
  exit: (code?: number) => never;
  argv: string[];
};
