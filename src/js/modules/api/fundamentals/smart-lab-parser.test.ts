import {
  median,
  parseSmartLabDividends,
  parseSmartLabFinancials,
  parseSmartLabNumber,
} from './smart-lab-parser.js';

function row(
  field: string,
  label: string,
  values: Array<string | number | null>,
  ltm: string | number | null,
): string {
  const yearCells = values
    .map((value) => `<td>${value === null ? ' ' : value}</td>`)
    .join('');
  return (
    `<tr field="${field}">` +
    `<th><a href="#">${label}</a></th><th></th>` +
    '<td class="chartrow"></td>' +
    yearCells +
    '<td class="ltm_spc">&nbsp;</td>' +
    `<td>${ltm === null ? ' ' : ltm}</td>` +
    '</tr>'
  );
}

function buildFinancialsPage(): string {
  return `
    <html><body>
    <table class="simple-little-table financials" cellspacing="0">
      <tr><td colspan="11"><h1>Татнефть (TATN): годовая финансовая отчетность МСФО</h1></td></tr>
      <tr class="header_row">
        <th colspan="2">Татнефть</th>
        <td class="chartrow">&nbsp;</td>
        <td><strong>2021</strong></td>
        <td><strong>2022</strong></td>
        <td><strong>2023</strong></td>
        <td><strong>2024</strong></td>
        <td><strong>2025</strong></td>
        <td class="ltm_spc">&nbsp;</td>
        <td class="editrow"><strong>LTM</strong></td>
      </tr>
      ${row('revenue', 'Выручка, млрд руб', ['1 205', '1 427', '1 589', '2 030', '1 818'], '1 822')}
      ${row('net_income', 'Чистая прибыль, млрд руб', ['198.4', '284.9', '286.3', '306.1', '158.6'], '265.8')}
      ${row('ebitda', 'EBITDA, млрд руб', ['283.4', '447.1', '391.7', '478.4', '327.5'], '442.3')}
      ${row('debt', 'Долг, млрд руб', ['32.2', '14.5', '22.9', '13.3', '35.0'], '10.8')}
      ${row('book_value', 'Баланс стоимость, млрд руб', ['938.4', '1 096', '1 191', '1 322', '1 290'], '1 379')}
      ${row('market_cap', 'Капитализация, млрд руб', ['1 156', '809.3', '1 653', '1 604', '1 346'], '1 364')}
      ${row('p_e', 'P/E', ['5.83', '2.84', '5.77', '5.24', '8.48'], '5.13')}
      ${row('roe', 'ROE, %', ['21.1%', '26.0%', '24.0%', '23.2%', '12.0%'], '19.0%')}
      ${row('div_yield', 'Див доход, ао, %', ['8.5%', '19.3%', '12.4%', '14.3%', '5.9%'], '9.0%')}
      ${row('dividend', 'Дивиденд, руб/акцию', ['12.0', '16.0', '27.0', '43.0', '34.0'], '34.09')}
    </table>
    </body></html>
  `;
}

describe('parseSmartLabNumber', () => {
  it('разбирает русские числа, проценты и пробелы', () => {
    expect(parseSmartLabNumber('1 205')).toBe(1205);
    expect(parseSmartLabNumber('21.1%')).toBe(21.1);
    expect(parseSmartLabNumber('32,88 ₽')).toBe(32.88);
    expect(parseSmartLabNumber('(1 205)')).toBe(-1205);
  });

  it('возвращает null для пустых значений, а не 0', () => {
    expect(parseSmartLabNumber(' ')).toBeNull();
    expect(parseSmartLabNumber('—')).toBeNull();
    expect(parseSmartLabNumber('')).toBeNull();
  });
});

