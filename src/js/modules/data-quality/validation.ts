/**
 * DataQuality — валидация и мониторинг качества данных.
 *
 * Функции:
 * - Проверка полноты данных (missing values)
 * - Проверка свежести (freshness)
 * - Обнаружение аномалий (аномальные цены, объёмы)
 * - Отчёт о качестве данных
 */

import type { AssetResearchSnapshot, ResearchValue } from '../research/types.js';

// ──────────────────────────────────────────────
// 1. DataQuality types
// ──────────────────────────────────────────────

/** Результат валидации одного поля */
export interface FieldValidation {
  /** Имя поля */
  fieldName: string;
  /** Валидно ли */
  valid: boolean;
  /** Ошибка (если не валидно) */
  error?: string;
  /** Значение */
  value?: unknown;
}

/** Результат валидации одного актива */
export interface AssetQualityReport {
  /** Тикер актива */
  ticker: string;
  /** Общая оценка (0-100%) */
  qualityScore: number;
  /** Проверенные поля */
  fields: FieldValidation[];
  /** Ошибки */
  errors: string[];
  /** Предупреждения */
  warnings: string[];
}

/** Итоговый отчёт о качестве данных */
export interface DataQualityReport {
  /** Дата отчёта */
  reportDate: string;
  /** Всего активов проверено */
  totalAssets: number;
  /** Средний quality score */
  averageQualityScore: number;
  /** Отчёты по каждому активу */
  assetReports: AssetQualityReport[];
  /** Общие предупреждения */
  globalWarnings: string[];
  /** Сводка */
  summary: string;
}

// ──────────────────────────────────────────────
// 2. DataQuality Validator
// ──────────────────────────────────────────────

/**
 * DataQualityValidator — проверка качества research-данных.
 */
export class DataQualityValidator {
  private maxAgeHours: number;

  constructor(options?: {
    maxAgeHours?: number;
  }) {
    this.maxAgeHours = options?.maxAgeHours ?? 24;
  }

