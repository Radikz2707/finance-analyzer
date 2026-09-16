/**
 * Investment Thesis Engine — типы.
 *
 * Определяет входные данные (PortfolioAssetContext + AssetResearchSnapshot)
 * и выходные структуры для детерминированного формирования InvestmentThesis.
 */

import type {
  AssetType,
  PortfolioMathStatus,
} from '../types.js';

// ──────────────────────────────────────────────
// 1. Portfolio Asset Context
// ──────────────────────────────────────────────

/**
 * Контекст актива в портфеле.
 * Используется как контекст, а НЕ как фундаментальный факт эмитента.
 */
export interface PortfolioAssetContext {
  /** Текущая доля актива в портфеле (проценты) */
  currentPercent: number;
  /** Целевая доля актива в портфеле (проценты, undefined = нет цели) */
  targetPercent?: number;
  /** Статус от PortfolioMath */
  portfolioMathStatus: PortfolioMathStatus;
  /** Текущая стоимость позиции (RUB) */
  currentPriceRub: number;
  /** Цена покупки (RUB) */
  balancePrice: number;
  /** Количество единиц актива */
  quantity: number;
  /** Нереализованная прибыль/убыток (RUB) */
  unrealizedProfitRub: number;
  /** Общая стоимость портфеля (RUB) */
  totalPortfolioValue: number;
}

// ──────────────────────────────────────────────
// 2. Investment Thesis Input
// ──────────────────────────────────────────────

/**
 * Входные данные для Investment Thesis Engine.
 * Объединяет ResearchSnapshot и Portfolio context.
 */
export interface InvestmentThesisInput {
  /** Снимок исследования актива */
  snapshot: import('../types.js').AssetResearchSnapshot;
  /** Контекст актива в портфеле (может быть undefined для нового актива) */
  portfolioContext?: PortfolioAssetContext;
}

// ──────────────────────────────────────────────
// 3. Valuation View
// ──────────────────────────────────────────────

/** Источник данных для valuation view */
export type ValuationDataSource = 'VALUE' | 'DERIVED' | 'INSUFFICIENT';

/** Представление оценки стоимости */
export interface ValuationView {
  /** Итоговая оценка: "undervalued", "fairly_valued", "overvalued", "insufficient_data" */
  stance: 'undervalued' | 'fairly_valued' | 'overvalued' | 'insufficient_data';
  /** Обоснование на основе мультипликаторов */
  reasoning: string;
  /** Источник данных */
  dataSource: ValuationDataSource;
  /** Список использованных мультипликаторов */
  multiplexersUsed: string[];
  /** Список мультипликаторов с отсутствующими данными */
  multiplexersMissing: string[];
}

// ──────────────────────────────────────────────
// 4. Macro Sensitivity
// ──────────────────────────────────────────────

/** Источник данных для macro sensitivity */
export type MacroSensitivitySource = 'VALUE' | 'DERIVED' | 'INSUFFICIENT';

/** Чувствительность к макроэкономике */
export interface MacroSensitivity {
  /** Уровень чувствительности */
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  /** Описание чувствительности */
  description: string;
  /** Источник данных */
  dataSource: MacroSensitivitySource;
  /** Использованные макро-факторы */
  factorsUsed: string[];
  /** Выводы помеченные как DERIVED */
  derivedConclusions: string[];
}

// ──────────────────────────────────────────────
// 5. Confidence
// ──────────────────────────────────────────────

/** Уровень уверенности в тезисе */
export type ThesisConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** Уверенность в InvestmentThesis */
export interface ThesisConfidence {
  /** Численное значение 0..1 */
  value: number;
  /** Уровень */
  level: ThesisConfidenceLevel;
  /** Причины снижения уверенности */
  downgrades: string[];
  /** Причины повышения уверенности */
  upgrades: string[];
}

// ──────────────────────────────────────────────
// 6. Evidence Reference
// ──────────────────────────────────────────────

/** Ссылка на доказательство в тезисе */
export interface EvidenceReference {
  /** ID доказательства */
  evidenceId: string;
  /** Краткое описание факта */
  fact: string;
  /** Тип доказательства */
  type: string;
}

// ──────────────────────────────────────────────
// 7. InvestmentThesis (output)
// ──────────────────────────────────────────────

/**
 * Результат работы Investment Thesis Engine.
 * Полностью детерминированный / rule-based вывод.
 */
export interface InvestmentThesisResult {
  /** Основной инвестиционный тезис */
  thesis: string;
  /** Бычий сценарий */
  bullCase: string;
  /** Базовый сценарий */
  baseCase: string;
  /** Медвежий сценарий */
  bearCase: string;
  /** Ключевые драйверы */
  keyDrivers: string[];
  /** Ключевые риски */
  keyRisks: string[];
  /** Ключевые катализаторы */
  keyCatalysts: string[];
  /** Представление об оценке */
  valuationView: ValuationView;
  /** Чувствительность к макроэкономике */
  macroSensitivity: MacroSensitivity;
  /** Уверенность в тезисе */
  confidence: ThesisConfidence;
  /** Ссылки на доказательства */
  evidenceReferences: EvidenceReference[];
  /** Тип актива */
  assetType: AssetType;
  /** Тикер */
  ticker: string;
  /** Метка времени генерации */
  generatedAt: string;
}
