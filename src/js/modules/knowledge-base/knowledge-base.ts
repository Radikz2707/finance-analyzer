/**
 * KnowledgeBase - module for storing and managing knowledge.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type {
  KnowledgeEntry,
  KnowledgeQuery,
  KnowledgeQueryResult,
  KnowledgeBaseStats,
  KnowledgeBaseConfig,
  KnowledgeType,
  KnowledgeSource,
  KnowledgeConfidence,
  FactKnowledge,
  SkillKnowledge,
  PreferenceKnowledge,
  ContextKnowledge,
} from './knowledge-types.js';
import { generateId } from '../pipeline/ai-memory/database.js';

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  maxEntries: 5000,
  ttlDays: 90,
  weightHalfLifeDays: 60,
  autoExtractFromChat: false,
  autoExtractFromPipeline: false,
  verbose: false,
};

let config: KnowledgeBaseConfig = { ...DEFAULT_CONFIG };
let db: Database.Database | null = null;

export function configure(newConfig: Partial<KnowledgeBaseConfig>): void {
  config = { ...config, ...newConfig };
  if (config.verbose) console.log('[KnowledgeBase] Config updated:', config);
}

export function getConfig(): KnowledgeBaseConfig {
  return { ...config };
}

export function init(dbPath?: string): void {
  const dbDir = dbPath ? dirname(dbPath) : './data';
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  const finalDbPath = dbPath || join('./data', 'knowledge-base.db');
  db = new Database(finalDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(
    'CREATE TABLE IF NOT EXISTS knowledge_entries (' +
      'id TEXT PRIMARY KEY,' +
      "type TEXT NOT NULL CHECK(type IN ('fact','skill','preference','context'))," +
      'title TEXT NOT NULL, content TEXT NOT NULL,' +
      'keywords TEXT NOT NULL,' +
      "source TEXT NOT NULL CHECK(source IN ('chat','pipeline','manual','inference','import'))," +
      "confidence TEXT NOT NULL CHECK(confidence IN ('confirmed','probable','hypothesis'))," +
      'created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_accessed_at TEXT NOT NULL,' +
      'access_count INTEGER NOT NULL DEFAULT 0, weight REAL NOT NULL DEFAULT 1.0,' +
      'related_assets TEXT, related_sectors TEXT, metadata TEXT,' +
      'fact_type TEXT, verified INTEGER, source_url TEXT,' +
      'category TEXT, difficulty TEXT, steps TEXT, applicable_conditions TEXT,' +
      'value TEXT, is_changed INTEGER, previous_value TEXT,' +
      'context_type TEXT, portfolio_state TEXT, outcome TEXT, lesson TEXT)',
  );

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_entries(type)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_entries(source)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_confidence ON knowledge_entries(confidence)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_entries(created_at)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_weight ON knowledge_entries(weight)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_keywords ON knowledge_entries(keywords)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_assets ON knowledge_entries(related_assets)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_knowledge_sectors ON knowledge_entries(related_sectors)',
  );

  if (config.verbose) console.log('[KnowledgeBase] Initialized:', finalDbPath);
}

function getDb(): Database.Database | null {
  return db;
}

export function saveKnowledge(
  entry: Omit<
    KnowledgeEntry,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'lastAccessedAt'
    | 'accessCount'
    | 'weight'
  >,
): string {
  const database = getDb();
  if (!database)
    throw new Error('[KnowledgeBase] DB not initialized. Call init() first.');
  const id = generateId();
  const now = new Date().toISOString();
  const stmt = database.prepare(
    'INSERT INTO knowledge_entries (id,type,title,content,keywords,source,confidence,created_at,updated_at,last_accessed_at,access_count,weight,related_assets,related_sectors,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  stmt.run(
    id,
    entry.type,
    entry.title,
    entry.content,
    JSON.stringify(entry.keywords),
    entry.source,
    entry.confidence,
    now,
    now,
    now,
    0,
    1.0,
    JSON.stringify(entry.relatedAssets || []),
    JSON.stringify(entry.relatedSectors || []),
    entry.metadata ? JSON.stringify(entry.metadata) : null,
  );
  if (config.verbose)
    console.log('[KnowledgeBase] Saved:', entry.type, '-', entry.title);
  return id;
}

export function getKnowledgeById(id: string): KnowledgeEntry | undefined {
  const database = getDb();
  if (!database) return undefined;
  const row = database
    .prepare('SELECT * FROM knowledge_entries WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return parseKnowledgeRow(row);
}

export function getAllKnowledge(limit = 100, offset = 0): KnowledgeEntry[] {
  const database = getDb();
  if (!database) return [];
  const rows = database
    .prepare(
      'SELECT * FROM knowledge_entries ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .all(limit, offset) as Record<string, unknown>[];
  return rows.map(parseKnowledgeRow);
}

export function getKnowledgeByType(
  type: KnowledgeType,
  limit = 100,
): KnowledgeEntry[] {
  const database = getDb();
  if (!database) return [];
  const rows = database
    .prepare(
      'SELECT * FROM knowledge_entries WHERE type = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(type, limit) as Record<string, unknown>[];
  return rows.map(parseKnowledgeRow);
}

export function updateKnowledge(
  id: string,
  updates: Partial<Omit<KnowledgeEntry, 'id' | 'createdAt'>>,
): boolean {
  const database = getDb();
  if (!database) return false;
  if (!getKnowledgeById(id)) return false;
  const now = new Date().toISOString();
  database
    .prepare(
      'UPDATE knowledge_entries SET title=COALESCE(?,title), content=COALESCE(?,content), keywords=COALESCE(?,keywords), confidence=COALESCE(?,confidence), updated_at=?, related_assets=COALESCE(?,related_assets), related_sectors=COALESCE(?,related_sectors), metadata=COALESCE(?,metadata) WHERE id=?',
    )
    .run(
      updates.title || null,
      updates.content || null,
      updates.keywords ? JSON.stringify(updates.keywords) : null,
      updates.confidence || null,
      now,
      updates.relatedAssets ? JSON.stringify(updates.relatedAssets) : null,
      updates.relatedSectors ? JSON.stringify(updates.relatedSectors) : null,
      updates.metadata ? JSON.stringify(updates.metadata) : null,
      id,
    );
  if (config.verbose) console.log('[KnowledgeBase] Updated:', id);
  return true;
}

export function deleteKnowledge(id: string): boolean {
  const database = getDb();
  if (!database) return false;
  const result = database
    .prepare('DELETE FROM knowledge_entries WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

export function incrementAccess(id: string): void {
  const database = getDb();
  if (!database) return;
  database
    .prepare(
      'UPDATE knowledge_entries SET access_count=access_count+1, last_accessed_at=? WHERE id=?',
    )
    .run(new Date().toISOString(), id);
}

function parseJsonColumn<T>(value: unknown): T | undefined {
  if (!value || typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function parseKnowledgeRow(row: Record<string, unknown>): KnowledgeEntry {
  return {
    id: row.id as string,
    type: row.type as KnowledgeType,
    title: row.title as string,
    content: row.content as string,
    keywords: parseJsonColumn<string[]>(row.keywords) || [],
    source: row.source as KnowledgeSource,
    confidence: row.confidence as KnowledgeConfidence,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    lastAccessedAt: row.last_accessed_at as string,
    accessCount: (row.access_count as number) || 0,
    weight: (row.weight as number) || 1.0,
    relatedAssets: parseJsonColumn<string[]>(row.related_assets) || [],
    relatedSectors: parseJsonColumn<string[]>(row.related_sectors) || [],
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

export function searchKnowledge(query: KnowledgeQuery): KnowledgeQueryResult {
  const startTime = Date.now();
  const database = getDb();
  if (!database)
    return { entries: [], totalFound: 0, queryDurationMs: 0, usedKeywords: [] };
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.types && query.types.length > 0) {
    conditions.push('type IN (' + query.types.map(() => '?').join(',') + ')');
    params.push(...query.types);
  }
  const usedKeywords: string[] = [];
  if (query.keywords && query.keywords.length > 0) {
    conditions.push(
      '(' + query.keywords.map(() => 'keywords LIKE ?').join(' OR ') + ')',
    );
    query.keywords.forEach((kw) => {
      params.push('%' + kw + '%');
      usedKeywords.push(kw);
    });
  }
  if (query.assets && query.assets.length > 0) {
    query.assets.forEach((asset) => {
      conditions.push('related_assets LIKE ?');
      params.push('%"' + asset + '"%');
    });
  }
  if (query.sectors && query.sectors.length > 0) {
    query.sectors.forEach((sector) => {
      conditions.push('related_sectors LIKE ?');
      params.push('%"' + sector + '"%');
    });
  }
  if (query.sources && query.sources.length > 0) {
    conditions.push(
      'source IN (' + query.sources.map(() => '?').join(',') + ')',
    );
    params.push(...query.sources);
  }
  if (query.minConfidence) {
    const Q = "'";
    conditions.push(
      'CASE confidence WHEN ' +
        Q +
        'confirmed' +
        Q +
        ' THEN 3 WHEN ' +
        Q +
        'probable' +
        Q +
        ' THEN 2 WHEN ' +
        Q +
        'hypothesis' +
        Q +
        ' THEN 1 ELSE 0 END >= ?',
    );
    const levels: Record<KnowledgeConfidence, number> = {
      confirmed: 3,
      probable: 2,
      hypothesis: 1,
    };
    params.push(levels[query.minConfidence]);
  }
  if (query.from) {
    conditions.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    conditions.push('created_at <= ?');
    params.push(query.to);
  }

  const whereClause =
    conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const sortBy = query.sortBy || 'date';
  const orderBy =
    sortBy === 'relevance'
      ? 'weight DESC, access_count DESC'
      : sortBy === 'weight'
        ? 'weight DESC'
        : 'created_at DESC';
  const limit = (query.maxResults || 50) as number;
  const sql =
    'SELECT * FROM knowledge_entries ' +
    whereClause +
    ' ORDER BY ' +
    orderBy +
    ' LIMIT ?';
  params.push(limit);

  const rows = database.prepare(sql).all(...params) as Record<
    string,
    unknown
  >[];
  const entries = rows.map(parseKnowledgeRow);
  const totalResult = database
    .prepare('SELECT COUNT(*) as total FROM knowledge_entries ' + whereClause)
    .get(...params.slice(0, -1)) as { total: number };

  return {
    entries,
    totalFound: totalResult.total,
    queryDurationMs: Date.now() - startTime,
    usedKeywords,
  };
}

export function searchByKeyword(keyword: string, limit = 50): KnowledgeEntry[] {
  const database = getDb();
  if (!database) return [];
  const pattern = '%' + keyword + '%';
  const rows = database
    .prepare(
      'SELECT * FROM knowledge_entries WHERE keywords LIKE ? OR title LIKE ? OR content LIKE ? ORDER BY weight DESC, created_at DESC LIMIT ?',
    )
    .all(pattern, pattern, pattern, limit) as Record<string, unknown>[];
  return rows.map(parseKnowledgeRow);
}

export function searchByAsset(ticker: string, limit = 50): KnowledgeEntry[] {
  const database = getDb();
  if (!database) return [];
  const pattern = '%' + ticker + '%';
  const rows = database
    .prepare(
      'SELECT * FROM knowledge_entries WHERE related_assets LIKE ? ORDER BY weight DESC, created_at DESC LIMIT ?',
    )
    .all(pattern, limit) as Record<string, unknown>[];
  return rows.map(parseKnowledgeRow);
}

export function searchBySector(sector: string, limit = 50): KnowledgeEntry[] {
  const database = getDb();
  if (!database) return [];
  const pattern = '%' + sector + '%';
  const rows = database
    .prepare(
      'SELECT * FROM knowledge_entries WHERE related_sectors LIKE ? ORDER BY weight DESC, created_at DESC LIMIT ?',
    )
    .all(pattern, limit) as Record<string, unknown>[];
  return rows.map(parseKnowledgeRow);
}

export function saveFact(
  fact: Omit<
    FactKnowledge,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'lastAccessedAt'
    | 'accessCount'
    | 'weight'
    | 'type'
  >,
): string {
  const id = saveKnowledge({
    type: 'fact',
    title: fact.title,
    content: fact.content,
    keywords: fact.keywords,
    source: fact.source,
    confidence: fact.confidence,
    relatedAssets: fact.relatedAssets || [],
    relatedSectors: fact.relatedSectors || [],
    metadata: fact.metadata,
  });
  const database = getDb();
  if (database)
    database
      .prepare(
        'UPDATE knowledge_entries SET fact_type=?, verified=?, source_url=? WHERE id=?',
      )
      .run(fact.factType, fact.verified ? 1 : 0, fact.sourceUrl || null, id);
  return id;
}

export function saveSkill(
  skill: Omit<
    SkillKnowledge,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'lastAccessedAt'
    | 'accessCount'
    | 'weight'
    | 'type'
  >,
): string {
  const id = saveKnowledge({
    type: 'skill',
    title: skill.title,
    content: skill.content,
    keywords: skill.keywords,
    source: skill.source,
    confidence: skill.confidence,
    relatedAssets: skill.relatedAssets || [],
    relatedSectors: skill.relatedSectors || [],
    metadata: skill.metadata,
  });
  const database = getDb();
  if (database)
    database
      .prepare(
        'UPDATE knowledge_entries SET category=?, difficulty=?, steps=?, applicable_conditions=? WHERE id=?',
      )
      .run(
        skill.category,
        skill.difficulty,
        JSON.stringify(skill.steps),
        JSON.stringify(skill.applicableConditions || []),
        id,
      );
  return id;
}

export function savePreference(
  pref: Omit<
    PreferenceKnowledge,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'lastAccessedAt'
    | 'accessCount'
    | 'weight'
    | 'type'
  >,
): string {
  const id = saveKnowledge({
    type: 'preference',
    title: pref.title,
    content: pref.content,
    keywords: pref.keywords,
    source: pref.source,
    confidence: pref.confidence,
    relatedAssets: pref.relatedAssets || [],
    relatedSectors: pref.relatedSectors || [],
    metadata: pref.metadata,
  });
  const database = getDb();
  if (database) {
    const valueStr =
      typeof pref.value === 'number' ? pref.value.toString() : pref.value;
    const prevStr = pref.previousValue
      ? typeof pref.previousValue === 'number'
        ? pref.previousValue.toString()
        : pref.previousValue
      : null;
    database
      .prepare(
        'UPDATE knowledge_entries SET category=?, value=?, is_changed=?, previous_value=? WHERE id=?',
      )
      .run(pref.category, valueStr, pref.isChanged ? 1 : 0, prevStr, id);
  }
  return id;
}

export function saveContext(
  ctx: Omit<
    ContextKnowledge,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'lastAccessedAt'
    | 'accessCount'
    | 'weight'
    | 'type'
  >,
): string {
  const id = saveKnowledge({
    type: 'context',
    title: ctx.title,
    content: ctx.content,
    keywords: ctx.keywords,
    source: ctx.source,
    confidence: ctx.confidence,
    relatedAssets: ctx.relatedAssets || [],
    relatedSectors: ctx.relatedSectors || [],
    metadata: ctx.metadata,
  });
  const database = getDb();
  if (database)
    database
      .prepare(
        'UPDATE knowledge_entries SET context_type=?, portfolio_state=?, outcome=?, lesson=? WHERE id=?',
      )
      .run(
        ctx.contextType,
        JSON.stringify(ctx.portfolioState),
        ctx.outcome,
        ctx.lesson || null,
        id,
      );
  return id;
}

export function getStats(): KnowledgeBaseStats {
  const database = getDb();
  if (!database)
    return {
      totalEntries: 0,
      byType: { fact: 0, skill: 0, preference: 0, context: 0 },
      totalSizeBytes: 0,
      confirmedCount: 0,
      hypothesisCount: 0,
      averageWeight: 0,
      recentlyAccessed: 0,
    };
  const totalResult = database
    .prepare('SELECT COUNT(*) as total FROM knowledge_entries')
    .get() as { total: number };
  const byTypeResult = database
    .prepare(
      'SELECT type, COUNT(*) as count FROM knowledge_entries GROUP BY type',
    )
    .all() as Array<{ type: string; count: number }>;
  const byType = { fact: 0, skill: 0, preference: 0, context: 0 };
  byTypeResult.forEach((row) => {
    if (row.type in byType) byType[row.type as keyof typeof byType] = row.count;
  });
  const sizeResult = database
    .prepare(
      'SELECT COALESCE(SUM(LENGTH(content) + LENGTH(title) + LENGTH(keywords)), 0) as total_size FROM knowledge_entries',
    )
    .get() as { total_size: number };
  const confirmedResult = database
    .prepare(
      "SELECT COUNT(*) as count FROM knowledge_entries WHERE confidence = 'confirmed'",
    )
    .get() as { count: number };
  const hypothesisResult = database
    .prepare(
      "SELECT COUNT(*) as count FROM knowledge_entries WHERE confidence = 'hypothesis'",
    )
    .get() as { count: number };
  const avgWeightResult = database
    .prepare('SELECT AVG(weight) as avg_weight FROM knowledge_entries')
    .get() as { avg_weight: number | null };
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentlyAccessedResult = database
    .prepare(
      'SELECT COUNT(*) as count FROM knowledge_entries WHERE last_accessed_at >= ?',
    )
    .get(sevenDaysAgo.toISOString()) as { count: number };
  return {
    totalEntries: totalResult.total,
    byType,
    totalSizeBytes: sizeResult.total_size,
    confirmedCount: confirmedResult.count,
    hypothesisCount: hypothesisResult.count,
    averageWeight: avgWeightResult.avg_weight || 0,
    recentlyAccessed: recentlyAccessedResult.count,
  };
}

export function cleanupOld(daysThreshold?: number): number {
  const database = getDb();
  if (!database) return 0;
  const threshold = daysThreshold || config.ttlDays || DEFAULT_CONFIG.ttlDays;
  const result = database
    .prepare(
      "DELETE FROM knowledge_entries WHERE created_at < datetime('-?' days)",
    )
    .run(threshold);
  if (config.verbose)
    console.log(
      '[KnowledgeBase] Cleanup old:',
      result.changes,
      'records older than',
      threshold,
      'days',
    );
  return result.changes;
}

export function cleanupByLimit(): number {
  const database = getDb();
  if (!database) return 0;
  const limit = (config.maxEntries || DEFAULT_CONFIG.maxEntries) as number;
  const countResult = database
    .prepare('SELECT COUNT(*) as total FROM knowledge_entries')
    .get() as { total: number };
  if (countResult.total <= limit) return 0;
  const excess = countResult.total - limit;
  const result = database
    .prepare(
      'DELETE FROM knowledge_entries WHERE id IN (SELECT id FROM knowledge_entries ORDER BY weight ASC, created_at DESC LIMIT ?)',
    )
    .run(excess);
  if (config.verbose)
    console.log(
      '[KnowledgeBase] Cleanup limit:',
      result.changes,
      'records (limit:',
      limit + ')',
    );
  return result.changes;
}

export function cleanup(): number {
  return cleanupOld() + cleanupByLimit();
}

export function decayWeights(halfLifeDays?: number): number {
  const database = getDb();
  if (!database) return 0;
  const days = (halfLifeDays ||
    config.weightHalfLifeDays ||
    DEFAULT_CONFIG.weightHalfLifeDays) as number;
  const decayFactor = Math.pow(0.5, 1 / days);
  const rows = database
    .prepare('SELECT id, weight, created_at FROM knowledge_entries')
    .all() as Array<{ id: string; weight: number; created_at: string }>;
  let updated = 0;
  const updateStmt = database.prepare(
    'UPDATE knowledge_entries SET weight=? WHERE id=?',
  );
  const now = new Date();
  rows.forEach((row) => {
    const daysSinceCreation =
      (now.getTime() - new Date(row.created_at).getTime()) /
      (1000 * 60 * 60 * 24);
    const newWeight = row.weight * Math.pow(decayFactor, daysSinceCreation);
    if (Math.abs(newWeight - row.weight) > 0.001) {
      updateStmt.run(newWeight, row.id);
      updated++;
    }
  });
  if (config.verbose && updated > 0)
    console.log('[KnowledgeBase] Decayed weights:', updated, 'records');
  return updated;
}

export function exportToJson(): string {
  const database = getDb();
  if (!database) return '[]';
  const rows = database
    .prepare('SELECT * FROM knowledge_entries ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return JSON.stringify(rows.map(parseKnowledgeRow), null, 2);
}

export function exportToMarkdown(): string {
  const database = getDb();
  if (!database)
    return '# KnowledgeBase Export' + String.fromCharCode(10) + 'No data.';
  const entries = getAllKnowledge(1000);
  if (entries.length === 0)
    return '# KnowledgeBase Export' + String.fromCharCode(10) + 'No data.';
  let md = '# KnowledgeBase Export' + String.fromCharCode(10);
  md += 'Export date: ' + new Date().toISOString() + String.fromCharCode(10);
  md +=
    'Total records: ' +
    entries.length +
    String.fromCharCode(10) +
    String.fromCharCode(10);
  const byType: Record<KnowledgeType, KnowledgeEntry[]> = {
    fact: [],
    skill: [],
    preference: [],
    context: [],
  };
  entries.forEach((entry) => {
    byType[entry.type].push(entry);
  });
  const typeNames: Record<string, string> = {
    fact: 'Facts',
    skill: 'Skills',
    preference: 'Preferences',
    context: 'Context',
  };
  for (const [type, typeEntries] of Object.entries(byType)) {
    if (typeEntries.length === 0) continue;
    md +=
      '## ' +
      (typeNames[type] || type) +
      ' (' +
      typeEntries.length +
      ')' +
      String.fromCharCode(10) +
      String.fromCharCode(10);
    typeEntries.forEach((entry) => {
      md += '### ' + entry.title + String.fromCharCode(10);
      md += '- **Type:** ' + entry.type + String.fromCharCode(10);
      md += '- **Source:** ' + entry.source + String.fromCharCode(10);
      md += '- **Confidence:** ' + entry.confidence + String.fromCharCode(10);
      md +=
        '- **Weight:** ' + entry.weight.toFixed(2) + String.fromCharCode(10);
      md += '- **Date:** ' + entry.createdAt + String.fromCharCode(10);
      if (entry.keywords.length > 0)
        md +=
          '- **Keywords:** ' +
          entry.keywords.join(', ') +
          String.fromCharCode(10);
      md +=
        String.fromCharCode(10) +
        entry.content +
        String.fromCharCode(10) +
        String.fromCharCode(10) +
        '---' +
        String.fromCharCode(10) +
        String.fromCharCode(10);
    });
  }
  return md;
}

export function close(): void {
  if (db) {
    db.close();
    db = null;
    if (config.verbose) console.log('[KnowledgeBase] Connection closed');
  }
}

export function isInitialized(): boolean {
  return db !== null;
}

export function getUserPreferences(): PreferenceKnowledge[] {
  const database = getDb();
  if (!database) return [];
  const rows = database
    .prepare(
      "SELECT * FROM knowledge_entries WHERE type = 'preference' ORDER BY updated_at DESC",
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => {
    const entry = parseKnowledgeRow(row) as PreferenceKnowledge;
    entry.value = row.value
      ? isNaN(Number(row.value))
        ? String(row.value)
        : Number(row.value)
      : '';
    entry.isChanged = !!row.is_changed;
    entry.previousValue = row.previous_value
      ? isNaN(Number(row.previous_value))
        ? String(row.previous_value)
        : Number(row.previous_value)
      : undefined;
    return entry;
  });
}

export function getRecentFacts(limit = 50): FactKnowledge[] {
  const database = getDb();
  if (!database) return [];
  const rows = database
    .prepare(
      "SELECT * FROM knowledge_entries WHERE type = 'fact' ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => {
    const entry = parseKnowledgeRow(row) as FactKnowledge;
    entry.factType = (row.fact_type as FactKnowledge['factType']) || 'general';
    entry.verified = !!row.verified;
    entry.sourceUrl = row.source_url as string | undefined;
    return entry;
  });
}

export function getAllSkills(limit = 100): SkillKnowledge[] {
  const database = getDb();
  if (!database) return [];
  const rows = database
    .prepare(
      "SELECT * FROM knowledge_entries WHERE type = 'skill' ORDER BY weight DESC LIMIT ?",
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => {
    const entry = parseKnowledgeRow(row) as SkillKnowledge;
    entry.category = (row.category as SkillKnowledge['category']) || 'general';
    entry.difficulty =
      (row.difficulty as SkillKnowledge['difficulty']) || 'intermediate';
    entry.steps = parseJsonColumn<string[]>(row.steps) || [];
    entry.applicableConditions =
      parseJsonColumn<string[]>(row.applicable_conditions) || [];
    return entry;
  });
}

export function getAllContext(limit = 100): ContextKnowledge[] {
  const database = getDb();
  if (!database) return [];
  const rows = database
    .prepare(
      "SELECT * FROM knowledge_entries WHERE type = 'context' ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((row) => {
    const entry = parseKnowledgeRow(row) as ContextKnowledge;
    entry.contextType =
      (row.context_type as ContextKnowledge['contextType']) || 'decision';
    entry.outcome = (row.outcome as ContextKnowledge['outcome']) || 'neutral';
    entry.lesson = row.lesson as string | undefined;
    entry.portfolioState = parseJsonColumn<{
      totalValue: number;
      assetCount: number;
      cashPercent: number;
    }>(row.portfolio_state as string) || {
      totalValue: 0,
      assetCount: 0,
      cashPercent: 0,
    };
    return entry;
  });
}

export default {
  configure,
  getConfig,
  init,
  close,
  isInitialized,
  saveKnowledge,
  getKnowledgeById,
  getAllKnowledge,
  getKnowledgeByType,
  updateKnowledge,
  deleteKnowledge,
  incrementAccess,
  saveFact,
  saveSkill,
  savePreference,
  saveContext,
  searchKnowledge,
  searchByKeyword,
  searchByAsset,
  searchBySector,
  getStats,
  cleanup,
  cleanupOld,
  cleanupByLimit,
  decayWeights,
  getUserPreferences,
  getRecentFacts,
  getAllSkills,
  getAllContext,
  exportToJson,
  exportToMarkdown,
};
