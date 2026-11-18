import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { resolvePreferredTicker } from './preferred-resolver.js';

interface MockPayload {
  securities?: {
    columns: string[];
    data: unknown[][];
  };
}

function mockFetch(payload: MockPayload): typeof fetch {
  return (async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

function securities(rows: Array<[string, string, string]>): MockPayload {
  return {
    securities: {
      columns: ['secid', 'shortname', 'type'],
      data: rows,
    },
  };
}

describe('resolvePreferredTicker — ISS как основной путь', () => {
  it('находит обыкновенную акцию того же эмитента через MOEX ISS', async () => {
    const requests: string[] = [];
    const fetchImpl = (async (url: string) => {
      requests.push(url);
      return {
        ok: true,
        json: async () =>
          securities([
            ['SBERP', 'Сбербанк-п', '2'],
            ['SBER', 'Сбербанк', '1'],
            ['GAZP', 'Газпром', '1'],
          ]),
      };
    }) as unknown as typeof fetch;

    const result = await resolvePreferredTicker(' sberp ', { fetchImpl });

    expect(result.preferredTicker).toBe('SBERP');
    expect(result.commonTicker).toBe('SBER');
    expect(result.source).toBe('MOEX ISS');
    expect(requests[0]).toContain('q=SBERP');
  });

  it('распознаёт суффикс «ап» в имени префа', async () => {
    const result = await resolvePreferredTicker('TATNP', {
      fetchImpl: mockFetch(
        securities([
          ['TATNP', 'Татнефть ап', '2'],
          ['TATN', 'Татнефть', '1'],
        ]),
      ),
    });

    expect(result.commonTicker).toBe('TATN');
    expect(result.source).toBe('MOEX ISS');
  });

  it('не выбирает преф вместо обыкновенной при похожих именах', async () => {
    const result = await resolvePreferredTicker('SBERP', {
      fetchImpl: mockFetch(
        securities([
          ['SBERP', 'Сбербанк-п', '2'],
          ['SBERP2', 'Сбербанк-п 2', '2'],
        ]),
      ),
      fallback: {},
    });

    expect(result.commonTicker).toBeNull();
    expect(result.source).toBe('NONE');
  });
});

describe('resolvePreferredTicker — конфиг-фолбэк', () => {
  it('ISS не дал пары → используется конфиг-фолбэк', async () => {
    const result = await resolvePreferredTicker('SBERP', {
      fetchImpl: mockFetch(securities([])),
    });

    expect(result.commonTicker).toBe('SBER');
    expect(result.source).toBe('CONFIG');
  });

  it('конфиг-фолбэк по умолчанию содержит SBERP → SBER', () => {
    expect(PortfolioConfig.preferredFallback['SBERP']).toBe('SBER');
  });

  it('нет пары и нет фолбэка → null (fail-closed)', async () => {
    const result = await resolvePreferredTicker('SBERP', {
      fetchImpl: mockFetch(securities([])),
      fallback: {},
    });

    expect(result.commonTicker).toBeNull();
    expect(result.source).toBe('NONE');
    expect(result.reason).toContain('не подтверждена');
  });

  it('ошибка сети → фолбэк, а не выдуманная пара', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const result = await resolvePreferredTicker('SBERP', { fetchImpl });

    expect(result.commonTicker).toBe('SBER');
    expect(result.source).toBe('CONFIG');
  });

  it('некорректный тикер не уходит в сеть', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return { ok: true, json: async () => securities([]) };
    }) as unknown as typeof fetch;

    const result = await resolvePreferredTicker('SBER P', { fetchImpl });

    expect(called).toBe(false);
    expect(result.source).toBe('NONE');
    expect(result.reason).toBe('некорректный тикер');
  });
});
