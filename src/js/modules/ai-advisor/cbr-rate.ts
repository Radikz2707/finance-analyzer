
import { CbrOfficialFetcher } from '../research/providers/cbr-official-fetcher.js';

export interface CbrRateData {
  rate: number;
  date: string;
  source: string;
  lastUpdated: string;
  isFresh: boolean;
}

// Кэш в памяти: ставка + время последнего получения
let cachedRate: CbrRateData | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

/**
 * Получить ключевую ставку ЦБ РФ.
 *
 * Приоритет источников:
 * 1. Переменная окружения CBK_RATE_OVERRIDE (для ручной настройки)
 * 2. Кэш в памяти (5 минут)
 * 3. Реальный запрос к cbr.ru
 */
export async function getCbrKeyRate(): Promise<CbrRateData> {
  // 1. Проверяем кэш
  if (
    cachedRate &&
    Date.now() - new Date(cachedRate.lastUpdated).getTime() < CACHE_TTL_MS
  ) {
    return cachedRate;
  }

  // 2. Проверяем ручную настройку через переменную окружения
  const overrideRate = process.env.CBK_RATE_OVERRIDE;
  if (overrideRate) {
    const rate = parseFloat(overrideRate);
    if (!isNaN(rate) && rate > 0 && rate < 100) {
      cachedRate = {
        rate,
        date: new Date().toLocaleDateString('ru-RU'),
        source: 'ручная настройка (CBK_RATE_OVERRIDE)',
        lastUpdated: new Date().toISOString(),
        isFresh: true,
      };
      console.log('[ЦБ-СТАВКА] ✅ Ручная настройка:', cachedRate.rate + '%');
      return cachedRate;
    }
  }

  // 3. Реальный запрос к cbr.ru
  try {
    const fetcher = new CbrOfficialFetcher();
    const result = await fetcher.fetch();

    if (result.keyRate != null && result.keyRate > 0) {
      cachedRate = {
        rate: result.keyRate,
        date: result.keyRateDate ?? new Date().toLocaleDateString('ru-RU'),
        source: 'cbr.ru/hd_base/KeyRate/',
        lastUpdated: new Date().toISOString(),
        isFresh: true,
      };
      console.log('[ЦБ-СТАВКА] ✅ Получено с cbr.ru:', cachedRate.rate + '%');
      return cachedRate;
    }
  } catch (err) {
    console.warn('[ЦБ-СТАВКА] ⚠️ Ошибка получения с cbr.ru:', err instanceof Error ? err.message : err);
  }

  // 4. Fallback: последняя известная ставка
  const fallbackRate: CbrRateData = {
    rate: 14.0,
    date: '2026-09-08',
    source: 'fallback (cbr.ru недоступен)',
    lastUpdated: new Date().toISOString(),
    isFresh: false,
  };

  cachedRate = fallbackRate;
  return cachedRate;
}

/**
 * Очистить кэш (для тестирования)
 */
export function clearCbrRateCache(): void {
  cachedRate = null;
}

/**
 * Получить отформатированную строку для отображения
 */
export function formatCbrRateDisplay(rateData: CbrRateData): string {
  return (
    'Ключевая ставка ЦБ: ' +
    rateData.rate +
    '% ' +
    '(от ' +
    rateData.date +
    ') ' +
    'Источник: ' +
    rateData.source
  );
}

/**
 * Получить текущее значение кэша (для тестирования)
 */
export function getCachedRate(): CbrRateData | null {
  return cachedRate;
}