  /**
   * Проверить качество данных для одного актива.
   */
  validateAsset(
    ticker: string,
    snapshot: AssetResearchSnapshot | null,
    lastFetchedAt: string | null,
  ): AssetQualityReport {
    const fields: FieldValidation[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!snapshot) {
      return {
        ticker,
        qualityScore: 0,
        fields: [],
        errors: ['Нет данных для актива'],
        warnings: [],
      };
    }

    // 1. Проверка freshness
    if (lastFetchedAt) {
      const ageMs = Date.now() - new Date(lastFetchedAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      const freshnessValid = ageHours <= this.maxAgeHours;

      fields.push({
        fieldName: 'freshness',
        valid: freshnessValid,
        value: `${ageHours.toFixed(1)} ч`,
        error: freshnessValid ? undefined : `Данные устарели (${ageHours.toFixed(1)} ч > ${this.maxAgeHours} ч)`,
      });

      if (!freshnessValid) {
        errors.push(`Данные устарели: ${ageHours.toFixed(1)} ч`);
      }
    }

    // 2. Проверка marketResearch
    if (snapshot.marketResearch) {
      const priceValidation = this.validateResearchValue(
        snapshot.marketResearch.currentPrice,
        'currentPrice',
      );
      fields.push(priceValidation);
      if (!priceValidation.valid) {
        errors.push(priceValidation.error!);
      }

      const volumeValidation = this.validateResearchValue(
        snapshot.marketResearch.volume,
        'volume',
      );
      fields.push(volumeValidation);
    } else {
      fields.push({
        fieldName: 'marketResearch',
        valid: false,
        error: 'marketResearch отсутствует',
      });
      errors.push('marketResearch отсутствует');
    }

    // 3. Проверка issuerResearch (для акций)
    if (snapshot.issuerResearch) {
      const revenueValidation = this.validateResearchValue(
        snapshot.issuerResearch.financials?.revenue,
        'revenue',
      );
      fields.push(revenueValidation);

      // valuation — не ResearchValue, пропускаем
    }

    // 4. Проверка evidence
    const evidenceCount = Object.keys(snapshot.evidence || {}).length;
    fields.push({
      fieldName: 'evidenceCount',
      valid: evidenceCount > 0,
      value: evidenceCount,
      error: evidenceCount === 0 ? 'Нет evidence' : undefined,
    });

    if (evidenceCount === 0) {
      warnings.push('Нет evidence для актива');
    }

    // 5. Проверка аномалий цен
    if (snapshot.marketResearch?.currentPrice) {
      const price = snapshot.marketResearch.currentPrice;
      if (price.status === 'VALUE' && typeof price.value === 'number') {
        if (price.value <= 0) {
          fields.push({
            fieldName: 'price',
            valid: false,
            value: price.value,
            error: 'Цена <= 0',
          });
          errors.push('Аномальная цена: <= 0');
        }
      }
    }

    // Вычисляем quality score
    const totalFields = fields.length;
    const validFields = fields.filter((f) => f.valid).length;
    const qualityScore = totalFields > 0
      ? Math.round((validFields / totalFields) * 100)
      : 0;

    return {
      ticker,
      qualityScore,
      fields,
      errors,
      warnings,
    };
  }

  /**
   * Проверить ResearchValue.
   */
  private validateResearchValue<T>(
    value: ResearchValue<T> | undefined,
    fieldName: string,
  ): FieldValidation {
    if (!value) {
      return {
        fieldName,
        valid: false,
        error: `${fieldName} отсутствует`,
      };
    }

    if (value.status === 'NO_DATA' || value.status === 'NOT_APPLICABLE') {
      return {
        fieldName,
        valid: true,
        value: value.status,
      };
    }

    if (value.status === 'VALUE') {
      return {
        fieldName,
        valid: true,
        value: value.value,
      };
    }

    return {
      fieldName,
      valid: false,
      error: `Неизвестный статус: ${value.status}`,
    };
  }

  /**
   * Проверить качество данных для множества активов.
   */
  validateMultiple(
    assets: Array<{ ticker: string; snapshot: AssetResearchSnapshot | null; lastFetchedAt: string | null }>,
  ): DataQualityReport {
    const assetReports: AssetQualityReport[] = [];
    const globalWarnings: string[] = [];

    let totalScore = 0;

    for (const asset of assets) {
      const report = this.validateAsset(asset.ticker, asset.snapshot, asset.lastFetchedAt);
      assetReports.push(report);
      totalScore += report.qualityScore;

      if (report.errors.length > 0) {
        globalWarnings.push(`❌ ${asset.ticker}: ${report.errors.join(', ')}`);
      }
    }

    const averageQualityScore = assetReports.length > 0
      ? Math.round(totalScore / assetReports.length)
      : 0;

    // Формируем сводку
    const summary = this.formatSummary(
      averageQualityScore,
      assetReports,
      globalWarnings,
    );

    return {
      reportDate: new Date().toISOString(),
      totalAssets: assetReports.length,
      averageQualityScore,
      assetReports,
      globalWarnings,
      summary,
    };
  }

  /**
   * Форматирование сводки.
   */
  private formatSummary(
    averageScore: number,
    assetReports: AssetQualityReport[],
    globalWarnings: string[],
  ): string {
    let text = '<b>📊 Отчёт о качестве данных</b>\n\n';
    text += 'Активов проверено: ' + assetReports.length + '\n';
    text += 'Средний quality score: ' + averageScore + '%\n';

    // Разбиваем по категориям
    const good = assetReports.filter((r) => r.qualityScore >= 80).length;
    const fair = assetReports.filter((r) => r.qualityScore >= 50 && r.qualityScore < 80).length;
    const poor = assetReports.filter((r) => r.qualityScore < 50).length;

    text += '\n✅ Отлично: ' + good + '\n';
    text += '⚠️ Требует внимания: ' + fair + '\n';
    text += '❌ Критично: ' + poor + '\n';

    if (globalWarnings.length > 0) {
      text += '\n<b>Предупреждения:</b>\n';
      for (const warning of globalWarnings.slice(0, 5)) {
        text += '• ' + warning + '\n';
      }
    }

    return text;
  }
}

// ──────────────────────────────────────────────
// 3. Экспорт
// ──────────────────────────────────────────────
