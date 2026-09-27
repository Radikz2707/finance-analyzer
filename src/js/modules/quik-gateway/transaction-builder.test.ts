/**
 * Transaction Builder Tests — подготовка заявок QUIK с подтверждением.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest' (ограничение окружения: vitest 5.x + vite 8.x).
 *
 * Покрытие:
 * 1. buildOrderRequest: APPROVED → запрос формируется (B/S, qty, price)
 * 2. buildOrderRequest: PENDING / REJECTED → null (защита от случайной отправки)
 * 3. buildOrderRequest: HOLD → null; пустой qty → null
 * 4. saveOrderRequest пишет order_request.json (os.tmpdir) → readOrderResult
 * 5. readOrderResult при отсутствии файла → null
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InteractiveOrder } from '../pipeline/orders/interactive-orders.js';
import {
  buildOrderRequest,
  readOrderResult,
  saveOrderRequest,
} from './index.js';
import type { QuikTransactionRequest } from './index.js';

/** Создать интерактивный ордер с указанным статусом утверждения */
function makeOrder(
  approvalStatus: InteractiveOrder['approvalStatus'],
  overrides: Partial<InteractiveOrder> = {},
): InteractiveOrder {
  return {
    id: 'ord-1',
    ticker: 'SBER',
    assetName: 'Сбербанк',
    action: 'BUY',
    recommendedQuantity: 10,
    recommendedPrice: 250.5,
    totalAmount: 2505,
    approvalStatus,
    rationale: 'Дефицит позиции',
    createdAt: '2026-09-26T12:00:00.000Z',
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// 1. buildOrderRequest
// ──────────────────────────────────────────────

describe('buildOrderRequest', () => {
  it('APPROVED + userConfirmation APPROVED → запрос формируется (BUY→B)', () => {
    const request = buildOrderRequest(makeOrder('APPROVED'), 'APPROVED');

    expect(request).not.toBeNull();
    expect(request!.secCode).toBe('SBER');
    expect(request!.operation).toBe('B');
    expect(request!.qty).toBe(10);
    expect(request!.price).toBe(250.5);
    expect(request!.comment).toBe('Дефицит позиции');
  });

  it('APPROVED + userConfirmation APPROVED → SELL/REDUCE/EXIT маппятся в S', () => {
    for (const action of ['SELL', 'REDUCE', 'EXIT'] as const) {
      const request = buildOrderRequest(
        makeOrder('APPROVED', { action, recommendedPrice: 260 }),
        'APPROVED',
      );
      expect(request).not.toBeNull();
      expect(request!.operation).toBe('S');
    }
  });

  it('PENDING → null (заявка не формируется без подтверждения)', () => {
    const request = buildOrderRequest(makeOrder('PENDING'), 'APPROVED');
    expect(request).toBeNull();
  });

  it('REJECTED → null', () => {
    const request = buildOrderRequest(makeOrder('REJECTED'), 'APPROVED');
    expect(request).toBeNull();
  });

  it('HOLD (нет действия) → null', () => {
    const request = buildOrderRequest(
      makeOrder('APPROVED', { action: 'HOLD' }),
      'APPROVED',
    );
    expect(request).toBeNull();
  });

  it('нулевое/невалидное количество → null', () => {
    const request = buildOrderRequest(
      makeOrder('APPROVED', { recommendedQuantity: 0 }),
      'APPROVED',
    );
    expect(request).toBeNull();
  });
});

// ──────────────────────────────────────────────
// 2. saveOrderRequest / readOrderResult
// ──────────────────────────────────────────────

describe('saveOrderRequest / readOrderResult', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quik-tx-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('saveOrderRequest пишет файл, readOrderResult его читает', async () => {
    const request: QuikTransactionRequest = {
      secCode: 'GAZP',
      operation: 'S',
      qty: 5,
      price: 180.2,
      comment: 'Фиксация прибыли',
    };

    const saved = await saveOrderRequest(request, tmpDir);
    expect(saved).toBe(true);

    const filePath = path.join(tmpDir, 'order_request.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as QuikTransactionRequest;
    expect(parsed.secCode).toBe('GAZP');
    expect(parsed.operation).toBe('S');
    expect(parsed.qty).toBe(5);
    expect(parsed.price).toBe(180.2);

    // Эмулируем результат send_order.lua
    await fs.writeFile(
      path.join(tmpDir, 'order_result.json'),
      JSON.stringify({
        ok: true,
        orderNum: '777001',
        time: '2026-09-26 18:00:00',
      }),
      'utf-8',
    );

    const result = await readOrderResult(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(result!.orderNum).toBe('777001');
    expect(result!.time).toBe('2026-09-26 18:00:00');
  });

  it('readOrderResult при отсутствии файла → null', async () => {
    const result = await readOrderResult(tmpDir);
    expect(result).toBeNull();
  });

  it('readOrderResult при битом JSON → null', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'order_result.json'),
      '{broken',
      'utf-8',
    );
    const result = await readOrderResult(tmpDir);
    expect(result).toBeNull();
  });

  it('readOrderResult при ok=false возвращает ошибку', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'order_result.json'),
      JSON.stringify({ ok: false, error: 'QUIK отклонил заявку', time: 't' }),
      'utf-8',
    );

    const result = await readOrderResult(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.error).toContain('QUIK отклонил');
  });

  it('saveOrderRequest создаёт папку рекурсивно', async () => {
    const nestedDir = path.join(tmpDir, 'nested', 'quik');
    const saved = await saveOrderRequest(
      { secCode: 'LKOH', operation: 'B', qty: 1 },
      nestedDir,
    );
    expect(saved).toBe(true);
    expect(
      await fs
        .stat(path.join(nestedDir, 'order_request.json'))
        .then((s) => s.isFile()),
    ).toBe(true);
  });
});
