import { PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { UIOrdersData } from './types.js';
import { CalculatedIncome } from './income-calculator.js';

/**
 * Генерация резервного отчета при ошибке API
 */
export function buildFallbackReport(
  analysis: PortfolioReportData,
  inc: CalculatedIncome,
  validation: ValidationResult,
  orders: UIOrdersData,
  cbrRate: number,
  newAssetsForAi?: string,
): string {
  const { assetsAnalysis, macro } = analysis;
  const parts: string[] = [];

  // 1. Активы на выход (targetPercent === 0)
  const exitAssets = assetsAnalysis.filter((a) => a.targetPercent === 0 && a.currentPercent > 0);
  if (exitAssets.length > 0) {
    const exitItems = exitAssets
      .map((a) => {
        const ordersCount = orders.md ? (a.ticker ? (orders.md.match(new RegExp(a.ticker, 'g')) || []).length : 0) : 0;
        const orderNote = ordersCount > 0
          ? ' Обнаружены активные заявки на продажу в QUIK.'
          : '';
        return '• <strong>' + a.name + ' (' + a.ticker + '):</strong> целевая доля занулена в связи с плановым выходом из позиции. Текущая доля ' + a.currentPercent.toFixed(1) + '%.' + orderNote + ' Стратегия дивестирования полностью оправдана.<br>';
      })
      .join('\n');
    parts.push(exitItems);
  }

  // 2. Активы на покупку (BUY) — ребалансировка
  const buyAssets = assetsAnalysis.filter((a) => a.status === 'BUY' && a.targetPercent > 0);
  if (buyAssets.length > 0) {
    const buyItems = buyAssets
      .map((a) => {
        const gap = a.targetPercent - a.currentPercent;
        return '• <strong>' + a.name + ' (' + a.ticker + '):</strong> дефицит ' + gap.toFixed(1) + '% (цель ' + a.targetPercent.toFixed(1) + '%, факт ' + a.currentPercent.toFixed(1) + '%), необходимо докупить на ' + a.deficitRub.toLocaleString('ru-RU') + ' ₽.';
      })
      .join('<br>');
    parts.push(
      '• <strong>Ребалансировка:</strong> необходимо привести портфель к целевым долям. ' + buyItems + '<br>'
    );
  }

  // 3. Активы на снижение (REDUCE)
  const reduceAssets = assetsAnalysis.filter((a) => a.status === 'REDUCE');
  if (reduceAssets.length > 0) {
    const reduceItems = reduceAssets
      .map((a) => {
        const excess = a.currentPercent - a.targetPercent;
        return '• <strong>' + a.name + ' (' + a.ticker + '):</strong> профицит ' + excess.toFixed(1) + '% (цель ' + a.targetPercent.toFixed(1) + '%, факт ' + a.currentPercent.toFixed(1) + '%), рекомендуется сократить позицию на ' + Math.abs(a.deficitRub).toLocaleString('ru-RU') + ' ₽.';
      })
      .join('<br>');
    parts.push(reduceItems + '<br>');
  }

  // 4. Новые активы
  const newAssets = assetsAnalysis.filter((a) => a.status === 'NEW');
  if (newAssets.length > 0) {
    const newItems = newAssets
      .map((a) => {
        const autoMatch = newAssetsForAi ? newAssetsForAi.match(new RegExp(a.ticker + '.*?рекомендуется (\\d+)%', 's')) : null;
        const target = autoMatch ? autoMatch[1] : '—';
        return '• <strong>' + a.name + ' (' + a.ticker + '):</strong> новый актив без целевой доли. Автоматическая рекомендация: <strong>' + target + '%</strong>.';
      })
      .join('<br>');
    parts.push(newItems + '<br>');
  }

  // 5. Предупреждения о рисках
  if (!validation.isValid) {
    const riskItems = validation.errors
      .map((e) => '• <strong>⚠️ Риск:</strong> ' + e)
      .join('<br>');
    parts.push(riskItems + '<br>');
  }

  // 6. Макро-контекст
  const stocksDeficit = macro.stocksDeficitRub;
  const bondsDeficit = macro.bondsDeficitRub;
  const totalDeficit = stocksDeficit + bondsDeficit;
  const macroNote = totalDeficit > 0
    ? ' Для достижения целевой структуры требуется ' + totalDeficit.toLocaleString('ru-RU') + ' ₽ свободных средств.'
    : ' Портфель имеет профицит, возможна реинвестиция.';
  parts.push(
    '• <strong>Текущая ставка ЦБ:</strong> при макро-контексте ' + cbrRate + '% распределение активов (Акции ' + macro.stocksPercent + '%, Облигации ' + macro.bondsPercent + '%) ' + macroNote
  );

  // 7. Пассивный доход
  if (inc.totalNkd > 0 || inc.totalDivsNet > 0) {
    parts.push(
      '• <strong>Пассивный доход:</strong> НКД по облигациям ' + inc.totalNkd.toLocaleString('ru-RU') + ' ₽, ожидаемый чистый дивидендный поток (LTM) ' + inc.totalDivsNet.toLocaleString('ru-RU') + ' ₽.'
    );
  }

  // 8. Заявки
  if (orders.md) {
    parts.push('• <strong>Действующие заявки:</strong> ' + orders.md.replace(/\n/g, '<br>') + '<br>');
  }

  const fallbackText =
    '<strong>Резервный режим ИИ-советника (Локальный анализ):</strong><br><br>' +
    parts.join('\n') +
    '<br><em>Автоматический анализ на основе данных портфеля. Для расширенной аналитики с учётом новостного фона повторите генерацию.</em>';

  return fallbackText;
}
