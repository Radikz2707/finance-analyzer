import { __resetFundamentalsCacheForTests } from './cache.js';
import { collectStockFundamentals } from './fundamentals-service.js';
import { __resetSmartLabClientForTests } from './smart-lab-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function htmlResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? 'text/html; charset=utf-8'
          : null,
    },
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

function row(
  field: string,
  label: string,
  values: Array<string | number | null>,
  ltm: string | number | null,
): string {
  return (
    `<tr field="${field}"><th>${label}</th><th></th><td class="chartrow"></td>` +
    values.map((value) => `<td>${value === null ? ' ' : value}</td>`).join('') +
    `<td class="ltm_spc">&nbsp;</td><td>${ltm === null ? ' ' : ltm}</td></tr>`
  );
}

function financialsHtml(): string {
  return `
    <table class="simple-little-table financials">
      <tr class="header_row">
        <th colspan="2">Татнефть</th><td class="chartrow">&nbsp;</td>
        <td><strong>2021</strong></td><td><strong>2022</strong></td>
        <td><strong>2023</strong></td><td><strong>2024</strong></td>
        <td><strong>2025</strong></td><td class="ltm_spc">&nbsp;</td>
        <td class="editrow"><strong>LTM</strong></td>
      </tr>
      ${row('revenue', 'Выручка', ['1 205', '1 427', '1 589', '2 030', '1 818'], '1 822')}
      ${row('net_income', 'Чистая прибыль', ['198.4', '284.9', '286.3', '306.1', '158.6'], '265.8')}
      ${row('debt', 'Долг', ['32.2', '14.5', '22.9', '13.3', '35.0'], '10.8')}
      ${row('book_value', 'Баланс стоимость', ['938.4', '1 096', '1 191', '1 322', '1 290'], '1 379')}
      ${row('market_cap', 'Капитализация', ['1 156', '809.3', '1 653', '1 604', '1 346'], '1 364')}
      ${row('p_e', 'P/E', ['5.83', '2.84', '5.77', '5.24', '8.48'], '5.13')}
      ${row('roe', 'ROE', ['21.1%', '26.0%', '24.0%', '23.2%', '12.0%'], '19.0%')}
      ${row('div_yield', 'Див доход', ['8.5%', '19.3%', '12.4%', '14.3%', '5.9%'], '9.0%')}
      ${row('dividend', 'Дивиденд', ['12.0', '16.0', '27.0', '43.0', '34.0'], '34.09')}
    </table>
  `;
}

function dividendsHtml(): string {
  return `
    <table class="simple-little-table financials dividends sort-table">
      <tr class="header_row"><th>Тикер</th><th>дата T-1</th><th>дата отсечки</th><th>Период</th><th>дивиденд</th><th>Цена</th><th>Доходность</th></tr>
      <tr><td>TATN</td><td>12.10.2026</td><td>13.10.2026</td><td>2кв 2026</td><td>32,88₽</td><td>676</td><td>4,9%</td></tr>
    </table>
    <div class="notice_text">
      По итогам 2025 года компания Татнефть выплатила дивиденды в размере 34.09 рублей
      на обыкновенную акцию и 34.09 рублей на привилегированную акцию. Общий объем выплат
      составил 79.3 млрд рублей. Дивидендная доходность обыкновенной акции по текущей
      рыночной цене составляет 9.0%; дивидендная доходность привилегированной акции
      составляет 9.2%.
    </div>
  `;
}

interface MockOptions {
  smartLab?: 'ok' | 'broken' | 'offline';
  dividends?: 'unavailable' | 'iss';
  isDividendValue?: number;
}

