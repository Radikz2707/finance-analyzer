/**
 * TelegramHttpSender Tests — тесты реального отправителя через Bot API.
 */

import {
  TelegramHttpSender,
  TELEGRAM_API_URL,
  DEFAULT_TELEGRAM_TIMEOUT_MS,
} from './telegram-http-sender.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Мок fetch, который сохраняет URL и body, отвечая фиксированным payload */
function makeFetchMock(payload: unknown, httpStatus = 200) {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;

  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify(payload), { status: httpStatus });
  }) as typeof fetch;

  return { fetchImpl, getUrl: () => capturedUrl, getInit: () => capturedInit };
}

function clearEnv(): void {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_ADMIN_IDS;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('TelegramHttpSender', () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    // Восстанавливаем окружение
    process.env = { ...originalEnv };
  });

  it('isConfigured=false и sendMessage=false без токена/chatId', async () => {
    const sender = new TelegramHttpSender();
    expect(sender.isConfigured()).toBe(false);
    await expect(sender.sendMessage('привет')).resolves.toBe(false);
  });

  it('отправляет POST на /bot<token>/sendMessage с chat_id/text', async () => {
    const { fetchImpl, getUrl, getInit } = makeFetchMock({ ok: true });
    const sender = new TelegramHttpSender({
      token: 'SECRET_TOKEN_123',
      chatId: '424242',
      fetchImpl,
    });

    expect(sender.isConfigured()).toBe(true);
    const sent = await sender.sendMessage('Тестовое сообщение');

    expect(sent).toBe(true);
    expect(getUrl()).toBe(
      `${TELEGRAM_API_URL}/botSECRET_TOKEN_123/sendMessage`,
    );

    const body = JSON.parse(String(getInit()?.body ?? '{}'));
    expect(body).toMatchObject({
      chat_id: '424242',
      text: 'Тестовое сообщение',
      disable_notification: true,
    });
    expect(getInit()?.method).toBe('POST');
  });

  it('ок=false в ответе API → false', async () => {
    const { fetchImpl } = makeFetchMock({ ok: false });
    const sender = new TelegramHttpSender({
      token: 'T',
      chatId: '1',
      fetchImpl,
    });

    await expect(sender.sendMessage('x')).resolves.toBe(false);
  });

  it('HTTP статус не-ok → false', async () => {
    const { fetchImpl } = makeFetchMock({ ok: true }, 400);
    const sender = new TelegramHttpSender({
      token: 'T',
      chatId: '1',
      fetchImpl,
    });

    await expect(sender.sendMessage('x')).resolves.toBe(false);
  });

  it('сетевая ошибка fetch → false (без падения)', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    const sender = new TelegramHttpSender({
      token: 'T',
      chatId: '1',
      fetchImpl,
    });

    await expect(sender.sendMessage('x')).resolves.toBe(false);
  });

  it('fallback: TELEGRAM_ADMIN_IDS → первый ID как chatId', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'ENV_TOKEN';
    process.env.TELEGRAM_ADMIN_IDS = '111111, 222222';

    const { fetchImpl, getInit } = makeFetchMock({ ok: true });
    const sender = new TelegramHttpSender({ fetchImpl });

    expect(sender.isConfigured()).toBe(true);
    await sender.sendMessage('x');

    const body = JSON.parse(String(getInit()?.body ?? '{}'));
    expect(body.chat_id).toBe('111111');
  });

  it('использует таймаут по умолчанию 10 сек', () => {
    const sender = new TelegramHttpSender({ token: 'T', chatId: '1' });
    expect(DEFAULT_TELEGRAM_TIMEOUT_MS).toBe(10000);
    // Конфигурация принята без ошибок
    expect(sender.isConfigured()).toBe(true);
  });
});
