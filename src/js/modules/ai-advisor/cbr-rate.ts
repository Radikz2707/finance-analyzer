
export interface CbrRateData {
  rate: number;
  date: string;
  source: string;
  lastUpdated: string;
}

// Кэш в памяти: ставка + время последнего получения
let cachedRate: CbrRateData | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

/**
 * Получить ключевую ставку ЦБ РФ.
 *
 * Приоритет источников:
 * 1. Переменная окружения CBK_RATE_OVERRIDE (для ручной настройки)
 * 2. Кэш в памяти (24 часа)
 * 3. Fallback: актуальная ставка
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
      };
      console.log('[ЦБ-СТАВКА] ✅ Ручная настройка:', cachedRate.rate + '%');
      return cachedRate;
    }
  }

  // 3. Fallback: актуальная ставка ЦБ (сентябрь 2026)
  //    Для обновления: измените значение ниже или установите CBK_RATE_OVERRIDE
  const fallbackRate: CbrRateData = {
    rate: 14.0,
    date: '2026-09-08',
    source: 'fallback (ручная актуализация)',
    lastUpdated: new Date().toISOString(),
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
