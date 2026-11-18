import { vi } from 'vitest';

import { createNextCouponResolver } from './next-coupon-fallback.js';

describe('createNextCouponResolver — кэш и лимит smart-lab', () => {
  it('возвращает дату и кэширует её по ISIN (повторный запрос не выполняется)', async () => {
    const fetchSmartLab = vi.fn(async () => ({
      nextCouponDate: '2026-12-11',
    }));
    const resolve = createNextCouponResolver({ fetchSmartLab });

    const first = await resolve('SU29027RMFS8');
    const second = await resolve('su29027rmfs8');

    expect(first?.toISOString().slice(0, 10)).toBe('2026-12-11');
    expect(second?.toISOString().slice(0, 10)).toBe('2026-12-11');
    expect(fetchSmartLab).toHaveBeenCalledTimes(1);
  });

  it('лимит запросов за прогон: сверх лимита дата не запрашивается', async () => {
    const fetchSmartLab = vi.fn(async () => ({ nextCouponDate: '2026-12-11' }));
    const warn: string[] = [];
    const resolve = createNextCouponResolver({
      fetchSmartLab,
      maxRequestsPerRun: 1,
      logger: { info: () => undefined, warn: (m) => warn.push(m) },
    });

    await resolve('AAA');
    const second = await resolve('BBB');

    expect(second).toBeNull();
    expect(fetchSmartLab).toHaveBeenCalledTimes(1);
    expect(warn.some((m) => m.includes('лимит 1 запросов'))).toBe(true);
  });

  it('ошибка источника кэшируется как null и не бросается', async () => {
    const fetchSmartLab = vi.fn(async () => {
      throw new Error('network');
    });
    const resolve = createNextCouponResolver({ fetchSmartLab });

    expect(await resolve('AAA')).toBeNull();
    expect(await resolve('AAA')).toBeNull();
    expect(fetchSmartLab).toHaveBeenCalledTimes(1);
  });

  it('нет даты в ответе → null и диагностический лог', async () => {
    const info: string[] = [];
    const warn: string[] = [];
    const resolve = createNextCouponResolver({
      fetchSmartLab: async () => ({ nextCouponDate: null }),
      logger: {
        info: (m) => info.push(m),
        warn: (m) => warn.push(m),
      },
    });

    expect(await resolve('SU29027RMFS8')).toBeNull();
    expect(
      info.some((m) => m.includes('isin=SU29027RMFS8 nextCouponDate=request')),
    ).toBe(true);
    expect(
      warn.some((m) => m.includes('isin=SU29027RMFS8 nextCouponDate=null')),
    ).toBe(true);
  });

  it('пустой ISIN не запрашивается', async () => {
    const fetchSmartLab = vi.fn(async () => ({ nextCouponDate: '2026-12-11' }));
    const resolve = createNextCouponResolver({ fetchSmartLab });

    expect(await resolve('   ')).toBeNull();
    expect(fetchSmartLab).not.toHaveBeenCalled();
  });
});
