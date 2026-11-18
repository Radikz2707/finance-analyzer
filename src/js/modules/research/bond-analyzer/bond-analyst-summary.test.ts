import type {
  CreditAssessment,
  DurationAnalysis,
  LiquidityAssessment,
  YieldAnalysis,
} from './bond-analyzer-types.js';
import { buildBondFinalAssessment } from './bond-analyst-summary.js';

function createYieldAnalysis(o: Partial<YieldAnalysis> = {}): YieldAnalysis {
  return {
    currentYield: 14.28,
    ytm: 16.48,
    effectiveYield: null,
    annualCouponIncome: 1428,
    nextCouponPayment: null,
    nextCouponDate: null,
    couponType: 'FIXED',
    couponTypeReason: null,
    couponTypeReasonDetail: null,
    couponTypeSource: 'ISS',
    ytmMethod: 'CALCULATED_FIXED_COUPON',
    dataQuality: 'AVAILABLE',
    ...o,
  };
}

function createCredit(o: Partial<CreditAssessment> = {}): CreditAssessment {
  return {
    quality: 'MEDIUM',
    source: 'MOEX ISS',
    asOfDate: '2026-11-17T00:00:00.000Z',
    summary: '',
    ...o,
  };
}

function createDuration(): DurationAnalysis {
  return {
    duration: 2.5,
    durationType: 'MODIFIED',
    dv01: 100,
    scenarios: [],
    dataQuality: 'AVAILABLE',
    derivedDataQuality: 'AVAILABLE',
  };
}

function createLiquidity(): LiquidityAssessment {
  return {
    status: 'AVAILABLE',
    turnover: 1_000_000,
    turnoverUnit: 'RUB',
    spread: null,
    depth: null,
    summary: 'Ликвидность достаточная',
  };
}

function assess(
  o: {
    yieldAnalysis?: Partial<YieldAnalysis>;
    credit?: Partial<CreditAssessment>;
    portfolioMathStatus?: string;
  } = {},
) {
  return buildBondFinalAssessment({
    yieldAnalysis: createYieldAnalysis(o.yieldAnalysis),
    durationAnalysis: createDuration(),
    creditAssessment: createCredit(o.credit),
    liquidityAssessment: createLiquidity(),
    portfolioMathStatus: o.portfolioMathStatus ?? 'HOLD',
    currentPercent: 5,
    targetPercent: 5,
    positionValue: 100_000,
    isin: 'RU000A10ABC1',
    instrumentName: 'ОФЗ 29027',
  });
}

describe('buildBondFinalAssessment — флоатер (ОФЗ-ПК)', () => {
  it('не называет YTM доходностью к погашению', () => {
    const result = assess({ yieldAnalysis: { couponType: 'FLOATER' } });

    expect(result.rationale).not.toContain('Доходность к погашению');
    expect(result.rationale).toContain(
      'YTM не является доходностью к погашению',
    );
    expect(result.rationale).toContain('Купон плавающий (FLOATER)');
  });

  it('не выдаёт BUY по YTM, если текущая доходность неизвестна', () => {
    const result = assess({
      yieldAnalysis: { couponType: 'FLOATER', currentYield: null, ytm: 16.48 },
      portfolioMathStatus: 'BUY',
    });

    expect(result.recommendation).toBe('HOLD');
  });

  it('для флоатера критерий привлекательности — текущая доходность', () => {
    const result = assess({
      yieldAnalysis: { couponType: 'FLOATER', currentYield: 14.28 },
      portfolioMathStatus: 'BUY',
    });

    expect(result.recommendation).toBe('BUY');
  });
});

describe('buildBondFinalAssessment — кредитный риск', () => {
  it('блокирует покупку при дефолте/реструктуризации независимо от доходности', () => {
    const result = assess({
      yieldAnalysis: { ytm: 35 },
      credit: {
        quality: 'MEDIUM',
        rating: { agency: 'ЭРА', rating: 'BB', outlook: 'DEFAULT' },
      },
      portfolioMathStatus: 'BUY',
    });

    expect(result.recommendation).toBe('EXIT');
    expect(result.rationale).toContain('дефолт/реструктуризация');
  });

  it('помечает высокую доходность как компенсацию кредитного риска', () => {
    const result = assess({
      yieldAnalysis: { ytm: 35 },
      credit: { quality: 'MEDIUM' },
    });

    expect(result.rationale).toContain('компенсация кредитного риска');
    expect(result.rationale).toContain('а не признак привлекательности');
  });

  it('показывает кредитное качество с источником и датой', () => {
    const result = assess();

    expect(result.rationale).toContain(
      'Кредитное качество: MEDIUM (MOEX ISS, 17.11.2026)',
    );
  });

  it('не подставляет дату, если её нет', () => {
    const result = assess({ credit: { asOfDate: null } });

    expect(result.rationale).toContain('дата не указана');
  });
});

describe('buildBondFinalAssessment — обычный фикс', () => {
  it('сохраняет формулировку «Доходность к погашению» для FIXED', () => {
    const result = assess({ yieldAnalysis: { couponType: 'FIXED' } });

    expect(result.rationale).toContain('Доходность к погашению: 16.48%');
    expect(result.rationale).not.toContain('Купон плавающий');
  });
});

describe('buildBondFinalAssessment — контр-тест 29027', () => {
  it('UNKNOWN не подтверждает FIXED и не выдаёт YTM за доходность к погашению', () => {
    const result = assess({
      yieldAnalysis: {
        couponType: 'UNKNOWN',
        couponTypeReason: 'excel_conflict',
        couponTypeReasonDetail: 'Excel FIXED, ISS FLOATER (ОФЗ-ПК)',
        couponTypeSource: null,
      },
    });

    expect(result.rationale).toContain('тип купона не подтверждён');
    expect(result.rationale).not.toContain('Доходность к погашению: 16.48%');
    expect(result.rationale).not.toContain('Купон фиксированный');
  });
});
