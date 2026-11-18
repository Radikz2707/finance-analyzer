import {
  __resetSmartLabBondCacheForTests,
  fetchSmartLabBondByIsin,
  getSmartLabBondRequestCount,
} from './smart-lab-api.js';

const ISIN = 'RU000A10GC20';

function htmlResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () =>
      `<html><head><title>Облигация Тест с фиксированным купоном (${ISIN})</title></head><body></body></html>`,
  } as unknown as Response;
}

describe('fetchSmartLabBondByIsin — дедупликация по ISIN за прогон', () => {
  beforeEach(() => {
    __resetSmartLabBondCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('повторный вызов не делает второй запрос (rating/volume/date из одного fetch)', async () => {
    const fetchMock = vi.fn(async () => htmlResponse());
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchSmartLabBondByIsin(ISIN);
    const second = await fetchSmartLabBondByIsin(ISIN.toLowerCase());

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSmartLabBondRequestCount()).toBe(1);
  });

  it('параллельные вызовы делят один in-flight запрос', async () => {
    const fetchMock = vi.fn(async () => htmlResponse());
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      fetchSmartLabBondByIsin(ISIN),
      fetchSmartLabBondByIsin(` ${ISIN} `),
    ]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
