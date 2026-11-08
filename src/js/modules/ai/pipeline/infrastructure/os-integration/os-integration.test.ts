/**
 * Тесты OSIntegration (Задача 2.3): NotificationQueue, ClipboardManager,
 * LinkOpener, фасад OsIntegration. Платформенные провайдеры — моки.
 *
 * Глобальные describe/it/expect/vi предоставляются vitest (globals: true в
 * vitest.config.ts). Явный `import ... from 'vitest'` в этом проекте создаёт
 * второй экземпляр @vitest/runner и ломает контекст — поэтому глобалы.
 */

import {
  ClipboardManager,
  LinkOpener,
  NotificationQueue,
  OsIntegration,
} from './index.js';
import type {
  ClipboardProvider,
  ExternalOpener,
  NotificationProvider,
} from './types.js';
import { AccessPolicy } from '../security-layer/access-policy.js';

const now = () => new Date('2026-06-15T12:00:00.000Z');

// ─── NotificationQueue ────────────────────────────────────────────────────

describe('NotificationQueue', () => {
  const makeProvider = (
    supported = true,
    showResult = true,
  ): NotificationProvider & { shown: unknown[] } => {
    const provider = {
      shown: [] as unknown[],
      async show(notification: { title: string }) {
        provider.shown.push(notification);
        return showResult;
      },
      isSupported: () => supported,
    };
    return provider;
  };

  it('успешное уведомление: delivered=true, история пополняется', async () => {
    const provider = makeProvider();
    const queue = new NotificationQueue({ provider, now });
    const record = await queue.push({
      title: 'Сигнал',
      body: 'SBER выше цели',
    });
    expect(record.delivered).toBe(true);
    expect(record.id).toBe('ntf-1');
    expect(record.urgency).toBe('normal');
    expect(queue.getHistory()).toHaveLength(1);
  });

  it('платформа не поддерживает → delivered=false с честной причиной', async () => {
    const queue = new NotificationQueue({ provider: makeProvider(false), now });
    const record = await queue.push({ title: 'Тест' });
    expect(record.delivered).toBe(false);
    expect(record.error).toContain('не поддерживает');
  });

  it('платформа отказала в показе → delivered=false', async () => {
    const queue = new NotificationQueue({
      provider: makeProvider(true, false),
      now,
    });
    const record = await queue.push({ title: 'Тест' });
    expect(record.delivered).toBe(false);
    expect(record.error).toContain('отказала');
  });

  it('падение платформенного show → честная ошибка в записи, не throw', async () => {
    const provider: NotificationProvider = {
      async show() {
        throw new Error('dbus failure');
      },
      isSupported: () => true,
    };
    const queue = new NotificationQueue({ provider, now });
    const record = await queue.push({ title: 'Тест' });
    expect(record.delivered).toBe(false);
    expect(record.error).toContain('dbus failure');
    expect(queue.getPending()).toHaveLength(1);
  });

  it('пустой title → честная ошибка; history ограничена', async () => {
    const queue = new NotificationQueue({
      provider: makeProvider(),
      now,
      maxHistory: 2,
    });
    await expect(queue.push({ title: '  ' })).rejects.toThrow('title');
    await queue.push({ title: 'a' });
    await queue.push({ title: 'b' });
    await queue.push({ title: 'c' });
    expect(queue.getHistory().map((record) => record.title)).toEqual([
      'b',
      'c',
    ]);
  });
});

// ─── ClipboardManager ─────────────────────────────────────────────────────

describe('ClipboardManager', () => {
  const makeProvider = (): ClipboardProvider & { text: string } => {
    const provider = {
      text: '',
      async writeText(text: string) {
        provider.text = text;
      },
      async readText() {
        return provider.text;
      },
    };
    return provider;
  };

  it('copy: очищает управляющие символы и пишет в буфер', async () => {
    const provider = makeProvider();
    const manager = new ClipboardManager({ provider, now });
    const record = await manager.copy('секрет\u0000 с\u0007 переносом\n');
    expect(provider.text).toBe('секрет с переносом\n');
    expect(record.length).toBe(provider.text.length);
    expect(record.id).toBe('clip-1');
  });

  it('copy: нестроковый вход и превышение лимита → честные ошибки', async () => {
    const manager = new ClipboardManager({
      provider: makeProvider(),
      now,
      maxLength: 10,
    });
    await expect(manager.copy(42 as never)).rejects.toThrow('строкой');
    await expect(manager.copy('0123456789A')).rejects.toThrow(
      'превышает лимит',
    );
  });

  it('read возвращает текст из буфера; история хранит только превью', async () => {
    const provider = makeProvider();
    const manager = new ClipboardManager({ provider, now });
    await manager.copy('x'.repeat(60));
    expect(await manager.read()).toBe('x'.repeat(60));
    expect(manager.getHistory()[0]!.preview.endsWith('…')).toBe(true);
    expect(manager.getHistory()[0]!.preview.length).toBeLessThanOrEqual(51);
  });
});

// ─── LinkOpener ───────────────────────────────────────────────────────────

