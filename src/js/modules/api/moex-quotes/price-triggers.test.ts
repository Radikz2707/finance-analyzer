import { vi } from 'vitest';

import {
  evaluatePriceTriggers,
  parsePriceTriggers,
  type PriceTriggerBlock,
} from './price-triggers.js';

function silentLog(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'log').mockImplementation(() => undefined);
}

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .map((call) => call.map((value) => String(value)).join(' '))
    .join('\n');
}

function fenced(json: string): string {
  return '```json\n' + json + '\n```';
}

describe('parsePriceTriggers — структура JSON-блока', () => {
  it('извлекает ticker/levels/action из огороженного блока priceTriggers', () => {
    const log = silentLog();
    const result = parsePriceTriggers(
      'Вступление.\n\n' +
        fenced(
          JSON.stringify({
            priceTriggers: [
              {
                ticker: 'PLZL',
                levels: [
                  { price: 1100, direction: 'above' },
                  { price: 900, direction: 'below' },
                ],
                action: 'HOLD',
              },
            ],
          }),
        ) +
        '\n\nХвост.',
    );

    expect(result.structure).toBe('present');
    expect(result.triggers).toHaveLength(1);
    expect(result.triggers[0]?.ticker).toBe('PLZL');
    expect(result.triggers[0]?.action).toBe('HOLD');
    expect(result.triggers[0]?.levels).toEqual([
      { price: 1100, direction: 'above' },
      { price: 900, direction: 'below' },
    ]);
    expect(logged(log)).toContain('[PRICE_TRIGGER] structure=present');
    log.mockRestore();
  });

  it('принимает массив блоков напрямую', () => {
    const log = silentLog();
    const result = parsePriceTriggers(
      fenced(
        JSON.stringify([
          {
            ticker: 'SBER',
            levels: [{ price: 280, direction: 'below' }],
            action: 'BUY',
          },
        ]),
      ),
    );

    expect(result.structure).toBe('present');
    expect(result.triggers[0]?.ticker).toBe('SBER');
    log.mockRestore();
  });

  it('без JSON-блока триггеров нет и пишется structure=absent', () => {
    const log = silentLog();
    const result = parsePriceTriggers('Обычный текст без машинного блока.');

    expect(result.triggers).toEqual([]);
    expect(result.structure).toBe('absent');
    expect(logged(log)).toContain('[PRICE_TRIGGER] structure=absent');
    log.mockRestore();
  });

  it('битый JSON не создаёт триггеров', () => {
    const log = silentLog();
    const result = parsePriceTriggers(fenced('{"priceTriggers": [oops'));

    expect(result.triggers).toEqual([]);
    expect(result.structure).toBe('absent');
    log.mockRestore();
  });

  it('тикер с пробелами и скобками отбрасывается целиком', () => {
    const log = silentLog();
    const result = parsePriceTriggers(
      fenced(
        JSON.stringify([
          {
            ticker: 'SBER (Сбербанк)',
            levels: [{ price: 280, direction: 'below' }],
            action: 'BUY',
          },
        ]),
      ),
    );

    expect(result.triggers).toEqual([]);
    expect(result.structure).toBe('absent');
    log.mockRestore();
  });

  it('уровень без направления или с неположительной ценой отбрасывается', () => {
    const log = silentLog();
    const result = parsePriceTriggers(
      fenced(
        JSON.stringify([
          {
            ticker: 'GAZP',
            levels: [
              { price: 120 },
              { price: 0, direction: 'above' },
              { price: -5, direction: 'below' },
            ],
            action: 'HOLD',
          },
        ]),
      ),
    );

    expect(result.triggers).toEqual([]);
    expect(result.structure).toBe('absent');
    log.mockRestore();
  });

  it('дубликаты одинаковых блоков схлопываются', () => {
    const log = silentLog();
    const block = {
      ticker: 'PLZL',
      levels: [{ price: 1100, direction: 'above' }],
      action: 'HOLD',
    };
    const result = parsePriceTriggers(
      fenced(JSON.stringify([block])) + '\n' + fenced(JSON.stringify([block])),
    );

    expect(result.triggers).toHaveLength(1);
    log.mockRestore();
  });
});

