/**
 * Фолбэк даты ближайшего купона через smart-lab.
 *
 * Зачем: MOEX ISS не всегда отдаёт NEXTCOUPON (например, ОФЗ 29027).
 * Внешний источник даёт подтверждённую дату (эталон 11.12.2026), но
 * обращаться к нему на каждую бумагу и каждый прогон нельзя:
 *
 * - кэш по ISIN в рамках процесса: повторный запрос не выполняется;
 * - лимит запросов за прогон из `PortfolioConfig.bondCouponFallback`;
 * - ошибка источника кэшируется как null и не блокирует анализ.
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';
import {
  formatCalendarDate,
  parseCalendarDate,
} from '../../shared/date-utils.js';

/** Минимальный контракт ответа smart-lab для фолбэка. */
export interface SmartLabCouponSource {
  nextCouponDate?: string | Date | null;
}

export interface NextCouponFallbackLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface NextCouponFallbackOptions {
  fetchSmartLab: (isin: string) => Promise<SmartLabCouponSource | null>;
  maxRequestsPerRun?: number;
  logger?: NextCouponFallbackLogger;
}

/** Функция получения подтверждённой даты следующего купона. */
export type NextCouponResolver = (isin: string) => Promise<Date | null>;

/**
 * Создать резолвер даты купона с кэшем по ISIN и лимитом запросов.
 *
 * Резолвер создаётся на один прогон: счётчик запросов не переживает прогон,
 * кэш — переживает (в пределах процесса).
 */
export function createNextCouponResolver(
  options: NextCouponFallbackOptions,
): NextCouponResolver {
  const maxRequests =
    options.maxRequestsPerRun ??
    PortfolioConfig.bondCouponFallback.smartLabMaxRequestsPerRun;
  const cache = new Map<string, Date | null>();
  let requests = 0;

  return async (isin: string): Promise<Date | null> => {
    const key = isin.trim().toUpperCase();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key) ?? null;

    if (requests >= maxRequests) {
      options.logger?.warn(
        `[BOND_CARD] nextCouponDate=smart-lab лимит ${maxRequests} запросов за прогон исчерпан; ${key} — дата не запрошена`,
      );
      cache.set(key, null);
      return null;
    }

    requests++;
    try {
      options.logger?.info(
        `[BOND_CARD] isin=${key} nextCouponDate=request source=smart-lab ` +
          `request=${requests}/${maxRequests}`,
      );
      const bond = await options.fetchSmartLab(key);
      // Единый парсер: smart-lab может отдать и ISO, и ДД.ММ.ГГГГ.
      const date = parseCalendarDate(bond?.nextCouponDate);
      cache.set(key, date);
      if (date) {
        options.logger?.info(
          `[BOND_CARD] isin=${key} nextCouponDate=${formatCalendarDate(date)} source=smart-lab`,
        );
      } else {
        options.logger?.warn(
          `[BOND_CARD] isin=${key} nextCouponDate=null source=smart-lab ` +
            '(дата не найдена в HTML или источник вернул пусто)',
        );
      }
      return date;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.logger?.warn(
        `[BOND_CARD] isin=${key} nextCouponDate=smart-lab ошибка: ${message}`,
      );
      cache.set(key, null);
      return null;
    }
  };
}