describe('median', () => {
  it('считает медиану по непустым значениям', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('возвращает null, если чисел меньше трёх', () => {
    expect(median([1, null, 3])).toBeNull();
  });
});

describe('parseSmartLabFinancials', () => {
  it('извлекает P/E, ROE, дивдоходность, долг/капитал и медианы', () => {
    const parsed = parseSmartLabFinancials(
      buildFinancialsPage(),
      'TATN',
      '2026-11-17T00:00:00.000Z',
    );

    expect(parsed.parseOk).toBe(true);
    expect(parsed.years).toEqual(['2021', '2022', '2023', '2024', '2025']);
    expect(parsed.current['p_e']).toBe(5.13);
    expect(parsed.current['roe']).toBe(19.0);
    expect(parsed.current['div_yield']).toBe(9.0);
    expect(parsed.current['debt']).toBe(10.8);
    expect(parsed.current['book_value']).toBe(1379);
    expect(parsed.medians['p_e']).toBe(5.77);
    expect(parsed.medians['roe']).toBe(23.2);
    expect(parsed.medians['div_yield']).toBe(12.4);
    expect(parsed.missingFields).not.toContain('p_e');
  });

  it('не подставляет нули, если структура страницы изменилась', () => {
    const parsed = parseSmartLabFinancials(
      '<html><body><table class="financials"><tr><td>нет данных</td></tr></table></body></html>',
      'TATN',
    );

    expect(parsed.parseOk).toBe(false);
    expect(parsed.parseError).toBeTruthy();
    expect(parsed.current['p_e']).toBeUndefined();
    expect(parsed.current['roe']).toBeUndefined();
  });
});

describe('parseSmartLabDividends', () => {
  const html = `
    <html><body>
    <table class="simple-little-table financials dividends sort-table">
      <tr class="header_row">
        <th>Тикер</th><th>дата T-1</th><th>дата отсечки</th>
        <th>Период</th><th>дивиденд</th><th>Цена акции</th><th>Див. доходность</th>
      </tr>
      <tr>
        <td>TATN</td><td>12.10.2026</td><td>13.10.2026</td>
        <td>2кв 2026</td><td><strong>32,88</strong>₽</td><td>676</td><td><strong>4,9%</strong></td>
      </tr>
      <tr>
        <td>TATNP</td><td>12.10.2026</td><td>13.10.2026</td>
        <td>2кв 2026</td><td><strong>32,88</strong>₽</td><td>649,8</td><td><strong>5,1%</strong></td>
      </tr>
      <tr>
        <td>TATN</td><td>14.07.2026</td><td>15.07.2026</td>
        <td>4кв 2025</td><td><strong>11,61</strong>₽</td><td>486,9</td><td><strong>2,4%</strong></td>
      </tr>
    </table>
    <div class="notice_text">
      По итогам 2025 года компания Татнефть выплатила дивиденды в размере 34.09 рублей
      на обыкновенную акцию и 34.09 рублей на привилегированную акцию. Общий объем выплат
      составил 79.3 млрд рублей. Дивидендная доходность обыкновенной акции по текущей
      рыночной цене составляет 9.0%; дивидендная доходность привилегированной акции
      составляет 9.2%.
    </div>
    </body></html>
  `;

  it('парсит только обыкновенные акции и сводку', () => {
    const parsed = parseSmartLabDividends(
      html,
      'TATN',
      '2026-11-17T00:00:00.000Z',
    );

    expect(parsed.parseOk).toBe(true);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]?.ticker).toBe('TATN');
    expect(parsed.records[0]?.registryDate).toBe('2026-10-13');
    expect(parsed.records[0]?.dividend).toBe(32.88);
    expect(parsed.records[0]?.yieldPct).toBe(4.9);
    expect(parsed.annualDividend).toBe(34.09);
    expect(parsed.currentYield).toBe(9.0);
  });

  it('возвращает parseOk=false без таблицы и сводки', () => {
    const parsed = parseSmartLabDividends('<html></html>', 'TATN');
    expect(parsed.parseOk).toBe(false);
    expect(parsed.currentYield).toBeNull();
    expect(parsed.records).toEqual([]);
  });
});
