/**
 * QuikGateway Tests — фасад QUIK-канала: isAvailable, readNews, readOrders.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest' (см. требование окружения в python-engine.test.ts).
 *
 * Данные записываются во временную папку (os.tmpdir) и удаляются после.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuikGateway } from './quik-gateway.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

let tmpDir = '';
let gateway: QuikGateway;

/** Создать файл новостей вида news_ГГГГММДД.json */
async function writeNewsFile(records: unknown[]): Promise<void> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  await fs.writeFile(
    path.join(tmpDir, `news_${date}.json`),
    JSON.stringify(records),
    'utf-8',
  );
}

/** Создать файл заявок вида orders_ГГГГММДД.json */
async function writeOrdersFile(payload: unknown): Promise<void> {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  await fs.writeFile(
    path.join(tmpDir, `orders_${date}.json`),
    JSON.stringify(payload),
    'utf-8',
  );
}

// ──────────────────────────────────────────────
// Setup / Teardown
// ──────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quik-gateway-'));
  gateway = new QuikGateway({ newsDir: tmpDir, ordersDir: tmpDir });
});

afterAll(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────
// 1. isAvailable
// ──────────────────────────────────────────────

describe('QuikGateway.isAvailable', () => {
  it('false для пустой/отсутствующей папки', async () => {
    expect(await gateway.isAvailable()).toBe(false);
  });

  it('true при наличии файлов новостей', async () => {
    await writeNewsFile([
      { id: '1', time: '2026-09-26T10:00:00', text: 'Новость' },
    ]);
    expect(await gateway.isAvailable()).toBe(true);
  });

  it('true при наличии файлов заявок', async () => {
    await writeOrdersFile([
      { number: '1', ticker: 'SBER', operation: 'BUY', qty: 1, price: 100 },
    ]);
    expect(await gateway.isAvailable()).toBe(true);
  });

  it('false при посторонних файлах без news_/orders_', async () => {
    await fs.writeFile(path.join(tmpDir, 'random.txt'), 'x', 'utf-8');
    expect(await gateway.isAvailable()).toBe(false);
  });
});

// ──────────────────────────────────────────────
// 2. Чтение через фасад
// ──────────────────────────────────────────────

describe('QuikGateway.readNews / readOrders', () => {
  it('readNews возвращает записи новостей', async () => {
    await writeNewsFile([
      {
        id: '1',
        className: 'NEWS',
        time: '2026-09-26T10:00:00',
        text: 'Первая',
      },
      { id: '2', time: '2026-09-26T10:05:00', text: 'Вторая' },
    ]);

    const records = await gateway.readNews();
    expect(records).toHaveLength(2);
    expect(records[0]!.text).toBe('Первая');
    expect(records[0]!.className).toBe('NEWS');
  });

  it('readOrders возвращает заявки из последнего файла', async () => {
    await writeOrdersFile([
      {
        number: '1',
        ticker: 'SBER',
        operation: 'BUY',
        qty: 10,
        price: 250.5,
        status: 'АКТИВНА',
        account: '403GPBT',
      },
    ]);

    const orders = await gateway.readOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]!.ticker).toBe('SBER');
    expect(orders[0]!.operation).toBe('BUY');
    expect(orders[0]!.sum).toBe(2505);
  });

  it('readNews возвращает [] без файлов', async () => {
    expect(await gateway.readNews()).toEqual([]);
  });

  it('readOrders возвращает [] без файлов', async () => {
    expect(await gateway.readOrders()).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 3. Отдельные читатели через геттеры
// ──────────────────────────────────────────────

describe('QuikGateway читатели', () => {
  it('геттер news отдаёт QuikNewsReader с настроенной папкой', () => {
    expect(gateway.news.getDirectory()).toBe(tmpDir);
  });

  it('геттер orders отдаёт QuikOrdersReader с настроенной папкой', () => {
    expect(gateway.orders.getDirectory()).toBe(tmpDir);
  });

  it('дедупликация работает на уровне фасада', async () => {
    await writeNewsFile([
      { id: '1', time: '2026-09-26T10:00:00', text: 'Дубликат' },
      { id: '2', time: '2026-09-26T10:00:00', text: 'Дубликат' },
    ]);

    const records = await gateway.readNews();
    expect(records).toHaveLength(1);
  });
});
