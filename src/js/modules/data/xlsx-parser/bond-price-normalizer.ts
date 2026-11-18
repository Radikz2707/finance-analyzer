/**
 * Нормализация цен облигаций из Excel (QUIK).
 *
 * Проблема: QUIK отдаёт цену облигации то в рублях за единицу (998),
 * то в процентах от номинала (99,8), а иногда — дробью (0,998).
 * Безусловное умножение на `nominal / 100` превращало рублёвую цену
 * в «×10» (998 → 9980), а отсутствие номинала обнуляло позицию.
 *
 * Правила (сознательно консервативные):
 *   1. Не-облигации всегда в рублях.
 *   2. `rawIsRub` (цена получена как Стоимость / Позиция) — всегда рубли.
 *   3. `raw > MAX_PERCENT_PRICE` — рубли (процент от номинала почти
 *      никогда не превышает 250).
 *   4. `raw <= MAX_PERCENT_PRICE` и известен номинал — масштаб выбирается
 *      ТОЛЬКО при наличии ориентира (лист «Облигации», MOEX ISS, Smart-Lab).
 *      Без ориентира цена помечается как UNKNOWN с предупреждением:
 *      молча умножать нельзя.
 *   5. Нет цены вообще — внешний ориентир, иначе UNKNOWN + предупреждение.
 */

/** Единица исходной цены: рубль, процент от номинала или неизвестно */
export type PriceUnit = 'RUB' | 'PERCENT_OF_NOMINAL' | 'UNKNOWN';

/** Источник, из которого получена цена */
export type PriceSource =
  | 'QUIK_PRICE'
  | 'QUIK_COST'
  | 'QUIK_LIQ_PRICE'
  | 'BONDS_SHEET'
  | 'MOEX_ISS'
  | 'SMARTLAB'
  | 'UNKNOWN';

/** Масштаб, в котором трактуется исходное значение */
export type PriceScale = 'RUB' | 'PERCENT' | 'FRACTION' | 'UNKNOWN';

/** Внешний ориентир цены облигации */
export interface BondPriceReference {
  /** Номинал в рублях */
  nominal?: number;
  /** Цена в % от номинала */
  pricePct?: number;
  /** Цена в рублях за единицу (если источник отдаёт сразу рубли) */
  priceRub?: number;
  source: 'BONDS_SHEET' | 'MOEX_ISS' | 'SMARTLAB';
}

/** Параметры нормализации одной цены */
export interface ResolvePriceParams {
  /** Исходное значение из Excel (0 или отрицательное — «цены нет») */
  rawPrice: number;
  /** Номинал облигации в рублях */
  nominal?: number;
  /** Является ли актив облигацией */
  isBond: boolean;
  /** true — исходное значение гарантированно в рублях (Стоимость / Позиция) */
  rawIsRub?: boolean;
  /** Источник исходного значения */
  source: PriceSource;
  /** Внешние ориентиры: лист «Облигации», MOEX ISS, Smart-Lab */
  references?: BondPriceReference[];
}

/** Результат нормализации */
export interface PriceResolution {
  /** Цена в рублях за одну единицу (0, если масштаб не определён) */
  priceRub: number;
  /** Определённый масштаб исходного значения */
  scale: PriceScale;
  /** Единица исходного значения (для диагностики и отчётов) */
  priceUnit: PriceUnit;
  /** true — цена приведена к рублям и пригодна к расчётам */
  priceNormalized: boolean;
  /** Источник итоговой цены */
  priceSource: PriceSource;
  /** Предупреждение для отчёта (если масштаб не определён) */
  priceWarning?: string;
}

/**
 * Порог, выше которого значение однозначно трактуется как рубли.
 * Цена облигации в процентах от номинала практически не превышает 250%.
 */
export const MAX_PERCENT_PRICE = 250;

/** Допустимое относительное расхождение с ориентиром (20%) */
const REFERENCE_TOLERANCE = 0.2;

function toPositive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function relativeDiff(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Infinity;
  return Math.abs(a - b) / Math.abs(b);
}

function formatRub(value: number): string {
  return value.toFixed(2);
}

function unknownResolution(warning: string): PriceResolution {
  return {
    priceRub: 0,
    scale: 'UNKNOWN',
    priceUnit: 'UNKNOWN',
    priceNormalized: false,
    priceSource: 'UNKNOWN',
    priceWarning: warning,
  };
}

/**
 * Нормализует цену одной единицы актива в рубли.
 *
 * Функция чистая: все внешние данные (номинал, ориентиры) передаются
 * аргументами, поэтому её легко покрыть тестами.
 */
