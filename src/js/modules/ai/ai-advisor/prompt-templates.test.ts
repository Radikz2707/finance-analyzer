import {
  buildJsonOnlySystemPrompt,
  buildSystemPrompt,
} from './prompt-templates.js';
import type { TechnicalIndicators } from './prompt-templates.js';
import type {
  FundamentalsSource,
  SourcedValue,
} from '../../api/fundamentals/types.js';

describe('buildSystemPrompt', () => {
  const basePrompt = buildSystemPrompt(18);

  it('contains ROLE block', () => {
    expect(basePrompt).toContain('=== РОЛЬ ===');
    expect(basePrompt).toContain('инвестиционный стратег');
  });

  it('contains MAIN RULES block', () => {
    expect(basePrompt).toContain('=== ГЛАВНЫЕ ПРАВИЛА ===');
  });

  it('contains INVESTMENT REASONING block', () => {
    expect(basePrompt).toContain('=== ИНВЕСТИЦИОННЫЙ REASONING ===');
  });

  it('contains JSON-BLOCK format', () => {
    expect(basePrompt).toContain('=== JSON-МАССИВ');
  });

  it('требует машинный JSON-блок ценовых триггеров (задача 4Г)', () => {
    expect(basePrompt).toContain('=== JSON-БЛОК ЦЕНОВЫХ ТРИГГЕРОВ');
    expect(basePrompt).toContain('"priceTriggers"');
    // Точный пример схемы: модель выдавала 4 блока не по схеме.
    expect(basePrompt).toContain(
      '{"priceTriggers":[{"ticker":"SBER","levels":[{"price":280,"direction":"below"},{"price":320,"direction":"above"}],"action":"HOLD"}]}',
    );
    expect(basePrompt).toContain(
      'levels — непустой массив объектов ровно с полями price',
    );
    expect(basePrompt).toContain('только один блок на весь ответ');
    expect(basePrompt).toContain(
      'Если подтверждённых уровней нет — НЕ выводи этот блок вообще',
    );
    expect(basePrompt).toContain(
      'Для активов под no-sell политикой action не может быть SELL/REDUCE/EXIT',
    );
  });

  it('instructs model to output JSON block FIRST (before narrative)', () => {
    expect(basePrompt).toContain('ОБЯЗАТЕЛЬНО ПЕРВЫМ');
    expect(basePrompt).toContain('СНАЧАЛА выведи JSON-МАССИВ');
    expect(basePrompt).toContain('ТЕКСТОВЫЙ ОТВЕТ (5 секций, ПОСЛЕ JSON)');
  });

  it('запрещает модели генерировать блок стратегий и прогнозы доходности', () => {
    expect(basePrompt).not.toContain('Стратегия выхода в прибыль');
    expect(basePrompt).toContain(
      'НЕ генерируй блок «Инвестиционные стратегии»',
    );
    expect(basePrompt).toContain('ЗАПРЕЩЕНЫ любые прогнозы доходности');
    expect(basePrompt).toContain('«+5-15% за 3 мес»');
    expect(basePrompt).toContain('«+20-40% за 12 мес»');
    expect(basePrompt).toContain('«ожидаемая доходность +20-40% годовых»');
    expect(basePrompt).toContain('купонно-дивидендный');
  });

  it('запрещает дублировать карточки рекомендаций в свободном тексте', () => {
    expect(basePrompt).not.toContain('2. Рекомендации по каждому активу');
    expect(basePrompt).toContain(
      'НЕ дублируй рекомендации по активам в тексте',
    );
    expect(basePrompt).toContain('структурированных карточках');
  });

  it('contains macro context with rate', () => {
    const p = buildSystemPrompt(18, undefined, undefined, {
      keyRate: 18,
      source: 'CBR',
      asOf: '2026-10-01',
      isFresh: true,
    });
    expect(p).toContain('Ставка ЦБ: 18%');
  });

  it('contains tickers when provided', () => {
    const p = buildSystemPrompt(18, undefined, ['SBER', 'GAZP']);
    expect(p).toContain('SBER');
    expect(p).toContain('GAZP');
  });

  it('contains macro data when provided', () => {
    const p = buildSystemPrompt(18, undefined, undefined, {
      keyRate: 21,
      inflation: 7.5,
      currency: 95,
      oil: 82,
      source: 'CBR',
      asOf: '2026-09-01',
      isFresh: true,
    });
    expect(p).toContain('21%');
    expect(p).toContain('Инфляция: 7.5%');
  });

  // === Core investment freedom rules ===

  it('rule 1: USER_TARGET_PERCENT is input fact only', () => {
    expect(basePrompt).toContain(
      'Целевые доли (targetPercent) — факт пользователя',
    );
    expect(basePrompt).toContain('AI НЕ изменяет');
  });

  it('rule 2: AI can define AI_RECOMMENDED_TARGET_PERCENT and AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain('AI_RECOMMENDED_TARGET_PERCENT');
    expect(basePrompt).toContain('AI самостоятельно определяет');
  });

  it('rule 3: AI can disagree with PortfolioMath and USER_TARGET', () => {
    expect(basePrompt).toContain(
      'AI может НЕ соглашаться с PortfolioMath и USER_TARGET',
    );
  });

  it('rule 4: deep loss does NOT block SELL/EXIT/REDUCE', () => {
    expect(basePrompt).toContain(
      'Глубокий убыток НЕ блокирует SELL/EXIT/REDUCE',
    );
    expect(basePrompt).toContain('AI самостоятельно определяет');
  });

  it('rule 5: EXIT, AVERAGE are valid AI actions', () => {
    expect(basePrompt).toContain('EXIT');
    expect(basePrompt).toContain('AVERAGE');
    expect(basePrompt).toContain('BUY');
    expect(basePrompt).toContain('SELL');
    expect(basePrompt).toContain('HOLD');
    expect(basePrompt).toContain('REDUCE');
    expect(basePrompt).toContain('AVOID');
  });

  it('rule 6: AI can propose own target different from USER_TARGET', () => {
    expect(basePrompt).toContain('AI_RECOMMENDED_TARGET_PERCENT');
    expect(basePrompt).toContain(
      'AI может НЕ соглашаться с PortfolioMath и USER_TARGET',
    );
  });

  it('rule 7: AI must not invent missing data', () => {
    expect(basePrompt).toContain('ЗАПРЕЩЕНО: выдумывать отсутствующие данные');
  });

  it('rule 8: targetReason required for AI recommendations', () => {
    expect(basePrompt).toContain('targetReason');
  });

  // === Separation of concerns ===

  it('rule 9: deterministic constraints precede AI reasoning, reasoning precedes output contract', () => {
    const rulesIndex = basePrompt.indexOf('=== ГЛАВНЫЕ ПРАВИЛА ===');
    const reasoningIndex = basePrompt.indexOf(
      '=== ИНВЕСТИЦИОННЫЙ REASONING ===',
    );
    const jsonIndex = basePrompt.indexOf('=== JSON-МАССИВ');
    expect(rulesIndex).toBeGreaterThanOrEqual(0);
    expect(reasoningIndex).toBeGreaterThanOrEqual(0);
    expect(jsonIndex).toBeGreaterThanOrEqual(0);
    expect(rulesIndex).toBeLessThan(reasoningIndex);
    expect(reasoningIndex).toBeLessThan(jsonIndex);
  });

  it('rule 9: PortfolioMath status is not a hint for AI_RECOMMENDED_ACTION', () => {
    expect(basePrompt).toContain(
      'PortfolioMath status — результат детерминированной математики',
    );
    expect(basePrompt).toContain('AI может НЕ соглашаться с PortfolioMath');
  });

  it('rule 9: AI must state agreement or disagreement with PortfolioMath', () => {
    expect(basePrompt).toContain('AGREE');
    expect(basePrompt).toContain('DISAGREE');
  });

  it('rule 10: NO_DATA marker prevents invented fundamentals', () => {
    expect(basePrompt).toContain('NO_DATA');
    expect(basePrompt).toContain('«нет данных»');
    expect(basePrompt).toContain('НЕ писать "недооценен"');
  });

  it('rule 10: AI shows uncertainty when data is missing', () => {
    expect(basePrompt).toContain('NO_DATA');
    expect(basePrompt).toContain('«нет данных»');
    expect(basePrompt).toContain('НЕ писать "недооценен"');
  });

  // === Prohibitions ===

  it('forbids guaranteed returns', () => {
    expect(basePrompt).toContain('ЗАПРЕЩЕНО: "гарантированная доходность"');
  });

  it('forbids risk-free claims', () => {
    expect(basePrompt).toContain('безрисковый');
  });

  it('does NOT propose new target structure', () => {
    expect(basePrompt).not.toContain(
      'Предложи новую сбалансированную структуру',
    );
  });

  it('does NOT require stop-loss', () => {
    expect(basePrompt).not.toContain('указывай уровни стоп-лосса');
  });

  it('forbids generalizations without numbers and sources', () => {
    expect(basePrompt).toContain('обобщать без числа');
    expect(basePrompt).toContain('обычно 15-20%');
    expect(basePrompt).toContain('источник не отвечает');
  });

  it('renders fundamentals with source, date and 5-year median', () => {
    const metric = (
      value: number | null,
      source: FundamentalsSource = 'smart-lab.ru',
    ): SourcedValue => ({
      value,
      source: value === null ? null : source,
      asOf: value === null ? null : '2026-11-17T00:00:00.000Z',
      status: value === null ? 'UNAVAILABLE' : 'VALUE',
      note: value === null ? 'источник не отвечает' : undefined,
    });

    const prompt = buildSystemPrompt(
      18,
      undefined,
      ['TATN'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        assets: [
          {
            ticker: 'TATN',
            name: 'Татнефть',
            price: metric(676, 'MOEX ISS'),
            marketCap: metric(1_473_000_000_000, 'MOEX ISS'),
            pe: metric(5.13),
            ps: metric(1.2),
            pb: metric(1.0),
            roe: metric(19.0),
            roa: metric(12.1),
            debtToEquity: metric(0.0078),
            dividendYield: metric(9.0),
            dividendPerShare: metric(34.09),
            nextDividendDate: {
              value: '2026-12-01',
              source: 'MOEX ISS',
              asOf: '2026-11-17T00:00:00.000Z',
              status: 'VALUE',
            },
            revenue: metric(1_822_000_000_000),
            netIncome: metric(265_800_000_000),
            equity: metric(1_379_000_000_000),
            debt: metric(10_800_000_000),
            medians: {
              pe5y: 5.77,
              roe5y: 23.2,
              dividendYield5y: 12.4,
              debtToEquity5y: 0.02,
              years: 5,
              source: 'smart-lab.ru',
              asOf: '2026-11-17T00:00:00.000Z',
            },
            fundamentalHealth: 'POSITIVE',
            summary:
              'P/E 5,13 (smart-lab.ru, 17.11.2026); медиана 5 лет 5,77 (smart-lab.ru, 17.11.2026).',
            unavailable: [],
            conflicts: [],
            sourcesUsed: ['MOEX ISS', 'smart-lab.ru'],
          },
        ],
        warnings: [],
        asOf: '2026-11-17T00:00:00.000Z',
        smartLabEnabled: true,
      },
    );

    // Компактный формат: показатель + источник/дата в конце строки.
    expect(prompt).toContain('P/E 5,13');
    expect(prompt).toContain('(smart-lab.ru, 17.11.2026)');
    expect(prompt).toContain(
      'Медиана 5 лет (smart-lab.ru, 17.11.2026): P/E 5,77',
    );
    expect(prompt).toContain('Дивидендная доходность 9,0%');
    expect(prompt).toContain('MOEX ISS');
    expect(prompt).not.toContain(
      'Данные по мультипликаторам недоступны через текущие источники',
    );
  });

  it('renders honest unavailable note instead of a number', () => {
    const unavailable: SourcedValue = {
      value: null,
      source: null,
      asOf: null,
      status: 'UNAVAILABLE',
      note: 'источник не отвечает',
    };
    const unavailableString: SourcedValue<string> = {
      value: null,
      source: null,
      asOf: null,
      status: 'UNAVAILABLE',
      note: 'источник не отвечает',
    };
    const prompt = buildSystemPrompt(
      18,
      undefined,
      ['IRAO'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        assets: [
          {
            ticker: 'IRAO',
            name: 'Интер РАО',
            price: unavailable,
            marketCap: unavailable,
            pe: unavailable,
            ps: unavailable,
            pb: unavailable,
            roe: unavailable,
            roa: unavailable,
            debtToEquity: unavailable,
            dividendYield: unavailable,
            dividendPerShare: unavailable,
            nextDividendDate: unavailableString,
            revenue: unavailable,
            netIncome: unavailable,
            equity: unavailable,
            debt: unavailable,
            medians: null,
            fundamentalHealth: 'NEUTRAL',
            summary: 'P/E: недоступно (источник не отвечает).',
            unavailable: ['P/E — источник не отвечает'],
            conflicts: [],
            sourcesUsed: [],
          },
        ],
        warnings: ['smart-lab.ru не отвечает'],
        asOf: '2026-11-17T00:00:00.000Z',
        smartLabEnabled: true,
      },
    );

    expect(prompt).toContain('P/E недоступно (источник не отвечает)');
    expect(prompt).toContain('smart-lab.ru не отвечает');
  });

  it('рендерит 52w и SMA из конфига, недоступные — честно (задача 4Д)', () => {
    const prompt = buildSystemPrompt(
      18,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          ticker: 'SBER',
          rsi: 55,
          sma20: null,
          sma50: 300,
          smaPeriods: [50, 200],
          smaValues: { '50': 300, '200': null },
          high52w: 350,
          low52w: 250,
          technicalAsOf: '2026-11-18',
          trend: 'up',
          volatilityAnnual: 0.2,
          riskLevel: 'low',
          zScoreLast: 0.5,
          isLastAnomaly: false,
        },
      ],
    );

    expect(prompt).toContain('SMA50: 300.00');
    expect(prompt).toContain('SMA200: недоступно');
    expect(prompt).toContain(
      '52-недельный диапазон: 250.00–350.00 (MOEX ISS, 2026-11-18)',
    );
    expect(prompt).not.toContain('на основе 180 дней');
  });
});

