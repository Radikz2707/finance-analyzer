/**
 * AnomalyDetectorV2 — обнаружение аномалий во временных рядах (подзадача 1.2.3).
 *
 * Методы (все детерминированные):
 * - spike/drop: z-score относительно базовой статистики ряда;
 * - shift: CUSUM на сдвиг среднего уровня;
 * - volatility: сравнение локальной волатильности с базовой;
 * - flatline: замирание — одинаковые значения подряд.
 *
 * Отличие от python-engine/anomaly-detector: работает на произвольных
 * временных рядах TimeSeriesPoint, гибридная детекция, честные предупреждения.
 */

import type {
  Anomaly,
  AnomalyDetectorV2Options,
  AnomalyV2Result,
  TimeSeriesPoint,
} from './types.js';

// ──────────────────────────────────────────────
// Константы и ошибки
// ──────────────────────────────────────────────

export const DEFAULT_Z_THRESHOLD = 3;
export const DEFAULT_CUSUM_THRESHOLD = 5;
export const DEFAULT_MIN_POINTS = 10;
export const DEFAULT_VOLATILITY_THRESHOLD = 2.5;

/** Ошибка AnomalyDetectorV2 */
export class AnomalyDetectorV2Error extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnomalyDetectorV2Error';
  }
}

// ──────────────────────────────────────────────
// Вспомогательные функции
// ──────────────────────────────────────────────

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function sampleStd(values: readonly number[], mu: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((s, v) => s + (v - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ──────────────────────────────────────────────
// AnomalyDetectorV2
// ──────────────────────────────────────────────

export class AnomalyDetectorV2 {
  private readonly zThreshold: number;
  private readonly cusumThreshold: number;
  private readonly minPoints: number;
  private readonly volatilityThreshold: number;

  constructor(options: AnomalyDetectorV2Options = {}) {
    this.zThreshold = options.zThreshold ?? DEFAULT_Z_THRESHOLD;
    this.cusumThreshold = options.cusumThreshold ?? DEFAULT_CUSUM_THRESHOLD;
    this.minPoints = Math.max(4, options.minPoints ?? DEFAULT_MIN_POINTS);
    this.volatilityThreshold =
      options.volatilityThreshold ?? DEFAULT_VOLATILITY_THRESHOLD;
  }

  /** Обнаружить аномалии в ряду значений. */
  detect(series: readonly TimeSeriesPoint[]): AnomalyV2Result {
    if (!Array.isArray(series)) {
      throw new AnomalyDetectorV2Error('detect(): ожидается массив точек');
    }
    if (series.length < this.minPoints) {
      throw new AnomalyDetectorV2Error(
        `Для анализа аномалий нужно минимум ${this.minPoints} точек, получено ${series.length}`,
      );
    }

    const warnings: string[] = [];
    const values = series.map((p) => p.value);
    const mu = mean(values);
    const sigma = sampleStd(values, mu);

    const stats = {
      mean: round(mu),
      std: round(sigma),
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    };

    if (sigma === 0) {
      // Ряд вырожденный — все значения одинаковы
      return {
        anomalies: [],
        stats,
        warnings: [
          'Ряд вырожден (std = 0) — spike/drop/volatility не могут быть обнаружены; возможна только flatline',
        ],
      };
    }

    const anomalies: Anomaly[] = [];
    const seen = new Set<string>();

    // ── 1. spike/drop: |z| > zThreshold ──
    for (let i = 0; i < series.length; i++) {
      const z = (values[i]! - mu) / sigma;
      if (Math.abs(z) > this.zThreshold) {
        const type = z > 0 ? 'spike' : 'drop';
        const key = `${i}:${type}`;
        if (!seen.has(key)) {
          seen.add(key);
          anomalies.push({
            index: i,
            ts: series[i]!.ts,
            value: values[i]!,
            type,
            severity: round(Math.abs(z), 2),
            description:
              `${type === 'spike' ? 'Выброс вверх' : 'Выброс вниз'}: значение ${round(values[i]!)} ` +
              `отклоняется на ${round(Math.abs(z), 1)}σ от среднего ${round(mu)}`,
          });
        }
      }
    }

    // ── 2. shift: CUSUM на сдвиг уровня ──
    // Односторонний CUSUM вверх и вниз, порог в сигмах
    let cusumUp = 0;
    let cusumDown = 0;
    const drift = 0.5; // подстройка (drift k) в сигмах
    for (let i = 0; i < series.length; i++) {
      const z = (values[i]! - mu) / sigma;
      cusumUp = Math.max(0, cusumUp + z - drift);
      cusumDown = Math.max(0, cusumDown - z - drift);
      if (cusumUp >= this.cusumThreshold) {
        const key = `${i}:shift-up`;
        if (!seen.has(key)) {
          seen.add(key);
          anomalies.push({
            index: i,
            ts: series[i]!.ts,
            value: values[i]!,
            type: 'shift',
            severity: round(cusumUp, 2),
            description: `Сдвиг уровня вверх (CUSUM = ${round(cusumUp, 1)}σ): серия значений выше исторического среднего`,
          });
        }
        cusumUp = 0; // сброс после фиксации сдвига
      }
      if (cusumDown >= this.cusumThreshold) {
        const key = `${i}:shift-down`;
        if (!seen.has(key)) {
          seen.add(key);
          anomalies.push({
            index: i,
            ts: series[i]!.ts,
            value: values[i]!,
            type: 'shift',
            severity: round(cusumDown, 2),
            description: `Сдвиг уровня вниз (CUSUM = ${round(cusumDown, 1)}σ): серия значений ниже исторического среднего`,
          });
        }
        cusumDown = 0;
      }
    }

    // ── 3. volatility: локальная волатильность >> базовая ──
    if (series.length >= 5) {
      // Базовая волатильность: std первых/скользящих дельт
      const deltas: number[] = [];
      for (let i = 1; i < series.length; i++) {
        deltas.push(values[i]! - values[i - 1]!);
      }
      const deltaStd = sampleStd(deltas, mean(deltas));
      if (deltaStd > 0) {
        // Сравниваем std в окне из 3 точек с общей волатильностью
        const window = 3;
        for (let i = window; i < series.length; i++) {
          const local: number[] = [];
          for (let j = i - window + 1; j <= i; j++) {
            local.push(values[j]! - values[j - 1]!);
          }
          const localStd = sampleStd(local, mean(local));
          const ratio = localStd / deltaStd;
          if (ratio > this.volatilityThreshold) {
            const key = `${i}:volatility`;
            if (!seen.has(key)) {
              seen.add(key);
              anomalies.push({
                index: i,
                ts: series[i]!.ts,
                value: values[i]!,
                type: 'volatility',
                severity: round(ratio, 2),
                description: `Всплеск волатильности: локальная волатильность ${round(ratio, 1)}x базовой`,
              });
            }
          }
        }
      }
    } else {
      warnings.push('Меньше 5 точек — детекция волатильности пропущена');
    }

    // ── 4. flatline: одинаковые значения >= 5 подряд ──
    const FLATLINE_RUN = 5;
    let runStart = 0;
    for (let i = 1; i <= series.length; i++) {
      const same = i < series.length && values[i] === values[runStart];
      if (!same) {
        const runLen = i - runStart;
        if (runLen >= FLATLINE_RUN) {
          const endIndex = i - 1;
          const key = `${endIndex}:flatline`;
          if (!seen.has(key)) {
            seen.add(key);
            anomalies.push({
              index: endIndex,
              ts: series[endIndex]!.ts,
              value: values[endIndex]!,
              type: 'flatline',
              severity: runLen,
              description: `Замирание: значение ${values[endIndex]!} повторяется ${runLen} точек подряд`,
            });
          }
        }
        runStart = i;
      }
    }

    // Сортировка по индексу
    anomalies.sort((a, b) => a.index - b.index || a.type.localeCompare(b.type));

    if (series.length < 20) {
      warnings.push(
        `Мало точек (${series.length}) — пороги z-score/CUSUM могут срабатывать ложно`,
      );
    }

    return { anomalies, stats, warnings };
  }
}
