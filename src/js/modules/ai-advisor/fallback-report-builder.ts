import { PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { UIOrdersData } from './types.js';
import { CalculatedIncome } from './income-calculator.js';

/**
 * Усиленный генератор локального отчёта при недоступности API.
 * Включает макроанализ, детальные рекомендации по ребалансировке,
 * оценку рисков и пошаговый план действий.
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

  // ============================================================
  // СЕКЦИЯ 1: Макроэкономическая оценка
  // ============================================================
  parts.push('<strong>1. МАКРОЭКОНОМИЧЕСКАЯ ОЦЕНКА</strong>');
  parts.push('');

  // Оценка структуры портфеля при текущей ставке ЦБ
  const macroAssessment = (() => {
    if (cbrRate >= 18) {
      return `При высокой ключевой ставке ${cbrRate}% облигационный сектор остаётся привлекательным благодаря доходностям к погашению 18-22%. Акции переоценены с точки зрения риска — премиум за волатильность высок. Рекомендуется сохранять долю облигаций не менее 50-60% портфеля.`;
    } else if (cbrRate >= 12) {
      return `При умеренно высокой ставке ${cbrRate}% баланс между акциями и облигациями должен определяться горизонтом инвестирования. Горизонт 3+ года — можно увеличивать долю акций до 40-50%. Гороризонт менее 2 лет — приоритет облигациям.`;
    } else {
      return `При низкой ставке ${cbrRate}% акции становятся более привлекательными. Рекомендуется увеличивать долю акций до 60-70% портфеля, особенно в секорах роста и качества.`;
    }
  })();
  parts.push(macroAssessment);
  parts.push('');

  // Текущая структура vs целевая
  parts.push(`<strong>Текущая структура:</strong> Акции ${macro.stocksPercent}%, Облигации ${macro.bondsPercent}%`);
  parts.push(`<strong>Общая стоимость портфеля:</strong> ${macro.totalBalance.toLocaleString('ru-RU')} ₽`);
  parts.push(`<strong>Свободный кэш:</strong> ${macro.freeCash.toLocaleString('ru-RU')} ₽`);
  parts.push('');

  // ============================================================
  // СЕКЦИЯ 2: Ребалансировка — активы на покупку
  // ============================================================
  const buyAssets = assetsAnalysis.filter((a) => a.status === 'BUY' && a.targetPercent > 0);
  if (buyAssets.length > 0) {
    parts.push('<strong>2. РЕКОМЕНДАЦИИ ПО ПОКУПКЕ</strong>');
    parts.push('');
    buyAssets.forEach((a) => {
      const gap = a.targetPercent - a.currentPercent;
      const gapAbs = Math.abs(gap).toFixed(1);
      parts.push(
        `• <strong>${a.name} (${a.ticker}):</strong> ` +
        `дефицит ${gapAbs}% (цель ${a.targetPercent.toFixed(1)}%, факт ${a.currentPercent.toFixed(1)}%)<br>` +
        `→ необходимо докупить на <strong>${a.deficitRub.toLocaleString('ru-RU')} ₽</strong>`
      );
      if (a.dynamicsPercent < -10) {
        parts.push(`  ⚡ Актив упал на ${a.dynamicsPercent.toFixed(1)}% — возможность купить дешевле. Дробить покупку на 2-3 транша.`);
      } else if (a.dynamicsPercent > 10) {
        parts.push(`  Актив вырос на ${a.dynamicsPercent.toFixed(1)}% — возможно, стоит купить частями, чтобы усреднить цену.`);
      }
      parts.push('');
    });
  }

  // ============================================================
  // СЕКЦИЯ 3: Ребалансировка — активы на снижение
  // ============================================================
  const reduceAssets = assetsAnalysis.filter((a) => a.status === 'REDUCE');
  if (reduceAssets.length > 0) {
    parts.push('<strong>3. РЕКОМЕНДАЦИИ ПО СНИЖЕНИЮ ПОЗИЦИЙ</strong>');
    parts.push('');
    reduceAssets.forEach((a) => {
      const excess = a.currentPercent - a.targetPercent;
      const excessAbs = Math.abs(excess).toFixed(1);
      parts.push(
        `• <strong>${a.name} (${a.ticker}):</strong> ` +
        `профицит ${excessAbs}% (цель ${a.targetPercent.toFixed(1)}%, факт ${a.currentPercent.toFixed(1)}%)<br>` +
        `→ рекомендуется сократить на <strong>${Math.abs(a.deficitRub).toLocaleString('ru-RU')} ₽</strong>`
      );
      if (a.dynamicsPercent > 15) {
        parts.push(`  💰 Актив вырос на ${a.dynamicsPercent.toFixed(1)}% — фиксируем прибыль. Часть позиций можно продать сейчас.`);
      }
      parts.push('');
    });
  }

  // ============================================================
  // СЕКЦИЯ 4: Активы на выход
  // ============================================================
  const exitAssets = assetsAnalysis.filter((a) => a.targetPercent === 0 && a.currentPercent > 0);
  if (exitAssets.length > 0) {
    parts.push('<strong>4. ПЛАНОВЫЙ ВЫХОД ИЗ ПОЗИЦИЙ</strong>');
    parts.push('');
    exitAssets.forEach((a) => {
      const ordersCount = orders.md
        ? (a.ticker ? (orders.md.match(new RegExp(a.ticker, 'g')) || []).length || 0 : 0)
        : 0;
      const orderNote = ordersCount > 0
        ? ' Обнаружены активные заявки на продажу в QUIK.'
        : ' Активных заявок не обнаружено — рекомендуется выставить заявки на продажу.';
      parts.push(
        `• <strong>${a.name} (${a.ticker}):</strong> целевая доля занулена. Текущая доля ${a.currentPercent.toFixed(1)}%.${orderNote}`
      );
      parts.push('');
    });
  }

  // ============================================================
  // СЕКЦИЯ 5: Новые активы
  // ============================================================
  const newAssets = assetsAnalysis.filter((a) => a.status === 'NEW');
  if (newAssets.length > 0) {
    parts.push('<strong>5. НОВЫЕ АКТИВЫ</strong>');
    parts.push('');
    newAssets.forEach((a) => {
      const autoMatch = newAssetsForAi
        ? newAssetsForAi.match(new RegExp(a.ticker + '.*?рекомендуется (\\d+)%', 's'))
        : null;
      const target = autoMatch ? autoMatch[1] : '—';
      parts.push(
        '<li>' +
        '<strong>' + a.name + ' (' + a.ticker + '):</strong> новый актив. Автоматическая рекомендация целевой доли: <strong>' + target + '%</strong>. ' +
        'Рекомендуется начать с минимальной позиции (1-2% портфеля) и постепенно увеличивать при подтверждении тезисов.' +
        '</li>',
      );
      parts.push('');
    });
  }

  // ============================================================
  // СЕКЦИЯ 6: Оценка рисков
  // ============================================================
  if (!validation.isValid) {
    parts.push('<strong>6. ОБНАРУЖЕННЫЕ РИСКИ</strong>');
    parts.push('');
    validation.errors.forEach((e) => {
      parts.push(`⚠️ ${e}`);
    });
    parts.push('');
  }

  // ============================================================
  // СЕКЦИЯ 7: Дивидендная стратегия
  // ============================================================
  if (inc.totalNkd > 0 || inc.totalDivsNet > 0) {
    parts.push('<strong>7. ДИВИДЕНДНАЯ СТРАТЕГИЯ</strong>');
    parts.push('');
    parts.push(
      `• Ожидаемый чистый дивидендный поток (LTM): <strong>${inc.totalDivsNet.toLocaleString('ru-RU')} ₽</strong>`
    );
    if (inc.totalNkd > 0) {
      parts.push(
        `• НКД по облигациям (накопленный купонный доход): <strong>${inc.totalNkd.toLocaleString('ru-RU')} ₽</strong>`
      );
    }

    // Рекомендации по дивидендам
    const divYield = macro.totalBalance > 0
      ? ((inc.totalDivsNet / macro.totalBalance) * 100).toFixed(1)
      : '0';
    parts.push(`• Дивидендная доходность портфеля: ~${divYield}% годовых`);

    if (parseFloat(divYield) < 5) {
      parts.push('  💡 Дивидендная доходность ниже 5% — рассмотрите добавление дивидендных акций (Сбербанк, Лукойл, Татнефть) или высокодоходных облигаций.');
    } else if (parseFloat(divYield) > 10) {
      parts.push('  💰 Высокая дивидендная доходность — хороший результат. Реинвестируйте дивиденды для сложного процента.');
    }
    parts.push('');
  }

  // ============================================================
  // СЕКЦИЯ 8: Пошаговый план действий
  // ============================================================
  parts.push('<strong>8. ПОШАГОВЫЙ ПЛАН ДЕЙСТВИЙ</strong>');
  parts.push('');

  let stepNum = 1;

  // Шаг 1: Ребалансировка
  if (buyAssets.length > 0 || reduceAssets.length > 0) {
    parts.push(`${stepNum}. <strong>Провести ребалансировку:</strong>`);
    if (buyAssets.length > 0) {
      parts.push(`   • Докупить ${buyAssets.length} актив(ов) на общую сумму ~${buyAssets.reduce((sum, a) => sum + a.deficitRub, 0).toLocaleString('ru-RU')} ₽`);
    }
    if (reduceAssets.length > 0) {
      parts.push(`   • Сократить ${reduceAssets.length} актив(ов) на общую сумму ~${reduceAssets.reduce((sum, a) => sum + Math.abs(a.deficitRub), 0).toLocaleString('ru-RU')} ₽`);
    }
    parts.push('');
    stepNum++;
  }

  // Шаг 2: Выход из позиций
  if (exitAssets.length > 0) {
    parts.push(`${stepNum}. <strong>Завершить выход из позиций:</strong>`);
    exitAssets.forEach((a) => {
      parts.push(`   • ${a.name} (${a.ticker}) — продать позицию`);
    });
    parts.push('');
    stepNum++;
  }

  // Шаг 3: Управление кэшем
  const totalDeficit = macro.stocksDeficitRub + macro.bondsDeficitRub;
  if (totalDeficit > 0) {
    parts.push(stepNum + '. <strong>Управление свободными средствами:</strong>');
    parts.push('   • Свободно: ' + macro.freeCash.toLocaleString('ru-RU') + ' ₽');
    parts.push('   • Требуется для ребалансировки: ' + totalDeficit.toLocaleString('ru-RU') + ' ₽');
    if (macro.freeCash >= totalDeficit) {
      parts.push('   ✅ Свободных средств достаточно для полной ребалансировки.');
    } else {
      const shortfall = totalDeficit - macro.freeCash;
      parts.push('   ⚠️ Дефицит средств: ' + shortfall.toLocaleString('ru-RU') + ' ₽. Необходимо найти средства или пересмотреть целевые доли.');
    }
    parts.push('');
    stepNum++;
  }

  // Шаг 4: Мониторинг
  parts.push(stepNum + '. <strong>Установить мониторинг:</strong>');
  parts.push('   • Отслеживать ключевую ставку ЦБ — при снижении увеличивать долю акций');
  parts.push('   • Контролировать дивидендные календари для максимизации дохода');
  parts.push('   • Пересматривать целевые доли ежеквартально или при существенных изменениях рынка');
  parts.push('');
  stepNum++;

  // Шаг 5: Заявки
  if (orders.md) {
    parts.push(`${stepNum}. <strong>Активные заявки в QUIK:</strong>`);
    parts.push(orders.md.replace(/\n/g, '<br>   '));
    parts.push('');
  }

  // ============================================================
  // СЕКЦИЯ 9: Краткое резюме
  // ============================================================
  parts.push('<strong>9. КРАТКОЕ РЕЗЮМЕ</strong>');
  parts.push('');

  const totalActions = buyAssets.length + reduceAssets.length + exitAssets.length;
  if (totalActions > 0) {
    parts.push(
      `Необходимо выполнить <strong>${totalActions} действие(ий)</strong> по ребалансировке портфеля. ` +
      `Основной фокус: ${buyAssets.length > 0 ? 'докупка недостающих активов' : ''} ${buyAssets.length > 0 && reduceAssets.length > 0 ? 'и ' : ''}${reduceAssets.length > 0 ? 'сокращение избыточных позиций' : ''}.`
    );
  } else {
    parts.push('Портфель полностью сбалансирован. Действий не требуется.');
  }

  parts.push('');
  parts.push(
    `При макро-контексте ключевой ставки <strong>${cbrRate}%</strong> ` +
    `рекомендуется ${cbrRate >= 18 ? 'сохранять консервативную стратегию с преобладанием облигаций' : 'постепенно увеличивать долю акций при горизонте инвестирования 3+ года'}.`
  );

  // ============================================================
  // Формирование итогового текста
  // ============================================================
  const fallbackText =
    '<strong>🤖 ИИ-советник (Локальный анализ)</strong><br><br>' +
    `Дата анализа: ${new Date().toLocaleDateString('ru-RU')}<br><br>` +
    parts.join('<br><br>') +
    '<br><br><em>⚠️ Это автоматический анализ на основе данных портфеля и макроэкономических правил. ' +
    'Для расширенной аналитики с учётом новостного фона и фундаментального анализа — настройте подключение GigaChat API.</em>';

  return fallbackText;
}
