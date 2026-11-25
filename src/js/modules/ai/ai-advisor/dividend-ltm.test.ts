import type {
  MoexDividendRecord,
  SmartLabDividends,
} from '../../api/fundamentals/types.js';

const { mockFetchMoexDividends, mockFetchSmartLabDividends } = vi.hoisted(
  () => ({
    mockFetchMoexDividends: vi.fn(),
    mockFetchSmartLabDividends: vi.fn(),
  }),
);

vi.mock('../../api/fundamentals/moex-iss-client.js', () => ({
  fetchMoexDividends: mockFetchMoexDividends,
}));

vi.mock('../../api/fundamentals/smart-lab-client.js', () => ({
  fetchSmartLabDividends: mockFetchSmartLabDividends,
}));

import {
  computeLtmDividends,
  dividendLtmCutoff,
  fetchDividendLtm,
  resolveDividendSecid,
  resolveSmartLabTicker,
} from './dividend-ltm.js';

function record(
  registryDate: string,
  value: number | null,
  currency = 'RUB',
): MoexDividendRecord {
  return {
    secid: 'TEST',
    registryDate,
    declaredDate: null,
    value,
    currency,
  };
}

function smartLabDividends(
  ticker: string,
  rows: Array<[string, number]>,
): SmartLabDividends {
  return {
    ticker,
    asOf: '2026-11-18T00:00:00.000Z',
    records: rows.map(([registryDate, dividend]) => ({
      ticker,
      registryDate,
      period: null,
      dividend,
      price: null,
      yieldPct: null,
    })),
    annualDividend: null,
    currentYield: null,
    nextRegistryDate: null,
    parseOk: rows.length > 0,
  };
}

describe('resolveDividendSecid — отдельные SECID для префов', () => {
  it('Сбербанк-п → SBERP', () => {
    expect(resolveDividendSecid('SBER', 'Сбербанк-п')).toBe('SBERP');
    expect(resolveDividendSecid('SBERP')).toBe('SBERP');
    expect(resolveDividendSecid('SBER_AP')).toBe('SBERP');
  });

  it('Татнефть-п → TATNP', () => {
    expect(resolveDividendSecid('TATN', 'Татнефть привилегированная')).toBe(
      'TATNP',
    );
    expect(resolveDividendSecid('TATNP')).toBe('TATNP');
  });

  it('обыкновенная бумага не получает суффикс P', () => {
    expect(resolveDividendSecid('GAZP', 'Газпром')).toBe('GAZP');
    expect(resolveDividendSecid('PLZL', 'Полюс')).toBe('PLZL');
  });
});

describe('resolveSmartLabTicker — префы живут на странице обыкновенной акции', () => {
  it('SBERP/TATNP/SNGSP → SBER/TATN/SNGS', () => {
    expect(resolveSmartLabTicker('SBERP')).toBe('SBER');
    expect(resolveSmartLabTicker('TATNP')).toBe('TATN');
    expect(resolveSmartLabTicker('SNGSP')).toBe('SNGS');
    expect(resolveSmartLabTicker('PLZL')).toBe('PLZL');
  });
});

describe('computeLtmDividends — окно 13 месяцев', () => {
  const now = new Date('2026-11-18T00:00:00.000Z');

  it('PLZL → 121,85 ₽/акция LTM (сверка со smart-lab)', () => {
    const result = computeLtmDividends(
      [record('2026-06-01', 30), record('2025-12-15', 91.85)],
      now,
    );

    expect(result.ltmPerShare).toBe(121.85);
    expect(result.count).toBe(2);
    expect(result.asOf).toBe('2026-06-01');
  });

  it('SBER и TATN — по фактическим выплатам в окне', () => {
    const sber = computeLtmDividends(
      [record('2026-07-18', 33.3), record('2026-01-20', 25.5)],
      now,
    );
    expect(sber.ltmPerShare).toBe(58.8);
    expect(sber.count).toBe(2);

    const tatn = computeLtmDividends([record('2026-10-13', 32.88)], now);
    expect(tatn.ltmPerShare).toBe(32.88);
    expect(tatn.count).toBe(1);
  });

  it('граница окна: ровно 13 мес назад включена, на день раньше — нет', () => {
    expect(dividendLtmCutoff(now).toISOString().slice(0, 10)).toBe(
      '2025-10-18',
    );

    expect(
      computeLtmDividends([record('2025-10-18', 10)], now).ltmPerShare,
    ).toBe(10);
    expect(
      computeLtmDividends([record('2025-10-17', 10)], now).ltmPerShare,
    ).toBeNull();
  });

  it('конец месяца не «переполняется» (31 марта − 13 мес = 28 фев)', () => {
    const cutoff = dividendLtmCutoff(new Date('2026-03-31T00:00:00.000Z'));
    expect(cutoff.toISOString().slice(0, 10)).toBe('2025-02-28');
  });

  it('выплаты вне окна и не-рублёвые пропускаются', () => {
    const result = computeLtmDividends(
      [
        record('2024-01-01', 500),
        record('2026-05-01', 10, 'USD'),
        record('2026-08-01', 12.5),
      ],
      now,
    );

    expect(result.ltmPerShare).toBe(12.5);
    expect(result.count).toBe(1);
  });

  it('дубли (та же отсечка и сумма) не суммируются дважды', () => {
    const result = computeLtmDividends(
      [record('2026-07-13', 29.05), record('2026-07-13', 29.05)],
      now,
    );

    expect(result.ltmPerShare).toBe(29.05);
    expect(result.count).toBe(1);
  });

  it('пустая/битая история → null, не 0', () => {
    expect(computeLtmDividends([], now).ltmPerShare).toBeNull();
    expect(computeLtmDividends(null, now).ltmPerShare).toBeNull();
    expect(
      computeLtmDividends([record('not-a-date', 10)], now).ltmPerShare,
    ).toBeNull();
    expect(
      computeLtmDividends([record('2026-05-01', null)], now).ltmPerShare,
    ).toBeNull();
  });
});

