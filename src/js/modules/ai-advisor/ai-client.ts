import { PortfolioReportData } from '../portfolio-math/portfolio-math';
import { ValidationResult } from '../portfolio-math/portfolio-validator';

export interface IncomeData {
  totalNkd: number;
  sberQty: number;
  sberDivsNet: number;
  tatneftQty: number;
  tatneftDivsNet: number;
  totalDivsNet: number;
}

export interface UIOrdersData {
  md: string;
}

export class AiClient {
  constructor() {}

  public async generateDynamicReport(
    analysis: PortfolioReportData,
    inc: IncomeData,
    validation: ValidationResult,
    orders: UIOrdersData,
  ): Promise<string> {
    // 1. АВТОМАТИЧЕСКИЙ АНАЛИЗ ДЕФИЦИТОВ (Фильтруем по чистому рублевому недобору)
    const buyAssets = analysis.assetsAnalysis
      .filter((a) => a.deficitRub > 0)
      .sort((a, b) => b.deficitRub - a.deficitRub);

    // 2. АВТОМАТИЧЕСКИЙ АНАЛИЗ ИЗБЫТКОВ ИЛИ НОВЫХ ПОЗИЦИЙ (ts(2367) УСТРАНЕНА: используем 'REDUCE' вместо 'SELL')
    const sellAssets = analysis.assetsAnalysis.filter(
      (a) => a.status === 'REDUCE' || a.status === 'NEW' || a.deficitRub < 0,
    );

    // 3. АВТОМАТИЧЕСКАЯ ИНТЕРПРЕТАЦИЯ ВАЛИДАЦИИ С ЛИСТА "ЦЕЛИ"
    const validationBlock = !validation.isValid
      ? '<strong>⚠️ Нарушение риск-менеджмента:</strong><br>' +
        validation.errors.join('<br>') +
        '<br><br>'
      : "<strong>✅ Риск-менеджмент:</strong> Все ручные коэффициенты в столбце S строго соответствуют глобальным лимитам с листа 'Цели'.<br><br>";

    // 4. ДИНАМИЧЕСКОЕ ФОРМИРОВАНИЕ ПЛАНА ПОКУПОК
    const buyInstructions =
      buyAssets.length > 0
        ? buyAssets
            .map(
              (a, index) =>
                '   ' +
                (index + 1) +
                '. Докупить <strong>' +
                a.name +
                '</strong> на сумму <strong>' +
                Math.round(a.deficitRub).toLocaleString('ru-RU') +
                ' ₽</strong> (текущая доля: ' +
                a.currentPercent.toFixed(1) +
                '%, цель из столбца S: ' +
                a.targetPercent.toFixed(1) +
                '%).',
            )
            .join('<br>')
        : '   Портфель идеально сбалансирован, докупка активов не требуется.';

    // 5. ДИНАМИЧЕСКОЕ ФОРМИРОВАНИЕ ПЛАНА ЛИКВИДАЦИИ / ОПТИМИЗАЦИИ
    const sellInstructions =
      sellAssets.length > 0
        ? '<strong>📍 Обнаружены избыточные или внесистемные позиции:</strong><br>' +
          sellAssets
            .map(
              (a) =>
                '   • Инструмент <strong>' +
                a.name +
                '</strong> занимает ' +
                a.currentPercent.toFixed(1) +
                '% портфеля при целевой доле ' +
                a.targetPercent.toFixed(1) +
                '%.',
            )
            .join('<br>') +
          '<br><br>'
        : '';

    // 6. УЧЕТ АКТИВНЫХ ОРДЕРОВ В СТАКАНЕ
    const ordersBlock = orders.md
      ? '<strong>🗓️ Текущие лимитные заявки в терминале QUIK:</strong><br>' +
        orders.md.replace(/\n/g, '<br>') +
        '<br><br>'
      : '<strong>🗓️ Активные заявки в QUIK:</strong> В стакане нет выставленных ордеров, весь кэш свободен.<br><br>';

    // 7. СБОРКА ИТОГОВОГО ОТЧЕТА (ts(2339) УСТРАНЕНЫ: заменены на stocksPercent и bondsPercent)
    return (
      validationBlock +
      ordersBlock +
      '<strong>🌐 1. Управление макроструктурой портфеля</strong><br>' +
      'В соответствии со стратегией макро-сплита, ваш капитал разделен на Акции (' +
      analysis.macro.stocksPercent +
      '%) Ext и Облигации (' +
      analysis.macro.bondsPercent +
      '%). ' +
      'Фактическое распределение на текущую секунду: Акции составляют <strong>' +
      analysis.macro.stocksPercent.toFixed(1) +
      '%</strong>, Облигации — <strong>' +
      analysis.macro.bondsPercent.toFixed(1) +
      '%</strong>. ' +
      'Свободный нераспределенный кэш в терминале QUIK равен <strong>' +
      analysis.macro.freeCash.toLocaleString('ru-RU') +
      ' ₽</strong>.<br><br>' +
      '<strong>📊 2. Аналитика купонного потенциала долгового рынка</strong><br>' +
      'Суммарный накопленный купонный доход (НКД), начисленный по всем долговым бумагам на вашем счете, составляет <strong>' +
      inc.totalNkd.toLocaleString('ru-RU') +
      ' ₽</strong>. ' +
      'Этот поток формирует внутреннюю автономную ликвидность портфеля, позволяя гасить дефициты за счет регулярных выплат эмитентов без привлечения личных средств.<br><br>' +
      '<strong>📈 3. Дивидендный поток и контроль лимитов</strong><br>' +
      'Общий чистый ожидаемый пассивный доход по ключевым долевым позициям (Сбербанк: ' +
      inc.sberQty +
      ' шт., Татнефть: ' +
      inc.tatneftQty +
      ' шт.) составляет <strong>' +
      inc.totalDivsNet.toLocaleString('ru-RU') +
      ' ₽</strong> после вычета НДФЛ. ' +
      'Все целевые значения долей берутся автоматически из вашего ручного столбца S. Система контролирует верхние границы ограничений для защиты от переконцентрации.<br><br>' +
      '<strong>💵 4. Автоматический пошаговый план ребалансировки</strong><br>' +
      sellInstructions +
      '<strong>🎯 Первоочередные цели для направления ликвидности и кэша:</strong><br>' +
      buyInstructions
    );
  }
}
