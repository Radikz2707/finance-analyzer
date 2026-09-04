import { PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';

export interface UIOrdersData {
  md: string;
}

export class AiClient {
  constructor() {}

  public async generateDynamicReport(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
  ): Promise<string> {
    const buyAssets = analysis.assetsAnalysis
      .filter((a) => a.deficitRub > 0)
      .sort((a, b) => b.deficitRub - a.deficitRub);

    const sellAssets = analysis.assetsAnalysis.filter(
      (a) => a.status === 'REDUCE' || a.status === 'NEW' || a.deficitRub < 0,
    );

    const validationBlock = !validation.isValid
      ? '<strong>⚠️ Нарушение риск-менеджмента:</strong><br>' +
        validation.errors.join('<br>') +
        '<br><br>'
      : "<strong>✅ Риск-менеджмент:</strong> Все ручные коэффициенты в столбце S строго соответствуют глобальным лимитам с листа 'Цели'.<br><br>";

    const buyInstructions =
      buyAssets.length > 0
        ? buyAssets
            .map(
              (a, index) =>
                ' ' +
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
        : ' Портфель идеально сбалансирован, докупка активов не требуется.';

    const sellInstructions =
      sellAssets.length > 0
        ? '<strong>📍 Обнаружены избыточные или внесистемные позиции:</strong><br>' +
          sellAssets
            .map(
              (a) =>
                ' • Инструмент <strong>' +
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

    const ordersBlock = orders.md
      ? '<strong>📋 Текущие лимитные заявки в терминале QUIK:</strong><br>' +
        orders.md.replace(/\n/g, '<br>') +
        '<br><br>'
      : '<strong>📋 Активные заявки в QUIK:</strong> В стакане нет выставленных ордеров, весь кэш свободен.<br><br>';

    // 📊 ГЕНЕРАЦИЯ ДИНАМИЧЕСКОЙ HTML-ТАБЛИЦЫ ДЛЯ РАСШИФРОВКИ ДОХОДА:
    let stocksTableHtml = '';
    if (inc.stocks && inc.stocks.length > 0) {
      stocksTableHtml =
        "<table style='width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 15px; color: #c9d1d9; font-size: 13px; background-color: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden;'>" +
        "<thead style='background-color: #21262d; border-bottom: 2px solid #30363d;'>" +
        '<tr>' +
        "<th style='padding: 8px 12px; text-align: left;'>Актив</th>" +
        "<th style='padding: 8px 12px; text-align: center;'>Количество</th>" +
        "<th style='padding: 8px 12px; text-align: right;'>Ставка LTM</th>" +
        "<th style='padding: 8px 12px; text-align: right;'>Грязными</th>" +
        "<th style='padding: 8px 12px; text-align: right;'>Чистыми (-13%)</th>" +
        '</tr>' +
        '</thead>' +
        '<tbody>';

      inc.stocks.forEach((s) => {
        stocksTableHtml +=
          "<tr style='border-bottom: 1px solid #21262d;'>" +
          "<td style='padding: 8px 12px; text-align: left; font-weight: bold; color: #58a6ff;'>" +
          s.name +
          ' (' +
          s.ticker +
          ')</td>' +
          "<td style='padding: 8px 12px; text-align: center;'>" +
          s.quantity.toLocaleString('ru-RU') +
          ' шт.</td>' +
          "<td style='padding: 8px 12px; text-align: right;'>" +
          s.rate.toFixed(2) +
          ' ₽</td>' +
          "<td style='padding: 8px 12px; text-align: right;'>" +
          Math.round(s.grossIncome).toLocaleString('ru-RU') +
          ' ₽</td>' +
          "<td style='padding: 8px 12px; text-align: right; font-weight: bold; color: #56d364;'>+ " +
          Math.round(s.netIncome).toLocaleString('ru-RU') +
          ' ₽</td>' +
          '</tr>';
      });

      stocksTableHtml += '</tbody></table>';
    } else {
      stocksTableHtml =
        "<div style='color: #8b949e; font-style: italic; margin-bottom: 15px;'>Позиции по акциям в выгрузке QUIK отсутствуют.</div>";
    }

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
      'Ниже представлена детальная расшифровка возможного прогнозного пассивного дохода на основе LTM-выплат Мосбиржи по вашим текущим долевым позициям:<br>' +
      stocksTableHtml + // 🎯 ВСТАВЛЯЕМ НАШУ ТАБЛИЦУ ТАК СЮДА
      'Итоговый чистый поток составляет <strong>' +
      inc.totalDivsNet.toLocaleString('ru-RU') +
      ' ₽</strong> после автоматического удержания НДФЛ. ' +
      'Все целевые значения долей берутся автоматически из вашего ручного столбца S. Система контролирует верхние границы ограничений для защиты от переконцентрации.<br><br>' +
      '<strong>💵 4. Автоматический пошаговый план ребалансировки</strong><br>' +
      sellInstructions +
      '<strong>🎯 Первоочередные цели для направления ликвидности и кэша:</strong><br>' +
      buyInstructions
    );
  }
}
