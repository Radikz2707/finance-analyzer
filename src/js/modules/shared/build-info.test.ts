import { DashboardReportBuilder } from '../../../components/dashboard/dashboard.js';
import { getMarkdownTemplate } from '../ai/ai-advisor/report-templates.js';
import { getBuildId } from './build-info.js';

describe('getBuildId', () => {
  it('возвращает непустой идентификатор версии+коммита', () => {
    const id = getBuildId();

    expect(id.length).toBeGreaterThan(3);
    expect(id).toContain('+');
    expect(id).not.toContain('undefined');
  });

  it('учитывает GIT_COMMIT и BUILD_TIME из окружения', () => {
    const prevCommit = process.env.GIT_COMMIT;
    const prevTime = process.env.BUILD_TIME;
    process.env.GIT_COMMIT = 'abc123';
    process.env.BUILD_TIME = '2026-11-18T12:00:00.000Z';

    try {
      const id = getBuildId();
      expect(id).toContain('abc123');
      expect(id).toContain('2026-11-18T12:00:00.000Z');
    } finally {
      if (prevCommit === undefined) delete process.env.GIT_COMMIT;
      else process.env.GIT_COMMIT = prevCommit;
      if (prevTime === undefined) delete process.env.BUILD_TIME;
      else process.env.BUILD_TIME = prevTime;
    }
  });
});

describe('build-id в отчётах', () => {
  it('HTML-шапка содержит «build: <id>»', () => {
    const html = new DashboardReportBuilder({
      totalVal: '0',
      freeCash: '0',
      stocksPct: 0,
      bondsPct: 0,
      cbrRate: 0,
      cbrRateDisplay: null,
      totalInvested: '0',
      resultC10: '0',
      profitC11: '0',
      c10Color: '#fff',
      c11Color: '#fff',
      dateStr: '18.11.2026',
      timeStr: '15:12',
      aiBoxHtml: '',
      buildId: '1.0.1+test',
      barRows: '',
      tableRows: '',
      ordersRows: '',
      priorityBlock: '',
      concentrationBlock: '',
      rebalanceBlock: '',
      stocksPositionsBlock: '',
      quotesTableRows: '',
      topGainers: '',
      topLosers: '',
    }).buildHtml();

    expect(html).toContain('build: 1.0.1+test');
  });

  it('Markdown-шаблон содержит «build: <id>»', () => {
    const md = getMarkdownTemplate(
      '18.11.2026',
      '0',
      '0',
      0,
      0,
      '',
      '1.0.1+test',
    );

    expect(md).toContain('build: 1.0.1+test');
  });
});
