/**
 * QuikNewsReader — чтение новостей QUIK из файлов, экспортированных
 * скриптом quik/export_news.lua.
 *
 * Поддерживаемые форматы файлов (в папке newsDir):
 * - news_ГГГГММДД.json  — JSON-массив QuikNewsRecord[]
 * - news_ГГГГММДД.jsonl — JSON Lines (одна запись на строку)
 *
 * Функции:
 * - readNews(daysBack?) — чтение с дедупликацией по тексту+времени
 * - getUnreadNews()     — только непрочитанные записи (отслеживание в памяти)
 * - toRawNewsItems()    — конвертация в RawNewsItem для Gatekeeper
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logger/logger.js';
import type { RawNewsItem } from '../pipeline/gatekeeper/types.js';
import type { QuikNewsRecord, QuikNewsReaderConfig } from './types.js';

/** Логгер модуля */
const log = getLogger('quik-news-reader');

/** Папка по умолчанию: <корень проекта>/data/quik */
export function defaultQuikDir(): string {
  return path.resolve(process.cwd(), 'data', 'quik');
}

/**
 * Папка новостей: env QUIK_NEWS_DIR → переданный config → дефолт.
 * Пути QUIK берутся ТОЛЬКО из .env (без хардкода личных значений).
 */
export function resolveNewsDir(configNewsDir?: string): string {
  return configNewsDir || process.env.QUIK_NEWS_DIR || defaultQuikDir();
}

/** Формат имени файла новостей: news_ГГГГММДД.json / .jsonl */
const NEWS_FILE_PATTERN = /^news_\d{8}\.(json|jsonl)$/i;

/** Проверка ISO-времени "ГГГГ-ММ-ДДTЧЧ:ММ:СС..." */
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Время QUIK в формате "ЧЧ:ММ:СС" */
const TIME_ONLY_PATTERN = /^\d{2}:\d{2}:\d{2}$/;