function createFetchMock(options: MockOptions = {}) {
  const calls: string[] = [];
  const {
    smartLab = 'ok',
    dividends = 'unavailable',
    isDividendValue = 0,
  } = options;

  const mock = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);

    if (url.includes('/iss/securities/TATN.json')) {
      return jsonResponse({
        description: {
          columns: ['name', 'value'],
          data: [
            ['SECID', 'TATN'],
            ['SHORTNAME', 'Татнефть'],
            ['ISIN', 'RU0009033591'],
            ['ISSUESIZE', '2178690700'],
            ['FACEVALUE', '1'],
          ],
        },
        boards: {
          columns: ['boardid', 'is_primary'],
          data: [['TQBR', 1]],
        },
      });
    }

    if (url.includes('/boards/TQBR/securities/TATN.json')) {
      return jsonResponse({
        securities: {
          columns: ['SECID', 'PREVPRICE', 'ISSUESIZE'],
          data: [['TATN', 676, 2178690700]],
        },
        marketdata: {
          columns: ['SECID', 'LAST', 'ISSUECAPITALIZATION'],
          data: [['TATN', 676, 676 * 2178690700]],
        },
      });
    }

    if (url.includes('/securities/TATN/dividends.json')) {
      if (dividends === 'iss') {
        return jsonResponse({
          dividends: {
            columns: ['SECID', 'REGISTRYCLOSEDATE', 'VALUE'],
            data: [['TATN', '2026-10-13', isDividendValue]],
          },
        });
      }
      // Реальный MOEX ISS в этой среде отдаёт description/boards без таблицы dividends.
      return jsonResponse({
        description: { columns: ['name', 'value'], data: [['SECID', 'TATN']] },
        boards: { columns: ['boardid'], data: [['TQBR']] },
      });
    }

    if (url.includes('/securities/TATN/reports.json')) {
      return jsonResponse({
        description: { columns: ['name', 'value'], data: [['SECID', 'TATN']] },
      });
    }

    if (url.includes('smart-lab.ru/q/TATN/f/y/')) {
      if (smartLab === 'offline') throw new Error('network down');
      if (smartLab === 'broken')
        return htmlResponse('<html><body>captcha</body></html>');
      return htmlResponse(financialsHtml());
    }

    if (url.includes('smart-lab.ru/q/TATN/dividend/')) {
      if (smartLab === 'offline') throw new Error('network down');
      if (smartLab === 'broken')
        return htmlResponse('<html><body>captcha</body></html>');
      return htmlResponse(dividendsHtml());
    }

    return jsonResponse({}, 404);
  };

  return { mock, calls };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  __resetFundamentalsCacheForTests();
  __resetSmartLabClientForTests();
  process.env.FUNDAMENTALS_SMARTLAB_ENABLED = 'true';
  process.env.FUNDAMENTALS_SMARTLAB_INTERVAL_MS = '0';
  process.env.FUNDAMENTALS_CACHE_TTL_HOURS = '24';
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe('collectStockFundamentals', () => {
  it('заполняет P/E, ROE и дивдоходность из smart-lab с источником и датой', async () => {
    const { mock } = createFetchMock({ smartLab: 'ok' });
    vi.stubGlobal('fetch', vi.fn(mock));

    const result = await collectStockFundamentals('TATN', 'Татнефть');

    expect(result.pe.value).toBe(5.13);
    expect(result.pe.source).toBe('smart-lab.ru');
    expect(result.pe.asOf).toBeTruthy();
    expect(result.roe.value).toBe(19.0);
    expect(result.dividendYield.value).toBe(9.0);
    expect(result.debtToEquity.value).toBeCloseTo(10.8 / 1379, 6);
    expect(result.medians?.pe5y).toBe(5.77);
    expect(result.summary).toContain('P/E 5,13 (smart-lab.ru');
    expect(result.summary).toContain('медиана 5 лет');
    expect(result.sourcesUsed).toContain('MOEX ISS');
    expect(result.sourcesUsed).toContain('smart-lab.ru');
  });

  it('при расхождении >20% выбирает MOEX ISS и фиксирует конфликт', async () => {
    // 135,2 ₽ дивидендов на цену 676 ₽ = 20% против 9% у smart-lab.
    const { mock } = createFetchMock({
      smartLab: 'ok',
      dividends: 'iss',
      isDividendValue: 135.2,
    });
    vi.stubGlobal('fetch', vi.fn(mock));

    const result = await collectStockFundamentals('TATN', 'Татнефть');

    expect(result.dividendYield.value).toBeCloseTo(20, 6);
    expect(result.dividendYield.source).toBe('MOEX ISS');
    expect(result.dividendYield.status).toBe('CONFLICT');
    expect(result.dividendYield.conflictSource).toBe('smart-lab.ru');
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.summary).toContain('расхождение');
  });

  it('при отключённом smart-lab не подставляет числа и помечает поля недоступными', async () => {
    process.env.FUNDAMENTALS_SMARTLAB_ENABLED = 'false';
    const { mock } = createFetchMock({ smartLab: 'ok' });
    vi.stubGlobal('fetch', vi.fn(mock));

    const result = await collectStockFundamentals('TATN', 'Татнефть');

    expect(result.pe.value).toBeNull();
    expect(result.pe.status).toBe('UNAVAILABLE');
    expect(result.pe.note).toContain('отключён');
    expect(result.unavailable.join(' ')).toContain('smart-lab.ru');
  });

  it('при недоступности smart-lab не падает и возвращает честные пометки', async () => {
    const { mock } = createFetchMock({ smartLab: 'offline' });
    vi.stubGlobal('fetch', vi.fn(mock));

    const result = await collectStockFundamentals('TATN', 'Татнефть');

    expect(result.pe.value).toBeNull();
    expect(result.unavailable.join(' ')).toContain('smart-lab.ru');
    expect(result.summary).toContain('недоступно');
  });

  it('при изменении структуры страницы ставит флаг, а не нули', async () => {
    const { mock } = createFetchMock({ smartLab: 'broken' });
    vi.stubGlobal('fetch', vi.fn(mock));

    const result = await collectStockFundamentals('TATN', 'Татнефть');

    expect(result.pe.value).toBeNull();
    expect(result.unavailable.join(' ')).toContain('структура');
  });

  it('кэширует результат и не опрашивает smart-lab повторно', async () => {
    const { mock, calls } = createFetchMock({ smartLab: 'ok' });
    vi.stubGlobal('fetch', vi.fn(mock));

    await collectStockFundamentals('TATN', 'Татнефть');
    await collectStockFundamentals('TATN', 'Татнефть');

    const smartLabCalls = calls.filter((url) => url.includes('smart-lab.ru'));
    expect(smartLabCalls).toHaveLength(2); // financials + dividends, не 4
  });
});