describe('LinkOpener', () => {
  const makeOpener = (): ExternalOpener & { opened: string[] } => {
    const opener = {
      opened: [] as string[],
      async open(url: string) {
        opener.opened.push(url);
      },
    };
    return opener;
  };
  const policy = new AccessPolicy({ allowedDomains: ['moex.com'] });

  it('ссылка в whitelist открывается', async () => {
    const opener = makeOpener();
    const linkOpener = new LinkOpener({ opener, policy });
    const result = await linkOpener.open('https://moex.com/iss.json');
    expect(result.opened).toBe(true);
    expect(opener.opened).toHaveLength(1);
    expect(linkOpener.openedCount).toBe(1);
  });

  it('посторонний домен и ftp отклоняются без вызова платформы', async () => {
    const opener = makeOpener();
    const linkOpener = new LinkOpener({ opener, policy });
    const bad1 = await linkOpener.open('https://evil.com/x');
    const bad2 = await linkOpener.open('ftp://moex.com/x');
    expect(bad1.opened).toBe(false);
    expect(bad2.opened).toBe(false);
    expect(opener.opened).toHaveLength(0);
  });

  it('падение платформы → честная ошибка с причиной', async () => {
    const opener: ExternalOpener = {
      async open() {
        throw new Error('no default browser');
      },
    };
    const linkOpener = new LinkOpener({ opener, policy });
    await expect(linkOpener.open('https://moex.com')).rejects.toThrow(
      'no default browser',
    );
  });

  it('конструктор без opener → честная ошибка', () => {
    expect(() => new LinkOpener({ opener: null as never })).toThrow();
  });
});

// ─── OsIntegration (фасад) ────────────────────────────────────────────────

describe('OsIntegration', () => {
  const makeFacade = () => {
    const provider: NotificationProvider & { shown: number } = {
      shown: 0,
      async show() {
        provider.shown += 1;
        return true;
      },
      isSupported: () => true,
    };
    const clipboard: ClipboardProvider & { text: string } = {
      text: '',
      async writeText(text: string) {
        clipboard.text = text;
      },
      async readText() {
        return clipboard.text;
      },
    };
    const opener: ExternalOpener & { opened: string[] } = {
      opened: [],
      async open(url: string) {
        opener.opened.push(url);
      },
    };
    const integration = new OsIntegration({
      notifications: provider,
      clipboard,
      opener,
      policy: new AccessPolicy({ allowedDomains: ['moex.com'] }),
      now,
    });
    return { integration, provider, clipboard, opener };
  };

  it('execute: dispatch по всем action', async () => {
    const { integration } = makeFacade();
    const notify = await integration.execute({
      action: 'notify',
      notification: { title: 'Сигнал', body: 'тест' },
    });
    expect(notify.success).toBe(true);

    const copy = await integration.execute({
      action: 'clipboard-copy',
      text: 'данные',
    });
    expect(copy.success).toBe(true);

    const read = await integration.execute({ action: 'clipboard-read' });
    expect(read.data as string).toBe('данные');

    const open = await integration.execute({
      action: 'open-link',
      url: 'https://moex.com/x',
    });
    expect(open.success).toBe(true);

    const status = await integration.execute({ action: 'status' });
    expect(status.success).toBe(true);
  });

  it('notify: недоставка → success=false с честной ошибкой', async () => {
    const integration = new OsIntegration({
      notifications: {
        async show() {
          return false;
        },
        isSupported: () => true,
      },
      now,
    });
    const result = await integration.execute({
      action: 'notify',
      notification: { title: 'x' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('отказала');
  });

  it('open-link: запрещённый домен → success=false, платформа не дёргается', async () => {
    const { integration, opener } = makeFacade();
    const result = await integration.execute({
      action: 'open-link',
      url: 'https://evil.com',
    });
    expect(result.success).toBe(false);
    expect(opener.opened).toHaveLength(0);
  });

  it('status: честный счётчик операций', async () => {
    const { integration } = makeFacade();
    await integration.execute({
      action: 'notify',
      notification: { title: 'a' },
    });
    await integration.execute({ action: 'clipboard-copy', text: 'b' });
    await integration.execute({ action: 'open-link', url: 'https://moex.com' });
    const result = await integration.execute({ action: 'status' });
    const status = result.data as {
      notificationsSent: number;
      clipboardOperations: number;
      linksOpened: number;
    };
    expect(status.notificationsSent).toBe(1);
    expect(status.clipboardOperations).toBe(1);
    expect(status.linksOpened).toBe(1);
  });

  it('не настроенные компоненты → честные ошибки execute', async () => {
    const empty = new OsIntegration({});
    const notify = await empty.execute({
      action: 'notify',
      notification: { title: 'x' },
    });
    expect(notify.success).toBe(false);
    expect(notify.error).toContain('не настроены');

    const copy = await empty.execute({ action: 'clipboard-copy', text: 'x' });
    expect(copy.success).toBe(false);

    const open = await empty.execute({
      action: 'open-link',
      url: 'https://a.com',
    });
    expect(open.success).toBe(false);
  });

  it('неизвестный action → success=false', async () => {
    const { integration } = makeFacade();
    const result = await integration.execute({ action: 'hack' as never });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Неизвестный');
  });
});