/** Обрезать строку до maxLen символов (без разрыва посреди слова) */
function truncate(value: string, maxLen: number): string {
  const text = value.trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

/** Привести время записи к ISO-строке "ГГГГ-ММ-ДДTЧЧ:ММ:СС" */
function normalizeTime(value: string): string {
  const trimmed = value.trim();
  if (ISO_TIME_PATTERN.test(trimmed)) return trimmed;
  if (TIME_ONLY_PATTERN.test(trimmed)) {
    return `${new Date().toISOString().slice(0, 10)}T${trimmed}`;
  }
  return new Date().toISOString();
}

/**
 * Читатель новостей QUIK.
 */
export class QuikNewsReader {
  private readonly newsDir: string;
  /** Множество id уже прочитанных новостей (для getUnreadNews) */
  private readonly processedIds: Set<string> = new Set();

  constructor(config?: QuikNewsReaderConfig) {
    this.newsDir = resolveNewsDir(config?.newsDir);
  }

  /** Абсолютный путь к папке с новостями */
  getDirectory(): string {
    return this.newsDir;
  }

  /** Доступен ли источник: папка существует и содержит файлы новостей */
  async isAvailable(): Promise<boolean> {
    try {
      const stat = await fs.stat(this.newsDir);
      if (!stat.isDirectory()) return false;
      const files = await fs.readdir(this.newsDir);
      return files.some((f) => NEWS_FILE_PATTERN.test(f));
    } catch {
      return false;
    }
  }

  /**
   * Список файлов новостей.
   * @param daysBack — читать файлы за последние N дней (0 = все файлы)
   */
  async listNewsFiles(daysBack: number = 0): Promise<string[]> {
    let files: string[];
    try {
      files = await fs.readdir(this.newsDir);
    } catch {
      return [];
    }

    const newsFiles = files.filter((f) => NEWS_FILE_PATTERN.test(f)).sort();

    if (daysBack <= 0) {
      return newsFiles.map((f) => path.join(this.newsDir, f));
    }

    // Фильтрация по дате в имени файла news_ГГГГММДД
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = cutoff.toISOString().slice(0, 10).replace(/-/g, '');

    return newsFiles
      .filter((f) => {
        const match = f.match(/^news_(\d{8})\./);
        if (!match) return true;
        const datePart = match[1];
        return datePart !== undefined && datePart >= cutoffStr;
      })
      .map((f) => path.join(this.newsDir, f));
  }

  /**
   * Прочитать все новости за указанный период с дедупликацией
   * по паре «время + текст».
   */
  async readNews(daysBack: number = 0): Promise<QuikNewsRecord[]> {
    const files = await this.listNewsFiles(daysBack);
    const all: QuikNewsRecord[] = [];

    for (const file of files) {
      const records = await this.parseNewsFile(file);
      all.push(...records);
    }

    return this.deduplicate(all);
  }

  /**
   * Только непрочитанные новости (id не встречался ранее в этой сессии).
   * Прочитанные добавляются во внутренний Set.
   */
  async getUnreadNews(daysBack: number = 0): Promise<QuikNewsRecord[]> {
    const records = await this.readNews(daysBack);
    const unread = records.filter((r) => !this.processedIds.has(r.id));
    for (const record of unread) {
      this.processedIds.add(record.id);
    }
    return unread;
  }

  /** Пометить записи как прочитанные вручную */
  markAsRead(ids: string[]): void {
    for (const id of ids) {
      this.processedIds.add(id);
    }
  }

  /** Сбросить состояние «прочитано» */
  resetReadState(): void {
    this.processedIds.clear();
  }

  /** Преобразовать записи новостей в RawNewsItem для Gatekeeper */
  toRawNewsItems(records: QuikNewsRecord[]): RawNewsItem[] {
    return records.map((record) => ({
      title: truncate(record.text, 200),
      description: record.text,
      url: '',
      date: normalizeTime(record.time),
      metadata: {
        sourceName: 'quik',
        className: record.className ?? '',
        quikNewsId: record.id,
      },
    }));
  }

  /**
   * Разобрать один файл новостей (JSON-массив или JSON Lines).
   * Невалидные записи пропускаются.
   */
  private async parseNewsFile(filePath: string): Promise<QuikNewsRecord[]> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Не удалось прочитать ${filePath}: ${message}`);
      return [];
    }

    if (filePath.toLowerCase().endsWith('.jsonl')) {
      return this.parseJsonLines(raw, filePath);
    }
    return this.parseJsonArray(raw, filePath);
  }

  /** Разбор JSON-массива (возможна обёртка { records: [...] }) */
  private parseJsonArray(raw: string, filePath: string): QuikNewsRecord[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Битый JSON в ${filePath}: ${message}`);
      return [];
    }

    const items = Array.isArray(parsed)
      ? parsed
      : isRecordsWrapper(parsed)
        ? parsed.records
        : [];

    return items.map((item) => this.toRecord(item, filePath)).filter(isRecord);
  }

  /** Разбор JSON Lines: каждая непустая строка — отдельный объект */
  private parseJsonLines(raw: string, filePath: string): QuikNewsRecord[] {
    const result: QuikNewsRecord[] = [];
    const lines = raw.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const item = JSON.parse(trimmed) as unknown;
        const record = this.toRecord(item, filePath);
        if (isRecord(record)) {
          result.push(record);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn(`Битая строка в ${filePath}: ${message}`);
      }
    }
    return result;
  }

  /** Нормализация произвольного объекта в QuikNewsRecord */
  private toRecord(item: unknown, filePath: string): QuikNewsRecord | null {
    if (typeof item !== 'object' || item === null) return null;
    const obj = item as Record<string, unknown>;

    const id = typeof obj.id === 'string' ? obj.id.trim() : '';
    const time = typeof obj.time === 'string' ? obj.time.trim() : '';
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';

    if (!id || !time || !text) {
      log.warn(`Пропуск невалидной записи в ${filePath} (нет id/time/text)`);
      return null;
    }

    const record: QuikNewsRecord = {
      id,
      time: normalizeTime(time),
      text,
    };
    if (typeof obj.className === 'string' && obj.className.trim()) {
      record.className = obj.className.trim();
    }
    return record;
  }

  /** Дедупликация по ключу «время|текст» (в нижнем регистре) */
  private deduplicate(records: QuikNewsRecord[]): QuikNewsRecord[] {
    const seen = new Set<string>();
    const result: QuikNewsRecord[] = [];

    for (const record of records) {
      const key = `${record.time}|${record.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(record);
    }
    return result;
  }
}

/** Проверка обёртки { records: [...] } */
function isRecordsWrapper(value: unknown): value is { records: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { records?: unknown }).records)
  );
}

/** Type guard: валидная запись новости */
function isRecord(value: QuikNewsRecord | null): value is QuikNewsRecord {
  return value !== null;
}
