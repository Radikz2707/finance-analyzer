const fs = require('fs');
const filePath = 'src/js/modules/ai-advisor/ai-client.ts';
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

let startLine = -1;
let endLine = -1;
let braceDepth = 0;
let foundMethod = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!foundMethod && line.includes('private buildPortfolioContext(')) {
    startLine = i;
    foundMethod = true;
  }
  if (foundMethod) {
    braceDepth += (line.match(/{/g) || []).length;
    braceDepth -= (line.match(/}/g) || []).length;
    if (braceDepth <= 0 && i > startLine) {
      endLine = i;
      break;
    }
  }
}

console.log('Method found: line', startLine + 1, 'to', endLine + 1);

const A = '\u0410';
const a = '\u0410\u043a\u0446\u0438\u044f';
const O = '\u041e';
const b = '\u041e\u0431\u043b\u0438\u0433\u0430\u0446\u0438\u044f';
const RUB = '\u20bd';
const STAR = '\u26a0\uFE0F';
const DASH = '\u2014';
const AMP = '\u0026';

const newMethod = [
  '  /**',
  '   * Построение контекста портфеля для ИИ.',
  '   * СЖАТАЯ ВЕРСИЯ: агрегированные метрики + таблица активов (~350 символов на актив).',
  '   * Цель: < 5000 символов для 11 активов вместо ~25000.',
  '   */',
  '  private buildPortfolioContext(',
  '    analysis: PortfolioReportData,',
  '    _inc: CalculatedIncome,',
  '    _validation: ValidationResult,',
  '    orders: UIOrdersData,',
  '    snapshot: PortfolioSnapshot | null,',
  '    thesisResults: Map<string, InvestmentThesisResult>,',
  '    _historicalData?: {',
  '      profitC10: number;',
  '      profitC11: number;',
  '      investedNet: number;',
  '      totalPurchases: number;',
  '      totalSales: number;',
  '      commission: number;',
  '    },',
  '    accountsInfo?: Array<{ name: string; value: number }>,',
  '    macroData?: MacroDataContext,',
  '  ): string {',
  '    const { assetsAnalysis, macro } = analysis;',
  '    const totalVal = macro.totalBalance;',
  '',
  '    const snapshotFinancial = snapshot?.financial ?? null;',
  '    const contributedCapital = snapshotFinancial?.contributedCapital ?? 0;',
  '    const currentEquityGap = snapshotFinancial?.currentEquityGap ?? 0;',
  '    const currentEquityGapPct = snapshotFinancial?.currentEquityGapPct ?? 0;',
  '    const historicalMarketResult = snapshotFinancial?.historicalMarketResult ?? 0;',
  '',
  '    const totalNetProfit = snapshotFinancial',
  '      ? snapshotFinancial.currentAssets + snapshotFinancial.freeCash - snapshotFinancial.contributedCapital',
  '      : totalVal - contributedCapital;',
  '    const totalNetProfitPercent = contributedCapital > 0 ? (totalNetProfit / contributedCapital) * 100 : 0;',
  '',
  '    let stocksPct = 0, bondsPct = 0;',
  '    for (const a of assetsAnalysis) {',
  "      if (a.assetType === '" + A + "' || a.assetType === '" + a + "') stocksPct += a.currentPercent;",
  "      if (a.assetType === '" + O + "' || a.assetType === '" + b + "') bondsPct += a.currentPercent;",
  '    }',
  '    stocksPct = Math.round(stocksPct * 100) / 100;',
  '    bondsPct = Math.round(bondsPct * 100) / 100;',
  '',
  '    const currentDate = new Date().toLocaleDateString("ru-RU");',
  '    const rateValue = macroData?.keyRate ?? 0;',
  '    const isFresh = macroData?.isFresh ?? false;',
  '',
  '    let ctx = "=== \\u0414\\u0410\\u041d\\u041d\\u042b\\u0415 \\u041f\\u041e\\u0420\\u0422\\u0424\\u0415\\u041b\\u042f ===\\n";',
  '    ctx += "\\u0414\\u0430\\u0442\\u0430: " + currentDate + " | \\u041f\\u043e\\u0440\\u0442\\u0444\\u0435\\u043b\\u044c: " + totalVal.toLocaleString("ru-RU") + " \\u20bd\\n";',
  '    ctx += "\\u0412\\u043b\\u043e\\u0436\\u0435\\u043d\\u043e: " + contributedCapital.toLocaleString("ru-RU") + " \\u20bd | \\u0418\\u043d\\u0432\\u0435\\u0441\\u0442-\\u0440\\u0435\\u0437\\u0443\\u043b\\u044c\\u0442\\u0430\\u0442: "',
  '      + (totalNetProfit >= 0 ? "+" : "") + totalNetProfit.toFixed(2) + " \\u20bd ("',
  '      + totalNetProfitPercent.toFixed(2) + "%)\\n";',
  '    ctx += "\\u0421\\u0432\\u043e\\u0431\\u043e\\u0434\\u043d\\u044b\\u0439 \\u043a\\u044d\\u0448: " + macro.freeCash.toLocaleString("ru-RU") + " \\u20bd | \\u0421\\u0442\\u0430\\u0432\\u043a\\u0430 \\u0426\\u0411: " + rateValue + "%\\n";',
  '    if (!isFresh) ctx += "' + STAR + ' DATA_STATUS=STALE (\\u0438\\u0441\\u0442\\u043e\\u0447\\u043d\\u0438\\u043a: " + (macroData?.source || "unknown") + ")\\n";',
  '    if (snapshotFinancial) {',
  '      ctx += "\\u0414\\u0435\\u0444\\u0438\\u0446\\u0438\\u0442 \\u0434\\u043e\\u043b\\u0438: " + currentEquityGap.toLocaleString("ru-RU") + " \\u20bd ("',
  '        + currentEquityGapPct.toFixed(2) + "%)\\n";',
  '    }',
  '    ctx += "\\u0421\\u0442\\u0440\\u0443\\u043a\\u0442\\u0443\\u0440\\u0430: \\u0410\\u043a\\u0446\\u0438\\u0438 " + stocksPct + "% | \\u041e\\u0431\\u043b\\u0438\\u0433\\u0430\\u0446\\u0438\\u0438 " + bondsPct + "%\\n\\n";',
  '',
  '    if (snapshot && snapshot.accounts.length > 0) {',
  '      ctx += "\\u0421\\u0447\\u0435\\u0442\\u0430:";',
  '      for (const acc of snapshot.accounts) {',
  '        ctx += " " + acc.accountId + "(" + acc.accountType + "="',
  '          + acc.totalLiquidationValue.toLocaleString("ru-RU") + " \\u20bd)";',
  '      }',
  '      ctx += "\\n";',
  '    } else if (accountsInfo && accountsInfo.length > 0) {',
  '      ctx += "\\u0421\\u0447\\u0435\\u0442\\u0430:";',
  '      accountsInfo.forEach((a) => { ctx += " " + a.name + "=" + a.value.toLocaleString("ru-RU") + " \\u20bd"; });',
  '      ctx += "\\n";',
  '    }',
  '',
  '    ctx += "\\n=== \\u0410\\u041a\\u0422\\u0418\\u0412\\u042b (\\u0442\\u0430\\u0431\\u043b\\u0438\\u0446\\u0430) ===\\n";',
  '    ctx += "\\u0424\\u043e\\u0440\\u043c\\u0430\\u0442: [\\u0422\\u0418\\u041f] \\u0422\\u0438\\u043a\\u0435\\u0440 | \\u0418\\u043c\\u044f | \\u0414\\u043e\\u043b\\u044f% | \\u0426\\u0435\\u043d\\u0430 | \\u0412\\u0445\\u043e\\u0434 | P' + AMP + 'L% | \\u041a\\u043e\\u043b-\\u0432\\u043e | \\u041b\\u0438\\u043a\\u0432\\u0438\\u0434\\u0430\\u0446\\u0438\\u044f | \\u0414\\u0435\\u0444\\u0438\\u0446\\u0438\\u0442 | \\u0421\\u0442\\u0430\\u0442\\u0443\\u0441 | ThesisConf | Thesis\\n";',
  '',
  '    for (const a of assetsAnalysis) {',
  '      if (a.currentPercent === 0 && a.targetPercent === 0) continue;',
  '',
  "      const type = (a.assetType === '" + A + "' || a.assetType === '" + a + "') ? '\\u0410\\u041a\\u0426\\u0418\\u042F'",
  "        : (a.assetType === '" + O + "' || a.assetType === '" + b + "') ? '\\u041e\\u0411\\u041b' : '\\u0424\\u041e\\u041d\\u0414';",
  '',
  '      const pnlFromEntry = a.balancePrice > 0 && a.currentPrice > 0',
  '        ? (((a.currentPrice - a.balancePrice) / a.balancePrice) * 100).toFixed(1)',
  "        : '" + DASH + "';",
  '',
  '      const liquidation = (a.currentPrice * a.quantity).toLocaleString("ru-RU");',
  '      const deficitStr = a.deficitRub > 0 ? "+" + a.deficitRub.toLocaleString("ru-RU")',
  '        : a.deficitRub < 0 ? Math.abs(a.deficitRub).toLocaleString("ru-RU")',
  "        : '" + DASH + "';",
  '',
  '      const thesis = thesisResults.get(a.ticker);',
  '      const thesisConf = thesis ? (thesis.confidence.level + "(" + thesis.confidence.value.toFixed(2) + ")")',
  "        : 'NO_RESEARCH';",
  '      const thesisSummary = thesis',
  "        ? (thesis.thesis.length > 80 ? thesis.thesis.substring(0, 80) + '...' : thesis.thesis)",
  "        : '\\u041d\\u0435\\u0442 \\u0434\\u0430\\u043d\\u043d\\u044b\\u0445';",
  '',
  "      const marketStatus = a.currentPrice <= 0 ? ' BLOCKED' : '';",
  '',
  "      ctx += type + ' ' + a.ticker + ' | ' + a.name + ' | '",
  "        + a.currentPercent.toFixed(1) + '% | ' + a.currentPrice + ' | '",
  "        + a.balancePrice + ' | ' + pnlFromEntry + '% | '",
  "        + a.quantity + ' | ' + liquidation + ' | '",
  "        + deficitStr + ' | ' + a.status + marketStatus + ' | '",
  "        + thesisConf + ' | ' + thesisSummary + '\\n';",
  '    }',
  '',
  '    if (orders.md) {',
  '      ctx += "\\n=== \\u0417\\u0410\\u042f\\u0412\\u041a\\u0418 ===\\n" + orders.md;',
  '    }',
  '',
  '    return ctx;',
  '  }',
  '',
].join('\n');

const newContent = lines.slice(0, startLine).join('\n') + '\n' + newMethod + '\n' + lines.slice(endLine + 1).join('\n');
fs.writeFileSync(filePath, newContent);
console.log('File written successfully.');
console.log('Original lines:', lines.length);
console.log('New lines:', newContent.split('\n').length);

const contextStart = newContent.indexOf('let ctx = "===');
const contextEnd = newContent.indexOf('return ctx;');
console.log('Context body length:', (contextEnd - contextStart), 'characters');
