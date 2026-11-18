/**
 * Инвариант «значение конфига не дублируется литералом в коде».
 *
 * Почему AST, а не grep: число 200 или 15000 встречается в проекте в
 * десятках несвязанных контекстов (HTTP-статусы, длины строк, тесты).
 * Grep по числам даёт шум; AST-скан NumericLiteral в файлах-потребителях
 * проверяет именно те модули, которые обязаны читать конфиг.
 *
 * Строки-доски (TQBR/TQCB/EQOB) — наоборот, проверяются grep: это
 * протокольные идентификаторы, и в новых ISS-модулях они не должны
 * быть захардкожены — доска резолвится через ISS.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { PortfolioConfig } from './portfolio-config.js';

const ROOT = process.cwd();

interface Consumer {
  file: string;
  /** Ключ конфига, который модуль обязан читать. */
  configKey: string;
}

const CONSUMERS: Consumer[] = [
  {
    file: 'src/js/modules/api/moex-quotes/moex-quotes.ts',
    configKey: 'moexQuotes',
  },
  {
    file: 'src/js/modules/api/moex-quotes/technical-facts.ts',
    configKey: 'moexQuotes',
  },
  {
    file: 'src/js/modules/shared/python-engine/anomaly-detector.ts',
    configKey: 'moexQuotes',
  },
  {
    file: 'src/js/modules/ai/pipeline/agents/data-agent.ts',
    configKey: 'moexQuotes',
  },
  {
    file: 'src/js/modules/ai/ai-advisor/daily-move.ts',
    configKey: 'anomaly',
  },
  {
    file: 'src/js/modules/api/moex-api/bond-ytm-iss.ts',
    configKey: 'bondYtm',
  },
  {
    file: 'src/js/modules/api/moex-api/preferred-resolver.ts',
    configKey: 'preferredFallback',
  },
  {
    file: 'src/js/modules/api/moex-quotes/quote-cross-check.ts',
    configKey: 'quoteCrossCheck',
  },
  {
    file: 'src/js/modules/ai/ai-advisor/text-fixes.ts',
    configKey: 'textFixes',
  },
];

/** Значения, которые обязаны приходить только из конфига. */
const FORBIDDEN_VALUES = new Set<number>([
  PortfolioConfig.moexQuotes.historyWindowDays,
  PortfolioConfig.moexQuotes.minBarsFor52w,
  PortfolioConfig.moexQuotes.requestTimeoutMs,
  PortfolioConfig.anomaly.minTurnoverRub,
]);

function readSource(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

interface NumericLiteralLocation {
  value: number;
  line: number;
}

function numericLiterals(file: string, text: string): NumericLiteralLocation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const result: NumericLiteralLocation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isNumericLiteral(node)) {
      result.push({
        value: Number(node.text.replace(/_/g, '')),
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return result;
}

describe('инвариант не-хардкода: значения конфига', () => {
  it('ключи конфига существуют и имеют ожидаемый тип', () => {
    expect(PortfolioConfig.moexQuotes.historyWindowDays).toBeGreaterThan(0);
    expect(PortfolioConfig.moexQuotes.smaPeriods.length).toBeGreaterThan(0);
    expect(PortfolioConfig.moexQuotes.minBarsFor52w).toBeGreaterThan(0);
    expect(PortfolioConfig.moexQuotes.requestTimeoutMs).toBeGreaterThan(0);
    expect(PortfolioConfig.anomaly.dayChangePct).toBeGreaterThan(0);
    expect(PortfolioConfig.anomaly.minTurnoverRub).toBeGreaterThan(0);
    expect(PortfolioConfig.bondYtm.priceTolerancePct).toBeGreaterThan(0);
    expect(PortfolioConfig.bondYtm.yieldTolerancePct).toBeGreaterThan(0);
  });

  it.each(CONSUMERS)(
    '$file читает конфиг и не дублирует его значения литералами',
    ({ file, configKey }) => {
      const text = readSource(file);

      expect(text).toContain('PortfolioConfig');
      expect(text).toContain(configKey);

      const offenders = numericLiterals(file, text)
        .filter((literal) => FORBIDDEN_VALUES.has(literal.value))
        .map((literal) => `${file}:${literal.line} = ${literal.value}`);

      expect(offenders).toEqual([]);
    },
  );

  it('в новых ISS-модулях доска не захардкожена (grep по строкам-доскам)', () => {
    const issModules = [
      'src/js/modules/api/moex-quotes/moex-quotes.ts',
      'src/js/modules/api/moex-quotes/technical-facts.ts',
      'src/js/modules/api/moex-quotes/price-triggers.ts',
      'src/js/modules/api/moex-api/bond-ytm-iss.ts',
      'src/js/modules/api/moex-api/preferred-resolver.ts',
    ];
    const boardPattern = /['"](TQBR|TQCB|EQOB|TQTF|TQIF)['"]/;

    for (const file of issModules) {
      expect({ file, board: boardPattern.test(readSource(file)) }).toEqual({
        file,
        board: false,
      });
    }
  });
});