describe('fetchDividendLtm — контракт, статусы и лог', () => {
  const now = new Date('2026-11-18T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchSmartLabDividends.mockResolvedValue(null);
  });

  it('ISS отдал таблицу → status=OK, source=MOEX_ISS, лог [DIVIDENDS_LTM_FETCH]', async () => {
    mockFetchMoexDividends.mockResolvedValue([
      record('2026-06-01', 30),
      record('2025-12-15', 91.85),
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await fetchDividendLtm('PLZL', 'Полюс', now);

    expect(mockFetchMoexDividends).toHaveBeenCalledWith('PLZL');
    expect(result.ltmPerShare).toBe(121.85);
    expect(result.source).toBe('MOEX_ISS');
    expect(result.status).toBe('OK');
    expect(result.asOf).toBe('2026-06-01');
    expect(
      log.mock.calls.some((call) =>
        String(call[0]).includes('[DIVIDENDS_LTM] ticker=PLZL'),
      ),
    ).toBe(true);
    expect(
      log.mock.calls.some(
        (call) =>
          String(call[0]).includes('status=OK') &&
          String(call[0]).includes('source=MOEX_ISS') &&
          String(call[0]).includes('iss=OK'),
      ),
    ).toBe(true);
    log.mockRestore();
  });

  it('ISS без таблицы dividends → резерв smart-lab, status=OK, source=SMARTLAB', async () => {
    // Реальный ISS на /securities/{SECID}/dividends отдаёт description/boards.
    mockFetchMoexDividends.mockResolvedValue(null);
    mockFetchSmartLabDividends.mockResolvedValue(
      smartLabDividends('PLZL', [
        ['2026-07-13', 29.05],
        ['2026-05-18', 56.8],
        ['2025-12-22', 36],
      ]),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await fetchDividendLtm('PLZL', 'Полюс', now);

    expect(mockFetchSmartLabDividends).toHaveBeenCalledWith('PLZL');
    expect(result.source).toBe('SMARTLAB');
    expect(result.status).toBe('OK');
    expect(result.ltmPerShare).toBe(121.85);
    expect(result.count).toBe(3);
    expect(result.diagnostics.iss).toBe('UNAVAILABLE');
    expect(result.diagnostics.smartLab).toBe('OK');
    expect(
      log.mock.calls.some((call) => String(call[0]).includes('smartlab=OK')),
    ).toBe(true);
    log.mockRestore();
  });

  it('преф: ISS по SBERP, smart-lab по SBER', async () => {
    mockFetchMoexDividends.mockResolvedValue(null);
    mockFetchSmartLabDividends.mockResolvedValue(
      smartLabDividends('SBER', [
        ['2026-07-20', 37.64],
        ['2025-07-18', 34.84],
      ]),
    );

    const result = await fetchDividendLtm('SBERP', 'Сбербанк-п', now);

    expect(mockFetchMoexDividends).toHaveBeenCalledWith('SBERP');
    expect(mockFetchSmartLabDividends).toHaveBeenCalledWith('SBER');
    expect(result.secid).toBe('SBERP');
    expect(result.ltmPerShare).toBe(37.64);
    expect(result.diagnostics.smartLabSecid).toBe('SBER');
  });

  it('источники ответили без выплат → status=EMPTY, не UNAVAILABLE', async () => {
    mockFetchMoexDividends.mockResolvedValue([]);
    mockFetchSmartLabDividends.mockResolvedValue(smartLabDividends('TATN', []));

    const result = await fetchDividendLtm('TATN', 'Татнефть', now);

    expect(result.ltmPerShare).toBeNull();
    expect(result.status).toBe('EMPTY');
    expect(result.source).toBe('UNAVAILABLE');
    expect(result.diagnostics.iss).toBe('EMPTY');
    expect(result.diagnostics.smartLab).toBe('EMPTY');
  });

  it('ошибка сети в обоих источниках → status=UNAVAILABLE, не бросает', async () => {
    mockFetchMoexDividends.mockRejectedValue(new Error('network down'));
    mockFetchSmartLabDividends.mockRejectedValue(new Error('network down'));

    const result = await fetchDividendLtm('TATN', 'Татнефть', now);

    expect(result.ltmPerShare).toBeNull();
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.source).toBe('UNAVAILABLE');
    expect(result.diagnostics.iss).toBe('UNAVAILABLE');
    expect(result.diagnostics.smartLab).toBe('UNAVAILABLE');
  });
});
