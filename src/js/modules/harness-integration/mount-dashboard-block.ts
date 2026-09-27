/**
 * MountDashboardBlock — фронтенд-рендер блока «🛰 Harness» на дашборде.
 *
 * Браузеро-безопасный модуль (только DOM, без Node-зависимостей):
 * - ищет контейнер по селектору (по умолчанию #harnessBlock);
 * - запрашивает window.__FINANCE_HARNESS__.getPayload();
 * - вставляет formatDashboardHtml(payload) в innerHTML;
 * - кнопка «🚀 Ручной запуск анализа» работает через делегирование кликов;
 * - автобновление каждые 60 с; отписка при beforeunload/pagehide.
 *
 * Безопасность: если контейнера нет или API недоступно — тихий no-op.
 */

import { formatDashboardHtml } from './format-dashboard-html.js';
import type { HarnessDashboardPayload } from './types.js';

/** Период автобновления блока, мс */
export const DASHBOARD_REFRESH_INTERVAL_MS = 60_000;

/** Селектор контейнера по умолчанию */
export const DEFAULT_HARNESS_CONTAINER = '#harnessBlock';

/** Плейсхолдер во время первой загрузки */
const PLACEHOLDER_LOADING =
  '<div class="harness-block harness-placeholder">🛰 Загрузка состояния…</div>';

/** Плейсхолдер, когда API недоступно (браузер без Node-контура) */
const PLACEHOLDER_UNAVAILABLE =
  '<div class="harness-block harness-placeholder">' +
  '🛰 Harness недоступен: фоновый контур не активирован</div>';

/** Форма публичного API дашборда (окно window.__FINANCE_HARNESS__) */
interface HarnessWindowApiShape {
  getPayload(): Promise<HarnessDashboardPayload | null>;
  manualRun(): Promise<void>;
}

/** Достать API из window (null — если window или API отсутствуют) */
function getHarnessApi(): HarnessWindowApiShape | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const api = (
    window as unknown as {
      __FINANCE_HARNESS__?: HarnessWindowApiShape;
    }
  ).__FINANCE_HARNESS__;
  return api ?? null;
}

/**
 * Примонтировать блок «🛰 Harness» в указанный контейнер.
 * @param containerSelector — CSS-селектор контейнера (data-harness-container).
 * @returns функция отписки (очищает таймер и слушатели) или no-op.
 */
export function mountDashboardBlock(
  containerSelector: string = DEFAULT_HARNESS_CONTAINER,
): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const container = document.querySelector<HTMLElement>(containerSelector);
  if (!container) {
    return () => {};
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  /** Один цикл рендера: payload → HTML + делегирование кнопки */
  const render = async (): Promise<void> => {
    if (disposed) {
      return;
    }

    // Скрытая вкладка: рендер пропускаем — при возврате (visibilitychange)
    // блок обновится немедленно (слушатель ниже).
    if (document.hidden) {
      return;
    }

    try {
      const api = getHarnessApi();
      const payload = api ? await api.getPayload() : null;
      if (disposed) {
        return;
      }

      container.innerHTML = payload
        ? formatDashboardHtml(payload)
        : PLACEHOLDER_UNAVAILABLE;
    } catch (err) {
      if (!disposed) {
        console.warn('[HarnessBlock] Ошибка рендера блока:', err);
      }
    }
  };

  /** Делегированный клик: кнопка ручного запуска анализа */
  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('#harnessManualRun')) {
      return;
    }
    const api = getHarnessApi();
    if (!api) {
      return;
    }
    void api.manualRun().catch((err: unknown) => {
      console.warn('[HarnessBlock] Ошибка ручного запуска:', err);
    });
  };

  /** Возврат на вкладку: немедленное обновление данных */
  const onVisibilityChange = (): void => {
    if (!document.hidden) {
      void render();
    }
  };

  /** Полная отписка: таймер + слушатели */
  const cleanup = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    container.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('beforeunload', cleanup);
    window.removeEventListener('pagehide', cleanup);
  };

  // Старт: плейсхолдер → первый рендер → автобновление
  container.innerHTML = PLACEHOLDER_LOADING;
  container.addEventListener('click', onClick);
  void render();
  timer = setInterval(() => {
    void render();
  }, DASHBOARD_REFRESH_INTERVAL_MS);

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('pagehide', cleanup);

  return cleanup;
}
