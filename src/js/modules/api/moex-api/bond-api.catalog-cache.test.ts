import { fetchBondCatalog, resetBondApiCaches } from './bond-api.js';

/**
 * Каталог TQOB — ~3 400 выпусков. `parseBondsSheet()` вызывается за прогон
 * несколько раз, поэтому повторная загрузка каталога превращается в лишние
 * волны запросов к ISS. Кэш должен отдавать справочник из процесса.
 */

const COLUMNS = [
  'SECID',
  'SECNAME',
  'BOARDNAME',
  'FACEVALUE',
  'YIELDATPREVWAPRICE',
  'MATDATE',
  'NEXTCOUPON',
  'COUPONVALUE',
  'COUPONPERIOD',
  'ICBRR',
  'SECTOR',
  'DECIMALS',
];

function catalogPayload(): Record<string, unknown> {
  return {
    securities: {
      columns: COLUMNS,
      data: [
        [
          'RU000A10GC20',
          'ВИС Ф БП17',
          'TQCB',
          1000,
          12.5,
          '2027-01-01',
          '2026-01-01',
          35.5,
          30,
          0.5,
          'Финансы',
          2,
        ],
      ],
    },
  };
}

function okResponse(payload: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

describe('fetchBondCatalog — кэш справочника в рамках процесса', () => {
  beforeEach(() => {
    resetBondApiCaches();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetBondApiCaches();
  });

  it('повторный вызов не идёт в сеть и возвращает тот же справочник', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(catalogPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchBondCatalog();
    expect(first).toHaveLength(1);
    expect(first[0]?.isin).toBe('RU000A10GC20');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await fetchBondCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('resetBondApiCaches сбрасывает справочник — следующий вызов снова в сеть', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(catalogPayload()));
    vi.stubGlobal('fetch', fetchMock);

    await fetchBondCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetBondApiCaches();

    await fetchBondCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('пустой результат ошибки не кэшируется: повторная попытка идёт в сеть', async () => {
    // fetchMoex пробует два endpoint'а, оба падают → два вызова fetch.
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchBondCatalog();
    expect(first).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = await fetchBondCatalog();
    expect(second).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
