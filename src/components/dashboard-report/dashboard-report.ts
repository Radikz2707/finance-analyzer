import { QuikOrder } from '../../js/modules/xlsx-parser/quik-orders-parser';
import { AssetAnalysis } from '../../js/modules/portfolio-math/portfolio-math.js';
import { buildOrdersHtmlAndMd, buildAssetsTablesAndBars } from '../../js/modules/ai-advisor/report-builders.js';

export interface DashboardReportData {
  totalVal: string;
  freeCash: string;
  stocksPct: number;
  bondsPct: number;
  cbrRate: number;
  totalInvested: string;
  resultC10: string;
  profitC11: string;
  c10Color: string;
  c11Color: string;
  dateStr: string;
  timeStr: string;
  aiBoxHtml: string;
  barRows: string;
  tableRows: string;
  ordersRows: string;
  priorityBlock: string;
  concentrationBlock: string;
  rebalanceBlock: string;
}

export class DashboardReportBuilder {
  private data: DashboardReportData;

  constructor(data: DashboardReportData) {
    this.data = data;
  }

  buildHtml(): string {
    const {
      totalVal,
      freeCash,
      stocksPct,
      bondsPct,
      cbrRate,
      barRows,
      aiBoxHtml,
      tableRows,
      ordersRows,
      dateStr,
      timeStr,
      totalInvested,
      resultC10,
      profitC11,
      c10Color,
      c11Color,
      priorityBlock,
      concentrationBlock,
      rebalanceBlock,
    } = this.data;

    return (
      '<!DOCTYPE html>' +
      "<html lang='ru'>" +
      '<head>' +
      "<meta charset='UTF-8'>" +
      '<title>Инвестиционный ИИ-Советник</title>' +
      '<style>' +
      'body { background-color: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; padding: 20px; }' +
      '.container { max-width: 1200px; margin: 0 auto; }' +
      '.header-panel { display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin-bottom: 25px; }' +
      '.card { background-color: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; text-align: center; }' +
      '.card-title { font-size: 12px; color: #8b949e; text-transform: uppercase; font-weight: bold; margin-bottom: 5px; }' +
      '.card-value { font-size: 20px; font-weight: bold; color: #fff; }' +
      '.card-sub { font-size: 11px; color: #8b949e; margin-top: 4px; }' +
      '.grid-main { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 25px; }' +
      '.block-box { background-color: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 20px; margin-bottom: 20px; }' +
      'h2 { font-size: 16px; margin-top: 0; margin-bottom: 15px; border-bottom: 1px solid #30363d; padding-bottom: 8px; color: #fff; }' +
      'table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }' +
      'th, td { padding: 10px; border-bottom: 1px solid #30363d; }' +
      'th { color: #8b949e; font-weight: normal; }' +
      '.status-badge { padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; }' +
      '.status-OK { background-color: rgba(35, 134, 54, 0.15); color: #56d364; border: 1px solid #238636; }' +
      '.status-BUY { background-color: rgba(56, 139, 253, 0.15); color: #58a6ff; border: 1px solid #388bfd; }' +
      '.status-SELL { background-color: rgba(242, 81, 87, 0.15); color: #ff7b72; border: 1px solid #f25157; }' +
      '.status-NEW { background-color: rgba(163, 113, 247, 0.15); color: #d3b6ff; border: 1px solid #a371f7; }' +
      '.orders-table, .portfolio-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }' +
      '.orders-table th, .orders-table td, .portfolio-table th, .portfolio-table td { padding: 10px; border-bottom: 1px solid #30363d; color: #c9d1d9; }' +
      '.orders-table th, .portfolio-table th { color: #8b949e; font-weight: normal; }' +
      '.instrument-name strong, .asset-name strong { color: #fff; }' +
      '.no-orders { color: #8b949e; text-align: center; }' +
      '.sum-cell { color: #e3b341; font-weight: bold; }' +
      '.deficit-cell { font-weight: bold; }' +
      '.price-info, .price-diff { font-size: 11px; color: #8b949e; }' +
      '.asset-bars { margin-bottom: 15px; }' +
      '.asset-label { font-size: 13px; margin-bottom: 4px; color: #8b949e; font-weight: bold; }' +
      '.bar-row { display: flex; align-items: center; gap: 10px; }' +
      '.bar-label { width: 75px; font-size: 11px; text-align: right; color: #388bfd; }' +
      '.bar-label--target { color: #238636; }' +
      '.bar-track { flex-grow: 1; background: #30363d; height: 12px; border-radius: 4px; overflow: hidden; }' +
      '.bar-track--small { height: 6px; border-radius: 2px; }' +
      '.bar-fill { height: 100%; }' +
      '.bar-fill--blue { background: #388bfd; }' +
      '.bar-fill--green { background: #238636; }' +
      '.asset-legend { margin-bottom: 12px; background: #161b22; padding: 12px; border-radius: 6px; border-left: 4px solid; }' +
      '.legend-header { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }' +
      '.legend-name { font-weight: bold; color: #fff; }' +
      '.legend-percent { color: #58a6ff; font-weight: bold; }' +
      '.legend-bar { background: #30363d; height: 4px; border-radius: 2px; overflow: hidden; }' +
      '.legend-bar-fill { height: 100%; }' +
      '.priority-list h3, .risk-concentration h3, .rebalance-advice h3 { margin-top: 0; font-size: 13px; margin-bottom: 10px; }' +
      '.priority-list h3 { color: #58a6ff; }' +
      '.risk-concentration h3 { color: #f25157; }' +
      '.rebalance-advice h3 { color: #56d364; }' +
      '.priority-items, .risk-items { display: flex; flex-direction: column; gap: 6px; }' +
      '.priority-item, .risk-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 4px; }' +
      '.priority-item { background: rgba(56, 139, 255, 0.08); }' +
      '.risk-item { background: rgba(242, 81, 87, 0.08); }' +
      '.priority-rank { font-size: 12px; font-weight: bold; color: #58a6ff; min-width: 20px; }' +
      '.priority-name { font-size: 12px; color: #fff; flex-grow: 1; }' +
      '.priority-deficit { font-size: 12px; color: #58a6ff; font-weight: bold; }' +
      '.risk-icon { font-size: 12px; color: #ff7b72; }' +
      '.risk-name { font-size: 12px; color: #fff; flex-grow: 1; }' +
      '.risk-percent { font-size: 12px; color: #ff7b72; font-weight: bold; }' +
      '.advice-text { font-size: 12px; color: #8b949e; line-height: 1.5; }' +
      '.advice-text strong { color: #fff; }' +
      '.highlight-blue { color: #58a6ff; }' +
      '.ai-box-styled { border-left: 4px solid #388bfd; white-space: pre-wrap; line-height: 1.6; font-size: 13px; }' +
      '</style>' +
      '</head>' +
      '<body>' +
      "<div class='container'>" +
      '<!-- 📊 ИСТОРИЧЕСКИЕ КАРТОЧКИ ЭФФЕКТИВНОСТИ -->' +
      "<div class='header-panel'>" +
      "<div class='card'>" +
      "<div class='card-title'>Текущие активы (C9)</div>" +
      "<div class='card-value' style='color: #e3b341;'>" +
      totalVal +
      ' ₽</div>' +
      "<div class='card-sub'>Свободный кэш: " +
      freeCash +
      ' ₽</div>' +
      '</div>' +
      "<div class='card'>" +
      "<div class='card-title'>Лично внесено (C12)</div>" +
      "<div class='card-value'>" +
      totalInvested +
      ' ₽</div>' +
      "<div class='card-sub'>Собственный капитал</div>" +
      '</div>' +
      "<div class='card'>" +
      "<div class='card-title'>Результат рынка (C10)</div>" +
      "<div class='card-value' style='color: " +
      c10Color +
      ";'>" +
      resultC10 +
      ' ₽</div>' +
      "<div class='card-sub'>Спекуляции + портфель</div>" +
      '</div>' +
      "<div class='card'>" +
      "<div class='card-title'>Чистый итог (C11)</div>" +
      "<div class='card-value' style='color: " +
      c11Color +
      ";'>" +
      profitC11 +
      ' ₽</div>' +
      "<div class='card-sub'>Реальный инвест-профит</div>" +
      '</div>' +
      "<div class='card' style='border-color: #a371f7;'>" +
      "<div class='card-title'>Ключевая ставка ЦБ</div>" +
      "<div class='card-value' style='color: #d3b6ff;'>" +
      cbrRate +
      '%</div>' +
      "<div class='card-sub'>Макро-контекст портфеля</div>" +
      '</div>' +
      '</div>' +
      "<div class='grid-main'>" +
      '<div>' +
      "<div class='block-box ai-box-styled'>" +
      aiBoxHtml +
      '</div>' +
      "<div class='block-box'>" +
      '<h2>Портфель: состав и приоритеты</h2>' +
      '<table>' +
      '<thead><tr><th>Инструмент</th><th>Текущая доля</th><th>Целевая доля</th><th>Дефицит/Профицит</th><th>Статус</th><th>Цена входа / Текущая</th><th>Изменение</th></tr></thead>' +
      '<tbody>' +
      tableRows +
      '</tbody>' +
      '</table>' +
      '</div>' +
      '</div>' +
      '<div>' +
      "<div class='block-box'>" +
      '<h2>Макро-структура</h2>' +
      "<div style='font-size: 13px; color: #8b949e; margin-bottom: 15px;'>Акции: <strong>" +
      stocksPct +
      '%</strong> | Облигации: <strong>' +
      bondsPct +
      '%</strong></div>' +
      barRows +
      '</div>' +
      "<div class='block-box'>" +
      priorityBlock +
      concentrationBlock +
      rebalanceBlock +
      '</div>' +
      '</div>' +
      '</div>' +
      "<div class='block-box'>" +
      '<h2>Действующие лимитные заявки в терминале QUIK</h2>' +
      '<table>' +
      '<thead><tr><th>Инструмент</th><th>Операция</th><th>Количество</th><th>Цена за ед.</th><th>Общая сумма</th><th>Статус заявки</th></tr></thead>' +
      '<tbody>' +
      ordersRows +
      '</tbody>' +
      '</table>' +
      '</div>' +
      "<div style='text-align: center; font-size: 11px; color: #8b949e; margin-top: 20px;'>" +
      'Конвейер успешно обновлен: ' +
      dateStr +
      ' в ' +
      timeStr +
      ' | finance-analyzer v2.1.0' +
      '</div>' +
      '</div>' +
      '</body>' +
      '</html>'
    );
  }

  static fromOrdersAndAssets(
    orders: QuikOrder[],
    assetsAnalysis: AssetAnalysis[],
  ): DashboardReportBuilder {
    const ordersResult = buildOrdersHtmlAndMd(orders);
    const uiTables = buildAssetsTablesAndBars(assetsAnalysis);

    return new DashboardReportBuilder({
      totalVal: '',
      freeCash: '',
      stocksPct: 0,
      bondsPct: 0,
      cbrRate: 0,
      totalInvested: '',
      resultC10: '',
      profitC11: '',
      c10Color: '',
      c11Color: '',
      dateStr: '',
      timeStr: '',
      aiBoxHtml: '',
      barRows: uiTables.barRows,
      tableRows: uiTables.tableRows,
      ordersRows: ordersResult.html,
      priorityBlock: uiTables.priorityBlock,
      concentrationBlock: uiTables.concentrationBlock,
      rebalanceBlock: uiTables.rebalanceBlock,
    });
  }
}
