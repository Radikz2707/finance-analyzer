/**
 * Diagnostic Pipeline — запуск БЕЗ LLM.
 * Только фетчеры и расчёты: CBR, bond coupons, dividends, portfolio math.
 *
 * Запуск:
 *   npx tsx scripts/pipeline-diagnostic.ts
 */

/// <reference types="node" />
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// Force reload .env
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

import {
  getCbrKeyRate,
  clearCbrRateCache,
} from '../src/js/modules/ai/ai-advisor/cbr-rate.js';
import { fetchPortfolioBondCouponsLtm } from '../src/js/modules/ai/ai-advisor/bond-coupon-ltm.js';
import { fetchDividendLtm } from '../src/js/modules/ai/ai-advisor/dividend-ltm.js';
import { DataAgent } from '../src/js/modules/ai/pipeline/agents/data-agent.js';
import { AnalysisAgent } from '../src/js/modules/ai/pipeline/agents/analysis-agent.js';

async function runDiagnostic(): Promise<void> {
  console.log('='.repeat(70));
  console.log('[DIAGNOSTIC] Запуск диагностического прогона БЕЗ LLM');
  console.log('='.repeat(70));

  // === 1. CBR FETCH ===
  console.log('');
  console.log('-'.repeat(70));
  console.log('[DIAGNOSTIC] 1. CBR Key Rate Fetch');
  console.log('-'.repeat(70));
  clearCbrRateCache();
  const cbrResult = await getCbrKeyRate();
  console.log('[CBR_FETCH] rate=' + cbrResult.rate + '%');
  console.log('[CBR_FETCH] date=' + cbrResult.date);
  console.log('[CBR_FETCH] source=' + cbrResult.source);
  console.log('[CBR_FETCH] isFresh=' + cbrResult.isFresh);
  console.log('[CBR_FETCH] lastUpdated=' + cbrResult.lastUpdated);

  // === 2. Portfolio data (DataAgent + AnalysisAgent) ===
  console.log('');
  console.log('-'.repeat(70));
  console.log('[DIAGNOSTIC] 2. Data Agent + Analysis Agent');
  console.log('-'.repeat(70));

  const dataAgent = new DataAgent({ name: 'DataAgent', verbose: true });
  const dataResult = await dataAgent.execute(null);
  const dataOutput = dataResult.data as Record<string, any>;

  const analysisAgent = new AnalysisAgent({
    name: 'AnalysisAgent',
    verbose: true,
  });
  const analysisResult = await analysisAgent.execute(dataOutput);
  const analysisOutput = analysisResult.data as Record<string, any>;

  const assets = analysisOutput.portfolioAnalysis.assetsAnalysis;
  console.log('[DIAGNOSTIC] Assets: ' + assets.length);
  console.log(
    '[DIAGNOSTIC] Total value: ' +
      Math.round(dataOutput.macroGoals.totalLiquidationValue).toLocaleString(
        'ru-RU',
      ) +
      '₽',
  );

  // === 3. Bond Coupon LTM ===
  console.log('');
  console.log('-'.repeat(70));
  console.log('[DIAGNOSTIC] 3. Bond Coupon LTM on portfolio bonds');
  console.log('-'.repeat(70));

  // Важно: fetchPortfolioBondCouponsLtm принимает { ticker, quantity }.
  // Передача массива строк давала пустые тикеры → все бумаги UNAVAILABLE
  // и нулевую сумму. Берём количество из PortfolioMath.
  const bondPositions = assets
    .filter((a: any) => a.assetType === 'О' || a.assetType === 'Облигация')
    .map((a: any) => ({
      ticker: String(a.ticker ?? '')
        .trim()
        .toUpperCase(),
      quantity: Number(a.quantity) || 0,
    }))
    .filter((a: any) => a.ticker && a.quantity > 0);

  console.log(
    '[DIAGNOSTIC] Bond positions: ' +
      bondPositions.map((b: any) => `${b.ticker}×${b.quantity}`).join(', '),
  );

  try {
    const couponResults = await fetchPortfolioBondCouponsLtm(bondPositions);
    for (const bond of couponResults.bonds) {
      console.log(
        '[BOND_COUPON_LTM_RESULT] ticker=' +
          bond.ticker +
          ' status=' +
          bond.status +
          ' perBond=' +
          (bond.ltmPerBond ?? 'null') +
          ' count=' +
          bond.count +
          ' asOf=' +
          (bond.asOf ?? 'n/a') +
          ' source=' +
          bond.source,
      );
    }
    console.log(
      '[BOND_COUPON_LTM_SUMMARY] gross=' +
        couponResults.totalGross.toFixed(2) +
        ' net=' +
        couponResults.totalNet.toFixed(2) +
        ' bonds=' +
        couponResults.bonds.length +
        ' status=' +
        couponResults.status,
    );
    if (couponResults.warnings.length > 0) {
      console.log(
        '[BOND_COUPON_WARNINGS] ' + couponResults.warnings.join(', '),
      );
    }
  } catch (err: any) {
    console.error('[BOND_COUPON_ERROR] ' + (err?.message || String(err)));
    console.error('[BOND_COUPON_STACK] ' + (err?.stack || 'N/A'));
  }

  // === 4. TATN Dividend check ===
  console.log('');
  console.log('-'.repeat(70));
  console.log('[DIAGNOSTIC] 4. TATN Dividend LTM');
  console.log('-'.repeat(70));

  try {
    const now = new Date();
    const tatnLtm = await fetchDividendLtm('TATN', 'Татнефть', now);
    console.log(
      '[TATN_DIVIDENDS] LTM result: ' + JSON.stringify(tatnLtm, null, 2),
    );
  } catch (err: any) {
    console.error('[TATN_DIVIDENDS] Error: ' + (err?.message || String(err)));
    console.error('[TATN_DIVIDENDS] Stack: ' + (err?.stack || 'N/A'));
  }

  // Also check dividends LTM from analysis output
  const income = analysisOutput.income;
  console.log('[DIAGNOSTIC] DividendDataStatus: ' + income.dividendDataStatus);
  console.log('[DIAGNOSTIC] TotalDivsNet: ' + income.totalDivsNet);
  console.log('[DIAGNOSTIC] TotalNkd: ' + income.totalNkd);
  console.log(
    '[DIAGNOSTIC] Dividend warnings: ' +
      JSON.stringify(income.dividendWarnings),
  );

  // === 5. XIRR check ===
  console.log('');
  console.log('-'.repeat(70));
  console.log('[DIAGNOSTIC] 5. XIRR data from DataAgent');
  console.log('-'.repeat(70));
  console.log(
    '[DIAGNOSTIC] HistoricalTrades count: ' +
      (dataOutput.historicalTrades?.length ?? 0),
  );
  if (dataOutput.historicalTrades && dataOutput.historicalTrades.length > 0) {
    const plzl = dataOutput.historicalTrades.find(
      (t: any) =>
        t.ticker?.toUpperCase() === 'PLZL' ||
        t.isin?.toUpperCase() === 'RU000A10EC22',
    );
    if (plzl) {
      console.log(
        '[XIRR] PLZL trades: ' + plzl.cashFlows?.length + ' CF entries',
      );
      // Show first and last few
      const cf = plzl.cashFlows || [];
      console.log('[XIRR] First 3 CF: ' + JSON.stringify(cf.slice(0, 3)));
      console.log('[XIRR] Last 3 CF: ' + JSON.stringify(cf.slice(-3)));
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('[DIAGNOSTIC] Диагностический прогон завершён');
  console.log('='.repeat(70));

  await dataAgent.stop();
  await analysisAgent.stop();
}

runDiagnostic().catch((err) => {
  console.error('[DIAGNOSTIC] Fatal error:', err);
  process.exit(1);
});
