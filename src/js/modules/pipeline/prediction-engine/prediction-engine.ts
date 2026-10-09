/**
 * PredictionEngine — единый фасад компонентов прогнозирования (подзадача 1.2.6).
 *
 * Действия (execute):
 * - forecast         — прогноз временного ряда (TimeSeriesForecaster);
 * - predict-needs    — предсказание потребностей (NeedPredictor, async);
 * - detect-anomalies — гибридная детекция аномалий (AnomalyDetectorV2);
 * - analyze-trend    — анализ тренда (TrendAnalyzer);
 * - plan-scenarios   — сценарии best/base/worst (ScenarioPlanner);
 * - full-report      — прогноз + аномалии + тренд + сценарии одним вызовом.
 *
 * Честный контракт: success=false + error при проблемах, без выдуманных данных.
 */

import { TimeSeriesForecaster } from './time-series-forecaster.js';
import { NeedPredictor } from './need-predictor.js';
import { AnomalyDetectorV2 } from './anomaly-detector-v2.js';
import { TrendAnalyzer } from './trend-analyzer.js';
import { ScenarioPlanner } from './scenario-planner.js';
import type {
  AnomalyDetectorV2Options,
  ForecastOptions,
  PredictionEngineAction,
  PredictionEngineOutput,
  ScenarioPlannerOptions,
  TimeSeriesPoint,
  TrendAnalyzerOptions,
} from './types.js';

/** DI-опции PredictionEngine */
export interface PredictionEngineOptions {
  forecaster?: TimeSeriesForecaster;
  needPredictor?: NeedPredictor;
  anomalyDetector?: AnomalyDetectorV2;
  trendAnalyzer?: TrendAnalyzer;
  scenarioPlanner?: ScenarioPlanner;
  /** Опции детектора аномалий (если создаём по умолчанию) */
  anomalyDetectorOptions?: AnomalyDetectorV2Options;
  /** Опции анализатора тренда (если создаём по умолчанию) */
  trendAnalyzerOptions?: TrendAnalyzerOptions;
  /** Опции планировщика сценариев (если создаём по умолчанию) */
  scenarioPlannerOptions?: ScenarioPlannerOptions;
}

/** Вход execute() */
export interface PredictionEngineInput {
  action: PredictionEngineAction;
  /** Ряд точек для forecast/detect-anomalies/analyze-trend/plan-scenarios/full-report */
  series?: readonly TimeSeriesPoint[];
  /** Опции прогноза (для forecast/full-report) */
  forecastOptions?: ForecastOptions;
  /** Окно тренда (для analyze-trend/full-report) */
  trendWindow?: number;
}

export class PredictionEngine {
  readonly forecaster: TimeSeriesForecaster;
  readonly needPredictor: NeedPredictor | null;
  readonly anomalyDetector: AnomalyDetectorV2;
  readonly trendAnalyzer: TrendAnalyzer;
  readonly scenarioPlanner: ScenarioPlanner;

  constructor(options: PredictionEngineOptions = {}) {
    this.forecaster = options.forecaster ?? new TimeSeriesForecaster();
    this.needPredictor = options.needPredictor ?? null;
    this.anomalyDetector =
      options.anomalyDetector ??
      new AnomalyDetectorV2(options.anomalyDetectorOptions);
    this.trendAnalyzer =
      options.trendAnalyzer ?? new TrendAnalyzer(options.trendAnalyzerOptions);
    this.scenarioPlanner =
      options.scenarioPlanner ??
      new ScenarioPlanner({
        forecaster: this.forecaster,
        ...options.scenarioPlannerOptions,
      });
  }

  /** Прогноз временного ряда. */
  forecast(series: readonly TimeSeriesPoint[], options?: ForecastOptions) {
    return this.forecaster.forecast(series, options);
  }

  /** Обнаружение аномалий. */
  detectAnomalies(series: readonly TimeSeriesPoint[]) {
    return this.anomalyDetector.detect(series);
  }

  /** Анализ тренда. */
  analyzeTrend(series: readonly TimeSeriesPoint[], windowSize?: number) {
    return this.trendAnalyzer.analyze(series, windowSize);
  }

  /** Сценарии best/base/worst. */
  planScenarios(series: readonly TimeSeriesPoint[]) {
    return this.scenarioPlanner.plan(series);
  }

  /** Предсказание потребностей (требует needPredictor в DI). */
  async predictNeeds() {
    if (!this.needPredictor) {
      throw new Error(
        'PredictionEngine: predict-needs недоступен — needPredictor не передан в конструктор',
      );
    }
    return this.needPredictor.predict();
  }

  /**
   * Полный отчёт по ряду: прогноз + аномалии + тренд + сценарии.
   * Компоненты независимы: ошибка одного не роняет отчёт целиком (честные поля error).
   */
  async fullReport(
    series: readonly TimeSeriesPoint[],
    options?: { forecastOptions?: ForecastOptions; trendWindow?: number },
  ) {
    const sections: Record<string, unknown> = {};
    const errors: Record<string, string> = {};

    try {
      sections.forecast = this.forecast(series, options?.forecastOptions);
    } catch (e) {
      errors.forecast = e instanceof Error ? e.message : String(e);
    }

    try {
      sections.anomalies = this.detectAnomalies(series);
    } catch (e) {
      errors.anomalies = e instanceof Error ? e.message : String(e);
    }

    try {
      sections.trend = this.analyzeTrend(series, options?.trendWindow);
    } catch (e) {
      errors.trend = e instanceof Error ? e.message : String(e);
    }

    try {
      sections.scenarios = this.planScenarios(series);
    } catch (e) {
      errors.scenarios = e instanceof Error ? e.message : String(e);
    }

    return {
      sections,
      errors,
      ok: Object.keys(errors).length === 0,
      points: series.length,
    };
  }

  /** Единая точка входа по action (контракт как у агентов). */
  async execute(input: PredictionEngineInput): Promise<PredictionEngineOutput> {
    try {
      switch (input.action) {
        case 'forecast': {
          if (!input.series) throw new Error('forecast: не передан series');
          return {
            action: input.action,
            success: true,
            data: this.forecast(input.series, input.forecastOptions),
          };
        }
        case 'predict-needs': {
          return {
            action: input.action,
            success: true,
            data: await this.predictNeeds(),
          };
        }
        case 'detect-anomalies': {
          if (!input.series)
            throw new Error('detect-anomalies: не передан series');
          return {
            action: input.action,
            success: true,
            data: this.detectAnomalies(input.series),
          };
        }
        case 'analyze-trend': {
          if (!input.series)
            throw new Error('analyze-trend: не передан series');
          return {
            action: input.action,
            success: true,
            data: this.analyzeTrend(input.series, input.trendWindow),
          };
        }
        case 'plan-scenarios': {
          if (!input.series)
            throw new Error('plan-scenarios: не передан series');
          return {
            action: input.action,
            success: true,
            data: this.planScenarios(input.series),
          };
        }
        case 'full-report': {
          if (!input.series) throw new Error('full-report: не передан series');
          return {
            action: input.action,
            success: true,
            data: await this.fullReport(input.series, {
              forecastOptions: input.forecastOptions,
              trendWindow: input.trendWindow,
            }),
          };
        }
        default: {
          return {
            action: input.action,
            success: false,
            error: `Неизвестное действие: ${String((input as { action?: string }).action)}`,
          };
        }
      }
    } catch (e) {
      return {
        action: input.action,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