export function resolvePrice(params: ResolvePriceParams): PriceResolution {
  const references = params.references ?? [];
  const nominal =
    toPositive(params.nominal) ??
    references.map((ref) => toPositive(ref.nominal)).find(Boolean);

  const referenceWithPct = references.find(
    (ref) => toPositive(ref.pricePct) !== undefined,
  );
  const referenceWithRub = references.find(
    (ref) => toPositive(ref.priceRub) !== undefined,
  );
  const referencePct = toPositive(referenceWithPct?.pricePct);
  const referenceRub = toPositive(referenceWithRub?.priceRub);
  const referenceSource: PriceSource =
    referenceWithPct?.source ?? referenceWithRub?.source ?? 'UNKNOWN';
  const expectedRub =
    referenceRub ??
    (referencePct !== undefined && nominal !== undefined
      ? (referencePct * nominal) / 100
      : undefined);

  const raw = params.rawPrice;
  const hasRaw = Number.isFinite(raw) && raw > 0;

  // 1. Акции / ETF / фонды — цена всегда в рублях.
  if (!params.isBond) {
    if (hasRaw) {
      return {
        priceRub: raw,
        scale: 'RUB',
        priceUnit: 'RUB',
        priceNormalized: true,
        priceSource: params.source,
      };
    }
    if (expectedRub !== undefined) {
      return {
        priceRub: round2(expectedRub),
        scale: referenceRub !== undefined ? 'RUB' : 'PERCENT',
        priceUnit: 'RUB',
        priceNormalized: true,
        priceSource: referenceSource,
      };
    }
    return unknownResolution(
      'Цена отсутствует в Excel и не найдена на MOEX — стоимость позиции не учтена.',
    );
  }

  // 2. Значение гарантированно в рублях (Стоимость / Позиция).
  if (hasRaw && params.rawIsRub) {
    return {
      priceRub: raw,
      scale: 'RUB',
      priceUnit: 'RUB',
      priceNormalized: true,
      priceSource: params.source,
    };
  }

  // 3. Сырая цена есть — определяем масштаб.
  if (hasRaw) {
    if (raw > MAX_PERCENT_PRICE) {
      return {
        priceRub: raw,
        scale: 'RUB',
        priceUnit: 'RUB',
        priceNormalized: true,
        priceSource: params.source,
      };
    }

    // Без номинала процент от номинала вычислить нельзя — это рубли.
    if (nominal === undefined) {
      return {
        priceRub: raw,
        scale: 'RUB',
        priceUnit: 'RUB',
        priceNormalized: true,
        priceSource: params.source,
      };
    }

    const candidates: Array<{ scale: PriceScale; rub: number }> = [
      { scale: 'RUB', rub: raw },
      { scale: 'PERCENT', rub: (raw * nominal) / 100 },
      { scale: 'FRACTION', rub: raw * nominal },
    ];

    // Номинал ≈ 100: рубли и проценты дают одно и то же значение.
    const percentCandidate = candidates.find((c) => c.scale === 'PERCENT')!;
    if (relativeDiff(percentCandidate.rub, raw) < 0.01) {
      return {
        priceRub: raw,
        scale: 'RUB',
        priceUnit: 'RUB',
        priceNormalized: true,
        priceSource: params.source,
      };
    }

    if (expectedRub !== undefined) {
      const ranked = candidates
        .map((candidate) => ({
          ...candidate,
          diff: relativeDiff(candidate.rub, expectedRub),
        }))
        .sort((a, b) => a.diff - b.diff);
      const best = ranked[0]!;

      if (best.diff <= REFERENCE_TOLERANCE) {
        return {
          priceRub: round2(best.rub),
          scale: best.scale,
          priceUnit: best.scale === 'RUB' ? 'RUB' : 'PERCENT_OF_NOMINAL',
          priceNormalized: true,
          priceSource: params.source,
        };
      }

      return unknownResolution(
        `Цена ${formatRub(raw)} не согласуется с рыночным ориентиром ` +
          `${formatRub(expectedRub)} ₽ (номинал ${formatRub(nominal)} ₽). ` +
          'Масштаб не определён — проверьте колонку «Цена» в QUIK.',
      );
    }

    // Ориентира нет: не угадываем масштаб молча.
    return unknownResolution(
      `Цена ${formatRub(raw)} может быть в % от номинала ` +
        `(${formatRub(nominal)} ₽), но нет ориентира MOEX/листа «Облигации». ` +
        'Укажите цену в рублях — стоимость позиции не учтена.',
    );
  }

  // 4. Сырой цены нет — используем внешний ориентир.
  if (expectedRub !== undefined) {
    return {
      priceRub: round2(expectedRub),
      scale: referenceRub !== undefined ? 'RUB' : 'PERCENT',
      priceUnit: referenceRub !== undefined ? 'RUB' : 'PERCENT_OF_NOMINAL',
      priceNormalized: true,
      priceSource: referenceSource,
    };
  }

  return unknownResolution(
    'Цена отсутствует в Excel и не найдена на MOEX/Smart-Lab — ' +
      'стоимость позиции не учтена.',
  );
}

/**
 * Приводит «сопутствующую» цену (балансовую, ликвидационную) к рублям.
 *
 * Использует ту же логику, что и основная цена, но с собственным
 * значением и теми же внешними ориентирами. Если масштаб не определён,
 * возвращает исходное значение без домыслов.
 */
export function resolveCompanionPrice(
  rawPrice: number,
  nominal: number | undefined,
  references: BondPriceReference[] | undefined,
): number {
  const resolution = resolvePrice({
    rawPrice,
    nominal,
    isBond: true,
    source: 'QUIK_PRICE',
    references,
  });
  if (resolution.priceNormalized) return resolution.priceRub;
  return rawPrice > 0 ? rawPrice : 0;
}
