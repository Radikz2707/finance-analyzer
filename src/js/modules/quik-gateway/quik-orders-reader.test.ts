/**
 * QuikOrdersReader Tests — парсинг JSON-файлов заявок QUIK → QuikOrder.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest' (см. требование окружения в python-engine.test.ts).
 *
 * Данные записываются во временную папку (os.tmpdir) и удаляются после.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuikOrdersReader } from './quik-orders-reader.js';
import type { QuikOrder } from '../xlsx-parser/quik-orders-parser.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

let tmpDir = '';
let reader: QuikOrdersReader;

function ordersFilePath(date: string): string {
  return path.join(tmpDir, `orders_${date}.json`);
}

async function writeOrdersFile(
  date: string,
  payload: unknown,
): Promise<string> {
  const file = ordersFilePath(date);
  await fs.writeFile(file, JSON.stringify(payload), 'utf-8');
  return file;
}

// ──────────────────────────────────────────────
// Setup / Teardown
// ──────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quik-orders-'));
  reader = new QuikOrdersReader({ ordersDir: tmpDir });
});

afterAll(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────
// 1. Парсинг JSON → QuikOrder
// ──────────────────────────────────────────────

describe('QuikOrdersReader.readOrders', () => {
  it('конвертирует массив JSON в QuikOrder', async () => {
    await writeOrdersFile('20260926', [
      {
        number: '123456',
        ticker: 'SBER',
        operation: 'BUY',
        qty: 10,
        price: 250.5,
        pricePercent: 250.5,
        isBond: false,
        sum: 2505,
        status: 'АКТИВНА',
        account: '403GPBT',
        statusCode: 0,
      },
    ]);

    const orders = await reader.readOrders();
    expect(orders).toHaveLength(1);

    const order = orders[0]!;
    expect(order.number).toBe('123456');
    expect(order.ticker).toBe('SBER');
    expect(order.operation).toBe('BUY');
    expect(order.qty).toBe(10);
    expect(order.price).toBe(250.5);
    expect(order.pricePercent).toBe(250.5);
    expect(order.isBond).toBe(false);
    expect(order.sum).toBe(2505);
    expect(order.status).toBe('АКТИВНА');
    expect(order.account).toBe('403GPBT');
  });

  it('парсит облигации: isBond = true, statusCode 1 → ИСПОЛНЕНА', async () => {
    await writeOrdersFile('20260926', [
      {
        number: '1',
        ticker: 'ОФЗ-26244',
        operation: 'SELL',
        qty: 5,
        price: 98.5,
        pricePercent: 98.5,
        isBond: true,
        sum: 492.5,
        status: 'ИСПОЛНЕНА',
        account: 'S04J3LB',
        statusCode: 1,
      },
    ]);

    const orders = await reader.readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.isBond).toBe(true);
    expect(orders[0]!.operation).toBe('SELL');
    expect(orders[0]!.status).toBe('ИСПОЛНЕНА');
  });

  it('принимает обёртку QuikOrdersFile { exportedAt, orders }', async () => {
    await writeOrdersFile('20260926', {
      exportedAt: '2026-09-26T10:00:00',
      orders: [
        {
          number: '77',
          ticker: 'GAZP',
          operation: 'BUY',
          qty: 3,
          price: 120,
          status: 'АКТИВНА',
          account: '403GPBT',
        },
      ],
    });

    const orders = await reader.readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.ticker).toBe('GAZP');
  });

  it('возвращает [] для битого JSON', async () => {
    await fs.writeFile(ordersFilePath('20260926'), '{ oops', 'utf-8');
    const orders = await reader.readOrders();
    expect(orders).toEqual([]);
  });

  it('возвращает [] при отсутствии файлов', async () => {
    const orders = await reader.readOrders();
    expect(orders).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 2. Выбор последнего файла
// ──────────────────────────────────────────────

describe('QuikOrdersReader выбор файла', () => {
  it('readOrders читает самый свежий файл', async () => {
    await writeOrdersFile('20260925', [
      {
        number: '1',
        ticker: 'OLD',
        operation: 'BUY',
        qty: 1,
        price: 100,
        status: 'АКТИВНА',
        account: 'A1',
      },
    ]);
    await writeOrdersFile('20260926', [
      {
        number: '2',
        ticker: 'NEW',
        operation: 'BUY',
        qty: 2,
        price: 200,
        status: 'АКТИВНА',
        account: 'A2',
      },
    ]);

    const orders = await reader.readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.ticker).toBe('NEW');
    expect(orders[0]!.number).toBe('2');
  });

  it('findLatestOrdersFile возвращает путь к свежему файлу', async () => {
    await writeOrdersFile('20260926', []);
    const latest = await reader.findLatestOrdersFile();
    expect(latest).toBe(ordersFilePath('20260926'));
  });

  it('findLatestOrdersFile возвращает null без файлов', async () => {
    const latest = await reader.findLatestOrdersFile();
    expect(latest).toBeNull();
  });
});

// ──────────────────────────────────────────────
// 3. Валидация и нормализация полей
// ──────────────────────────────────────────────

describe('QuikOrdersReader валидация', () => {
  it('пропускает записи с нулевыми qty или price', async () => {
    await writeOrdersFile('20260926', [
      {
        number: '1',
        ticker: 'GOOD',
        operation: 'BUY',
        qty: 5,
        price: 100,
        status: 'АКТИВНА',
        account: 'A1',
      },
      {
        number: '2',
        ticker: 'BAD_QTY',
        operation: 'BUY',
        qty: 0,
        price: 100,
        status: 'АКТИВНА',
        account: 'A1',
      },
      {
        number: '3',
        ticker: 'BAD_PRICE',
        operation: 'BUY',
        qty: 5,
        price: 0,
        status: 'АКТИВНА',
        account: 'A1',
      },
    ]);

    const orders = await reader.readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.ticker).toBe('GOOD');
  });

  it('пропускает записи без номера или тикера', async () => {
    await writeOrdersFile('20260926', [
      {
        number: '',
        ticker: 'NO_NUM',
        operation: 'BUY',
        qty: 1,
        price: 100,
        status: 'АКТИВНА',
        account: 'A',
      },
      {
        number: '4',
        ticker: '',
        operation: 'BUY',
        qty: 1,
        price: 100,
        status: 'АКТИВНА',
        account: 'A',
      },
    ]);

    const orders = await reader.readOrders();
    expect(orders).toEqual([]);
  });

  it('нормализует статус по statusCode, если status отсутствует', async () => {
    await writeOrdersFile('20260926', [
      {
        number: '1',
        ticker: 'ACTIVE',
        operation: 'BUY',
        qty: 1,
        price: 100,
        statusCode: 0,
      },
      {
        number: '2',
        ticker: 'DONE',
        operation: 'BUY',
        qty: 1,
        price: 100,
        statusCode: 1,
      },
      {
        number: '3',
        ticker: 'CANCELED',
        operation: 'BUY',
        qty: 1,
        price: 100,
        statusCode: 2,
      },
    ]);

    const orders = await reader.readOrders();
    expect(orders).toHaveLength(3);
    expect(orders.find((o: QuikOrder) => o.ticker === 'ACTIVE')?.status).toBe(
      'АКТИВНА',
    );
    expect(orders.find((o: QuikOrder) => o.ticker === 'DONE')?.status).toBe(
      'ИСПОЛНЕНА',
    );
    expect(orders.find((o: QuikOrder) => o.ticker === 'CANCELED')?.status).toBe(
      'СНЯТА',
    );
  });

  it('вычисляет sum = qty × price при отсутствии поля sum', async () => {
    await writeOrdersFile('20260926', [
      { number: '1', ticker: 'SBER', operation: 'BUY', qty: 10, price: 100.5 },
    ]);

    const orders = await reader.readOrders();
    expect(orders[0]!.sum).toBe(1005);
  });

  it('подставляет account = НЕИЗВЕСТЕН при отсутствии', async () => {
    await writeOrdersFile('20260926', [
      { number: '1', ticker: 'SBER', operation: 'BUY', qty: 1, price: 100 },
    ]);

    const orders = await reader.readOrders();
    expect(orders[0]!.account).toBe('НЕИЗВЕСТЕН');
  });

  it('распознаёт русские статусы в любом регистре', async () => {
    await writeOrdersFile('20260926', [
      {
        number: '1',
        ticker: 'A1',
        operation: 'BUY',
        qty: 1,
        price: 100,
        status: 'активна',
      },
      {
        number: '2',
        ticker: 'A2',
        operation: 'BUY',
        qty: 1,
        price: 100,
        status: 'ИСПОЛНЕНА',
      },
      {
        number: '3',
        ticker: 'A3',
        operation: 'BUY',
        qty: 1,
        price: 100,
        status: 'GTC (ПЕРЕНОС)',
      },
    ]);

    const orders = await reader.readOrders();
    expect(orders.find((o: QuikOrder) => o.ticker === 'A1')?.status).toBe(
      'АКТИВНА',
    );
    expect(orders.find((o: QuikOrder) => o.ticker === 'A2')?.status).toBe(
      'ИСПОЛНЕНА',
    );
    expect(orders.find((o: QuikOrder) => o.ticker === 'A3')?.status).toBe(
      'GTC (ПЕРЕНОС)',
    );
  });
});

// ──────────────────────────────────────────────
// 4. Доступность
// ──────────────────────────────────────────────

describe('QuikOrdersReader.isAvailable', () => {
  it('false для пустой/отсутствующей папки', async () => {
    expect(await reader.isAvailable()).toBe(false);
  });

  it('true при наличии orders_*.json', async () => {
    await writeOrdersFile('20260926', []);
    expect(await reader.isAvailable()).toBe(true);
  });

  it('игнорирует посторонние файлы в папке', async () => {
    await fs.writeFile(path.join(tmpDir, 'news_20260926.json'), '[]', 'utf-8');
    expect(await reader.isAvailable()).toBe(false);
  });
});
