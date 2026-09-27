/**
 * Moex Quote Provider Tests — резервный источник котировок через Python.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. Mock bridge (Python доступен, возвращает quotes) → маппинг корректен
 * 2. Bridge недоступен (бросает) → {}
 * 3. Пустой ответ (ok=false / без quotes) → {}
 * 4. Пустой список тикеров → {} (без обращения к мосту)
 * 5. Некорректные цены пропускаются, LAST в виде строки конвертируется
 */

import { MoexQuoteProvider } from './index.js';
import type {
  IPythonBridge,
  MoexQuotesResponse,
  PythonRequest,
} from './index.js';

/** Мост с фиксированным ответом для get_quotes */
class StubBridge implements IPythonBridge {
  calls: PythonRequest[] = [];

  constructor(
    private readonly response: MoexQuotesResponse | null = null,
    private readonly throws: boolean = false,
  ) {}

  async call<T>(request: PythonRequest): Promise<T> {
    this.calls.push(request);
    if (this.throws) {
      throw new Error('python crashed');
    }
    return (this.response ?? { ok: false }) as T;
  }

  async isAvailable(): Promise<boolean> {
    return !this.throws;
  }

  isScriptAvailable(): boolean {
    return true;
  }
}

/** Полный успешный ответ как у src/python/moex_client.py::get_quotes */
function makeQuotesResponse(): MoexQuotesResponse {
  return {
    ok: true,
    quotes: [
      { SECID: 'SBER', LAST: 250.5, LASTCHANGEPCT: 1.25, VALTODAY: 10 },
      { SECID: 'GAZP', LAST: '180.2', LASTCHANGEPCT: '-0.75' },
      { SECID: 'LKOH', LAST: null, LASTCHANGEPCT: 0 },
    ],
  };
}

describe('MoexQuoteProvider', () => {
  it('mock bridge возвращает quotes → маппинг SECID → { price, changePct }', async () => {
    const bridge = new StubBridge(makeQuotesResponse());
    const provider = new MoexQuoteProvider({ bridge });

    const result = await provider.fetchQuotes(['SBER', 'GAZP']);

    expect(result).toEqual({
      SBER: { price: 250.5, changePct: 1.25 },
      GAZP: { price: 180.2, changePct: -0.75 },
    });
    // Один запрос к мосту с корректной командой и payload
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]!.command).toBe('get_quotes');
    expect(bridge.calls[0]!.payload?.tickers).toEqual(['SBER', 'GAZP']);
  });

  it('тикеры нормализуются в верхний регистр и пустые отбрасываются', async () => {
    const bridge = new StubBridge(makeQuotesResponse());
    const provider = new MoexQuoteProvider({ bridge });

    const result = await provider.fetchQuotes(['sber', '  ', '', 'GAZP']);

    expect(bridge.calls[0]!.payload?.tickers).toEqual(['SBER', 'GAZP']);
    expect(result['SBER']).toEqual({ price: 250.5, changePct: 1.25 });
  });

  it('недоступный Python → {} (без проброса ошибки)', async () => {
    const bridge = new StubBridge(null, true);
    const provider = new MoexQuoteProvider({ bridge });

    const result = await provider.fetchQuotes(['SBER']);
    expect(result).toEqual({});
  });

  it('пустой ответ (ok=false) → {}', async () => {
    const bridge = new StubBridge({ ok: false, error: 'empty tickers' });
    const provider = new MoexQuoteProvider({ bridge });

    const result = await provider.fetchQuotes(['SBER']);
    expect(result).toEqual({});
  });

  it('ответ без quotes → {}', async () => {
    const bridge = new StubBridge({ ok: true });
    const provider = new MoexQuoteProvider({ bridge });

    const result = await provider.fetchQuotes(['SBER']);
    expect(result).toEqual({});
  });

  it('пустой список тикеров → {} без обращения к мосту', async () => {
    const bridge = new StubBridge(makeQuotesResponse());
    const provider = new MoexQuoteProvider({ bridge });

    const result = await provider.fetchQuotes([]);
    expect(result).toEqual({});
    expect(bridge.calls).toHaveLength(0);
  });

  it('записи с некорректной ценой (null/0/NaN) пропускаются', async () => {
    const bridge = new StubBridge({
      ok: true,
      quotes: [
        { SECID: 'OK1', LAST: 100, LASTCHANGEPCT: 1 },
        { SECID: 'BAD1', LAST: 0, LASTCHANGEPCT: 1 },
        { SECID: 'BAD2', LAST: null, LASTCHANGEPCT: 1 },
        { SECID: 'BAD3', LAST: 'NaN', LASTCHANGEPCT: 1 },
        { SECID: 'BAD4', LAST: undefined, LASTCHANGEPCT: 1 },
      ],
    });
    const provider = new MoexQuoteProvider({ bridge });

    const result = await provider.fetchQuotes([
      'OK1',
      'BAD1',
      'BAD2',
      'BAD3',
      'BAD4',
    ]);

    expect(Object.keys(result)).toEqual(['OK1']);
    expect(result['OK1']).toEqual({ price: 100, changePct: 1 });
  });
});