describe('buildJsonOnlySystemPrompt', () => {
  it('требует только JSON и перечисляет недостающие активы', () => {
    const prompt = buildJsonOnlySystemPrompt(['TATN', 'IRAO', 'RU000A109L49']);
    expect(prompt).toContain('Верни ТОЛЬКО JSON-массив');
    expect(prompt).toContain('TATN, IRAO, RU000A109L49');
    expect(prompt).toContain('agreementWithPortfolioMath');
    expect(prompt).not.toContain('7 секций');
  });

  it('добавляет компактные фундаментальные данные с источником и датой', () => {
    const metric = (value: number | null): SourcedValue => ({
      value,
      source: value === null ? null : 'smart-lab.ru',
      asOf: value === null ? null : '2026-11-17T00:00:00.000Z',
      status: value === null ? 'UNAVAILABLE' : 'VALUE',
      note: value === null ? 'источник не отвечает' : undefined,
    });

    const unavailableString: SourcedValue<string> = {
      value: null,
      source: null,
      asOf: null,
      status: 'UNAVAILABLE',
      note: 'нет данных',
    };

    const prompt = buildJsonOnlySystemPrompt(['TATN'], {
      assets: [
        {
          ticker: 'TATN',
          name: 'Татнефть',
          price: metric(676),
          marketCap: metric(1_473_000_000_000),
          pe: metric(5.13),
          ps: metric(1.2),
          pb: metric(1.0),
          roe: metric(19.0),
          roa: metric(12.1),
          debtToEquity: metric(0.0078),
          dividendYield: metric(9.0),
          dividendPerShare: metric(34.09),
          nextDividendDate: unavailableString,
          revenue: metric(1_822_000_000_000),
          netIncome: metric(265_800_000_000),
          equity: metric(1_379_000_000_000),
          debt: metric(10_800_000_000),
          medians: {
            pe5y: 5.77,
            roe5y: 23.2,
            dividendYield5y: 12.4,
            debtToEquity5y: 0.02,
            years: 5,
            source: 'smart-lab.ru',
            asOf: '2026-11-17T00:00:00.000Z',
          },
          fundamentalHealth: 'POSITIVE',
          summary: 'P/E 5,13 (smart-lab.ru, 17.11.2026).',
          unavailable: [],
          conflicts: [],
          sourcesUsed: ['MOEX ISS', 'smart-lab.ru'],
        },
      ],
      warnings: [],
      asOf: '2026-11-17T00:00:00.000Z',
      smartLabEnabled: true,
    });

    expect(prompt).toContain('=== ФУНДАМЕНТАЛЬНЫЕ ДАННЫЕ ===');
    expect(prompt).toContain('P/E 5,13');
    expect(prompt).toContain('(smart-lab.ru, 17.11.2026)');
    expect(prompt).toContain('Медиана 5 лет');
  });

  it('передаёт техфакты (SMA/52w) с датой — повторный JSON не теряет индикаторы', () => {
    const indicator: TechnicalIndicators = {
      ticker: 'TATN',
      rsi: 54.2,
      sma20: null,
      sma50: null,
      smaPeriods: [20, 50],
      smaValues: { '20': 301.25, '50': 298.4 },
      high52w: 340,
      low52w: 250,
      technicalAsOf: '2026-11-18',
      trend: 'up',
      volatilityAnnual: 0.35,
      riskLevel: 'medium',
      zScoreLast: 0.4,
      isLastAnomaly: false,
    };

    const prompt = buildJsonOnlySystemPrompt(['TATN'], undefined, [indicator]);

    expect(prompt).toContain('=== ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ (MOEX ISS) ===');
    expect(prompt).toContain('• TATN: RSI 54.2');
    expect(prompt).toContain('SMA20 301.25');
    expect(prompt).toContain('SMA50 298.40');
    expect(prompt).toContain('52w 250.00–340.00');
    expect(prompt).toContain('тренд восходящий');
    expect(prompt).toContain('волатильность 35.0%');
    expect(prompt).toContain('на 2026-11-18');
  });

  it('недоступные техфакты пишет словом «недоступно», а не нулём', () => {
    const indicator: TechnicalIndicators = {
      ticker: 'PLZL',
      rsi: null,
      sma20: null,
      sma50: null,
      high52w: null,
      low52w: null,
      technicalAsOf: null,
      trend: null,
      volatilityAnnual: null,
      riskLevel: null,
      zScoreLast: null,
      isLastAnomaly: false,
    };

    const prompt = buildJsonOnlySystemPrompt(['PLZL'], undefined, [indicator]);

    expect(prompt).toContain('RSI недоступно');
    expect(prompt).toContain('SMA20 недоступно');
    expect(prompt).toContain('52w недоступно');
    expect(prompt).toContain('тренд недоступно');
    expect(prompt).toContain('дата н/д');
    expect(prompt).not.toContain('RSI 0.0');
  });

  it('без техфактов блока технических индикаторов нет', () => {
    const prompt = buildJsonOnlySystemPrompt(['SBER']);

    expect(prompt).not.toContain('=== ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ');
  });
});

describe('prompt-templates: политика no-sell в тексте (задача 1)', () => {
  it('buildSystemPrompt запрещает sell-директивы и свободные числовые цели доли', () => {
    const prompt = buildSystemPrompt(18);

    expect(prompt).toContain('ПОЛИТИКА NO-SELL В ТЕКСТЕ');
    expect(prompt).toContain('ЗАПРЕТ СВОБОДНЫХ ЧИСЛОВЫХ ЦЕЛЕЙ ДОЛИ');
    expect(prompt).toContain('с 17,4% до ~12%');
    expect(prompt).toContain(
      'продажа/сокращение заблокированы политикой no-sell',
    );
  });

  it('buildJsonOnlySystemPrompt тоже запрещает sell-директивы по no-sell', () => {
    const prompt = buildJsonOnlySystemPrompt(['PLZL']);

    expect(prompt).toContain('пометкой no-sell');
    expect(prompt).toContain('ЗАПРЕЩЕНЫ директивы');
    expect(prompt).toContain('Свободные числовые цели доли');
  });
});