describe('evaluatePriceTriggers — сверка с ценой', () => {
  const block: PriceTriggerBlock = {
    ticker: 'PLZL',
    levels: [
      { price: 1100, direction: 'above' },
      { price: 900, direction: 'below' },
    ],
    action: 'HOLD',
  };

  it('цена выросла до уровня above → триггер сработал', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers([block], {
      quotes: { PLZL: { last: 1100, asOf: '2026-11-18T13:00:00Z' } },
    });

    expect(result?.triggered).toBe(true);
    expect(result?.level?.price).toBe(1100);
    expect(result?.asOf).toBe('2026-11-18T13:00:00Z');
    expect(logged(log)).toContain(
      '[PRICE_TRIGGER] ticker=PLZL price=1100 level=1100 action=HOLD',
    );
    log.mockRestore();
  });

  it('цена упала до уровня below → триггер сработал', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers([block], {
      quotes: { PLZL: { last: 850 } },
    });

    expect(result?.triggered).toBe(true);
    expect(result?.level?.price).toBe(900);
    log.mockRestore();
  });

  it('цена между уровнями → level=null, triggered=false', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers([block], {
      quotes: { PLZL: 1000 },
    });

    expect(result?.triggered).toBe(false);
    expect(result?.level).toBeNull();
    expect(result?.asOf).toBeNull();
    log.mockRestore();
  });

  it('из нескольких достигнутых уровней выбирается ближайший к цене', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers(
      [
        {
          ticker: 'PLZL',
          levels: [
            { price: 900, direction: 'below' },
            { price: 1000, direction: 'below' },
          ],
          action: 'HOLD',
        },
      ],
      { quotes: { PLZL: 1000 } },
    );

    expect(result?.level?.price).toBe(1000);
    log.mockRestore();
  });

  it('без подтверждённой цены блок не попадает в результат', () => {
    const log = silentLog();
    const result = evaluatePriceTriggers([block], { quotes: {} });

    expect(result).toEqual([]);
    expect(logged(log)).toContain(
      '[PRICE_TRIGGER] ticker=PLZL price=unavailable level=- action=HOLD',
    );
    log.mockRestore();
  });

  it('нулевая цена считается недоступной', () => {
    const log = silentLog();
    const result = evaluatePriceTriggers([block], { quotes: { PLZL: 0 } });

    expect(result).toEqual([]);
    log.mockRestore();
  });
});

describe('evaluatePriceTriggers — no-sell политика', () => {
  const sellBlock: PriceTriggerBlock = {
    ticker: 'PLZL',
    levels: [{ price: 1100, direction: 'above' }],
    action: 'SELL',
  };

  it('SELL по no-sell тикеру → action=blocked_by_policy', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers([sellBlock], {
      quotes: { PLZL: 1120 },
      assets: [{ ticker: 'PLZL', assetType: 'А' }],
      policy: { noSellTickers: ['PLZL'] },
    });

    expect(result?.blockedByPolicy).toBe(true);
    expect(result?.action).toBe('blocked_by_policy');
    expect(result?.originalAction).toBe('SELL');
    expect(logged(log)).toContain('action=blocked_by_policy original=SELL');
    log.mockRestore();
  });

  it('SELL по разрешённому тикеру сохраняется', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers([{ ...sellBlock, ticker: 'SBER' }], {
      quotes: { SBER: 1120 },
      assets: [{ ticker: 'SBER', assetType: 'А' }],
      policy: { noSellTickers: ['PLZL'] },
    });

    expect(result?.blockedByPolicy).toBe(false);
    expect(result?.action).toBe('SELL');
    log.mockRestore();
  });

  it('HOLD по no-sell тикеру не блокируется', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers([{ ...sellBlock, action: 'HOLD' }], {
      quotes: { PLZL: 1120 },
      policy: { noSellTickers: ['PLZL'] },
    });

    expect(result?.blockedByPolicy).toBe(false);
    expect(result?.action).toBe('HOLD');
    log.mockRestore();
  });

  it('holdOnly актива блокирует sell-действие', () => {
    const log = silentLog();
    const [result] = evaluatePriceTriggers([sellBlock], {
      quotes: { PLZL: 1120 },
      assets: [{ ticker: 'PLZL', assetType: 'А', holdOnly: true }],
    });

    expect(result?.action).toBe('blocked_by_policy');
    log.mockRestore();
  });
});
