import {
  loadTechnicalHistory,
  type TechnicalHistoryBar,
  type TechnicalHistoryLoader,
} from './technical-history.js';

function bar(date: string, close: number): TechnicalHistoryBar {
  return { date, high: close + 1, low: close - 1, close };
}

function bars(count: number): TechnicalHistoryBar[] {
  return Array.from({ length: count }, (_, index) =>
    bar(`2026-01-${String(index + 1).padStart(2, '0')}`, 100 + index),
  );
}

function collector(): {
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
  };
  info: string[];
  warn: string[];
} {
  const info: string[] = [];
  const warn: string[] = [];
  return {
    info,
    warn,
    logger: {
      info: (message: string) => info.push(message),
      warn: (message: string) => warn.push(message),
    },
  };
}

describe('loadTechnicalHistory — один путь (MOEX ISS) с изоляцией сбоев', () => {
  it('успешная загрузка — источник moex-iss и атрибутированный лог', async () => {
    const load: TechnicalHistoryLoader = async (ticker) =>
      ticker === 'SBER' ? bars(30) : bars(25);
    const log = collector();

    const result = await loadTechnicalHistory(
      ['SBER', 'GAZP'],
      '2026-01-01',
      '2026-12-31',
      { load },
      log.logger,
    );

    expect(result).toHaveLength(2);
    expect(result.every((item) => item.source === 'moex-iss')).toBe(true);
    expect(result[0]?.bars).toHaveLength(30);
    expect(result[0]?.error).toBeNull();
    expect(log.warn).toHaveLength(0);
    expect(
      log.info.some((line) =>
        line.includes('ticker=SBER bars=30 source=moex-iss'),
      ),
    ).toBe(true);
    expect(
      log.info.some(
        (line) =>
          line.includes('tickers=2') &&
          line.includes('source=moex-iss loaded=2') &&
          line.includes('empty=[]'),
      ),
    ).toBe(true);
  });

  it('падение на одном тикере не обрывает остальные', async () => {
    const load: TechnicalHistoryLoader = async (ticker) => {
      if (ticker === 'RU000A10B4S9') {
        throw new Error('нет доски TQBR');
      }
      return bars(28);
    };
    const log = collector();

    const result = await loadTechnicalHistory(
      ['SBER', 'RU000A10B4S9'],
      '2026-01-01',
      '2026-12-31',
      { load },
      log.logger,
    );

    expect(result.map((item) => item.ticker)).toEqual(['SBER', 'RU000A10B4S9']);
    expect(result[0]?.source).toBe('moex-iss');
    expect(result[1]?.source).toBe('none');
    expect(result[1]?.bars).toHaveLength(0);
    expect(result[1]?.error).toContain('нет доски TQBR');
    expect(
      log.warn.some(
        (line) =>
          line.includes('ticker=RU000A10B4S9') &&
          line.includes('source=none') &&
          line.includes('нет доски TQBR'),
      ),
    ).toBe(true);
  });

  it('пустой результат — source=none с причиной, batch не падает', async () => {
    const load: TechnicalHistoryLoader = async () => [];
    const log = collector();

    const result = await loadTechnicalHistory(
      ['PLZL'],
      '2026-01-01',
      '2026-12-31',
      { load },
      log.logger,
    );

    expect(result[0]?.source).toBe('none');
    expect(result[0]?.error).toBe('moex-iss: пустая история');
    expect(log.info.some((line) => line.includes('empty=[PLZL]'))).toBe(true);
  });

  it('нормализует тикеры и убирает дубликаты, невалидные бары отбрасываются', async () => {
    const load: TechnicalHistoryLoader = async () => [
      { date: '2026-01-01', high: 101, low: 99, close: 100 },
      { date: '', high: 101, low: 99, close: 100 },
      { date: '2026-01-02', high: 101, low: 99, close: Number.NaN },
    ];

    const result = await loadTechnicalHistory(
      [' sber ', 'SBER', ''],
      '2026-01-01',
      '2026-12-31',
      { load },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.ticker).toBe('SBER');
    expect(result[0]?.bars).toHaveLength(1);
  });
});
