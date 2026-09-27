/**
 * QuikNewsReader Tests — чтение/дедупликация/конвертация новостей QUIK.
 *
 * ВАЖНО: тест использует ГЛОБАЛЬНЫЕ API vitest (describe/it/expect),
 * а не импорт из 'vitest' (см. требование окружения в python-engine.test.ts).
 *
 * Данные записываются во временную папку (os.tmpdir) и удаляются после.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QuikNewsReader } from './quik-news-reader.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

let tmpDir = '';
let reader: QuikNewsReader;

function newsFilePath(date: string, ext = 'json'): string {
  return path.join(tmpDir, `news_${date}.${ext}`);
}

async function writeNewsFile(
  date: string,
  records: unknown[],
  ext = 'json',
): Promise<string> {
  const file = newsFilePath(date, ext);
  const content =
    ext === 'jsonl'
      ? records.map((r) => JSON.stringify(r)).join('\n')
      : JSON.stringify(records);
  await fs.writeFile(file, content, 'utf-8');
  return file;
}

// ──────────────────────────────────────────────
// Setup / Teardown
// ──────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quik-news-'));
  reader = new QuikNewsReader({ newsDir: tmpDir });
});

afterAll(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────
// 1. Чтение JSON-массива
// ──────────────────────────────────────────────

describe('QuikNewsReader.readNews', () => {
  it('читает записи из JSON-массива', async () => {
    await writeNewsFile('20260926', [
      {
        id: '1',
        className: 'NEWS',
        time: '2026-09-26T10:00:00',
        text: 'Первая новость',
      },
      {
        id: '2',
        className: 'LENTA',
        time: '2026-09-26T10:05:00',
        text: 'Вторая новость',
      },
    ]);

    const records = await reader.readNews();

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      id: '1',
      className: 'NEWS',
      time: '2026-09-26T10:00:00',
      text: 'Первая новость',
    });
  });

  it('пропускает невалидные записи (нет id/time/text)', async () => {
    await writeNewsFile('20260926', [
      { id: 'ok', time: '2026-09-26T10:00:00', text: 'Валидная' },
      { id: '', time: '2026-09-26T10:00:00', text: 'Нет id' },
      { id: '3', text: 'Нет времени' },
    ]);

    const records = await reader.readNews();
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toBe('ok');
  });

  it('принимает обёртку { records: [...] }', async () => {
    await fs.writeFile(
      newsFilePath('20260926'),
      JSON.stringify({
        records: [{ id: 'a', time: '2026-09-26T09:00:00', text: 'Обёртка' }],
      }),
      'utf-8',
    );

    const records = await reader.readNews();
    expect(records).toHaveLength(1);
    expect(records[0]!.text).toBe('Обёртка');
  });

  it('возвращает [] для битого JSON', async () => {
    await fs.writeFile(newsFilePath('20260926'), '{ broken', 'utf-8');
    const records = await reader.readNews();
    expect(records).toEqual([]);
  });

  it('нормализует время "ЧЧ:ММ:СС" до ISO с сегодняшней датой', async () => {
    await writeNewsFile('20260926', [
      { id: 't', time: '12:30:45', text: 'Только время' },
    ]);

    const records = await reader.readNews();
    const today = new Date().toISOString().slice(0, 10);
    expect(records[0]!.time).toBe(`${today}T12:30:45`);
  });
});

// ──────────────────────────────────────────────
// 2. JSON Lines (.jsonl)
// ──────────────────────────────────────────────

describe('QuikNewsReader JSONL', () => {
  it('читает файлы .jsonl (одна запись на строку)', async () => {
    await writeNewsFile(
      '20260926',
      [
        { id: '1', time: '2026-09-26T10:00:00', text: 'Строка 1' },
        { id: '2', time: '2026-09-26T10:01:00', text: 'Строка 2' },
      ],
      'jsonl',
    );

    const records = await reader.readNews();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.text)).toEqual(['Строка 1', 'Строка 2']);
  });

  it('пропускает битые строки в .jsonl', async () => {
    const file = newsFilePath('20260926', 'jsonl');
    await fs.writeFile(
      file,
      [
        JSON.stringify({ id: '1', time: '2026-09-26T10:00:00', text: 'Ок' }),
        '{ bad json',
        JSON.stringify({ id: '2', time: '2026-09-26T10:01:00', text: 'Ок 2' }),
      ].join('\n'),
      'utf-8',
    );

    const records = await reader.readNews();
    expect(records).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────
// 3. Дедупликация
// ──────────────────────────────────────────────

describe('QuikNewsReader дедупликация', () => {
  it('убирает дубликаты по тексту+времени между файлами', async () => {
    await writeNewsFile('20260925', [
      { id: '1', time: '2026-09-25T10:00:00', text: 'Повторяющаяся новость' },
    ]);
    await writeNewsFile('20260926', [
      { id: '2', time: '2026-09-26T10:00:00', text: 'Повторяющаяся новость' },
    ]);

    const records = await reader.readNews();
    // Время разное → не дубликат
    expect(records).toHaveLength(2);
  });

  it('убирает дубликаты с одинаковым временем и текстом', async () => {
    await writeNewsFile('20260926', [
      { id: '1', time: '2026-09-26T10:00:00', text: 'Дубль' },
      { id: '2', time: '2026-09-26T10:00:00', text: 'Дубль' },
    ]);

    const records = await reader.readNews();
    expect(records).toHaveLength(1);
  });

  it('дедупликация не зависит от регистра текста', async () => {
    await writeNewsFile('20260926', [
      { id: '1', time: '2026-09-26T10:00:00', text: 'SBER отчитался' },
      { id: '2', time: '2026-09-26T10:00:00', text: 'sber Отчитался' },
    ]);

    const records = await reader.readNews();
    expect(records).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// 4. getUnreadNews
// ──────────────────────────────────────────────

describe('QuikNewsReader.getUnreadNews', () => {
  it('возвращает только непрочитанные записи', async () => {
    await writeNewsFile('20260926', [
      { id: '1', time: '2026-09-26T10:00:00', text: 'Новость 1' },
      { id: '2', time: '2026-09-26T10:01:00', text: 'Новость 2' },
    ]);

    const first = await reader.getUnreadNews();
    expect(first).toHaveLength(2);

    const second = await reader.getUnreadNews();
    expect(second).toHaveLength(0);
  });

  it('после добавления новой записи возвращает только её', async () => {
    await writeNewsFile('20260926', [
      { id: '1', time: '2026-09-26T10:00:00', text: 'Старая' },
    ]);
    await reader.getUnreadNews();

    await writeNewsFile('20260927', [
      { id: '2', time: '2026-09-27T10:00:00', text: 'Новая' },
    ]);
    const unread = await reader.getUnreadNews();
    expect(unread).toHaveLength(1);
    expect(unread[0]!.id).toBe('2');
  });

  it('markAsRead добавляет id в прочитанные', async () => {
    await writeNewsFile('20260926', [
      { id: '1', time: '2026-09-26T10:00:00', text: 'Заранее прочитанная' },
    ]);
    reader.markAsRead(['1']);

    const unread = await reader.getUnreadNews();
    expect(unread).toHaveLength(0);
  });

  it('resetReadState очищает состояние прочитанных', async () => {
    await writeNewsFile('20260926', [
      { id: '1', time: '2026-09-26T10:00:00', text: 'Новость' },
    ]);
    await reader.getUnreadNews();
    reader.resetReadState();

    const unread = await reader.getUnreadNews();
    expect(unread).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// 5. Конвертация в RawNewsItem
// ──────────────────────────────────────────────

describe('QuikNewsReader.toRawNewsItems', () => {
  it('конвертирует записи в RawNewsItem для Gatekeeper', () => {
    const items = reader.toRawNewsItems([
      {
        id: '42',
        className: 'NEWS',
        time: '2026-09-26T10:00:00',
        text: 'Текст новости для проверки',
      },
    ]);

    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.title).toBe('Текст новости для проверки');
    expect(item.description).toBe('Текст новости для проверки');
    expect(item.url).toBe('');
    expect(item.date).toBe('2026-09-26T10:00:00');
    expect(item.metadata).toMatchObject({
      sourceName: 'quik',
      className: 'NEWS',
      quikNewsId: '42',
    });
  });

  it('обрезает длинный title до 200 символов', () => {
    const longText = 'а'.repeat(300);
    const items = reader.toRawNewsItems([
      { id: '1', time: '2026-09-26T10:00:00', text: longText },
    ]);

    expect(items[0]!.title.length).toBeLessThanOrEqual(201);
    expect(items[0]!.description).toBe(longText);
  });
});

// ──────────────────────────────────────────────
// 6. Доступность и фильтрация по датам
// ──────────────────────────────────────────────

describe('QuikNewsReader.isAvailable / daysBack', () => {
  it('isAvailable = false для пустой/отсутствующей папки', async () => {
    expect(await reader.isAvailable()).toBe(false);

    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quik-empty-'));
    try {
      const emptyReader = new QuikNewsReader({ newsDir: emptyDir });
      expect(await emptyReader.isAvailable()).toBe(false);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('isAvailable = true при наличии файла новостей', async () => {
    await writeNewsFile('20260926', [
      { id: '1', time: '2026-09-26T10:00:00', text: 'Новость' },
    ]);
    expect(await reader.isAvailable()).toBe(true);
  });

  it('readNews(daysBack) игнорирует старые файлы', async () => {
    await writeNewsFile('20200101', [
      { id: 'old', time: '2020-01-01T10:00:00', text: 'Старая новость' },
    ]);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await writeNewsFile(today, [
      {
        id: 'new',
        time: `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}T10:00:00`,
        text: 'Свежая новость',
      },
    ]);

    const all = await reader.readNews();
    expect(all).toHaveLength(2);

    const recent = await reader.readNews(1);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.id).toBe('new');
  });
});
