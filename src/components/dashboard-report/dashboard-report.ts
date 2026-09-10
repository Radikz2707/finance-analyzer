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
      '.status-BUY { background-color: rgba(35, 134, 54, 0.15); color: #56d364; border: 1px solid #238636; }' +
      '.status-SELL { background-color: rgba(242, 81, 87, 0.15); color: #ff7b72; border: 1px solid #f25157; }' +
      '.status-NEW { background-color: rgba(163, 113, 247, 0.15); color: #d3b6ff; border: 1px solid #a371f7; }' +
      '.status-FILLED { background-color: rgba(35, 134, 54, 0.08); color: #4ac257; border: 1px solid rgba(35, 134, 54, 0.35); }' +
      '.order-row-status-FILLED { opacity: 0.45; background-color: rgba(0, 0, 0, 0.15); }' +
      '.order-row-status-FILLED:hover { opacity: 0.9; }' +
      '.orders-table, .portfolio-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }' +
      '.orders-table th, .orders-table td, .portfolio-table th, .portfolio-table td { padding: 10px; border-bottom: 1px solid #30363d; color: #c9d1d9; }' +
      '.orders-table th, .portfolio-table th { color: #8b949e; font-weight: normal; }' +
      '.instrument-name strong, .asset-name strong { color: #fff; }' +
      '.no-orders { color: #8b949e; text-align: center; }' +
      '.sum-cell { color: #e3b341; font-weight: bold; }' +
      '.deficit-cell { font-weight: bold; }' +
      '.price-info { display: flex; flex-direction: row; align-items: center; justify-content: flex-end; gap: 6px; font-size: 14px; font-weight: 600; line-height: 1.3; min-width: 110px; }' +
      '.price-info .price-pair { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }' +
      '.price-info .price-pair .price-entry { font-size: 12px; color: #8b949e; font-weight: 500; }' +
      '.price-info .price-pair .price-current { font-size: 14px; font-weight: 700; }' +
      '.price-info .price-arrow { font-size: 14px; line-height: 1; opacity: 0.9; }' +
      '.price-info.price-direction--up .price-entry { color: #8b949e; }' +
      '.price-info.price-direction--up .price-arrow { color: #56d364; }' +
      '.price-info.price-direction--up .price-current { color: #56d364; }' +
      '.price-info.price-direction--down .price-entry { color: #8b949e; }' +
      '.price-info.price-direction--down .price-arrow { color: #ff7b72; }' +
      '.price-info.price-direction--down .price-current { color: #ff7b72; }' +
      '.price-info.price-direction--same .price-entry, .price-info.price-direction--same .price-current, .price-info.price-direction--same .price-arrow { color: #e3b341; }' +
      '.price-diff { font-size: 11px; min-width: 70px; text-align: right; }' +
      '.portfolio-table th.price-info, .portfolio-table th.price-diff { text-align: right; }' +
      '.portfolio-table th.price-info { white-space: nowrap; padding-right: 16px; line-height: 1.3; font-size: 12px; }' +
      '.portfolio-table th.price-diff { text-align: right; padding-right: 16px; font-size: 14px; font-weight: 600; color: #8b949e; }' +
      '.portfolio-table td.price-info, .portfolio-table td.price-diff { text-align: right; }' +
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
      '.priority-section, .concentration-section, .rebalance-section { margin-bottom: 16px; }' +
      '.priority-section:last-child, .concentration-section:last-child, .rebalance-section:last-child { margin-bottom: 0; }' +
      '.section-title { margin: 0 0 10px 0; font-size: 13px; font-weight: 600; line-height: 1.4; }' +
      '.section-title--blue { color: #58a6ff; }' +
      '.section-title--red { color: #f25157; }' +
      '.section-title--green { color: #56d364; }' +
      '.priority-list { display: flex; flex-direction: column; gap: 6px; }' +
      '.priority-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(56, 139, 255, 0.08); border: 1px solid rgba(56, 139, 255, 0.15); border-radius: 6px; transition: background 0.2s ease; }' +
      '.priority-item:hover { background: rgba(56, 139, 255, 0.12); }' +
      '.priority-rank { min-width: 22px; font-size: 13px; font-weight: 700; color: #58a6ff; }' +
      '.priority-name { flex: 1; font-size: 13px; font-weight: 500; color: #fff; }' +
      '.priority-deficit { font-size: 13px; font-weight: 700; color: #58a6ff; white-space: nowrap; }' +
      '.concentration-list { display: flex; flex-direction: column; gap: 6px; }' +
      '.concentration-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: rgba(242, 81, 87, 0.08); border: 1px solid rgba(242, 81, 87, 0.15); border-radius: 6px; transition: background 0.2s ease; }' +
      '.concentration-item:hover { background: rgba(242, 81, 87, 0.12); }' +
      '.concentration-name { flex: 1; font-size: 13px; font-weight: 500; color: #fff; }' +
      '.concentration-value { font-size: 13px; font-weight: 700; color: #f25157; white-space: nowrap; }' +
      '.rebalance-content { padding: 12px; background: rgba(86, 211, 100, 0.06); border: 1px solid rgba(86, 211, 100, 0.2); border-radius: 8px; }' +
      '.rebalance-main { font-size: 13px; line-height: 1.5; color: #c9d1d9; margin-bottom: 10px; }' +
      '.rebalance-highlight { color: #58a6ff; font-weight: 600; }' +
      '.rebalance-main strong { color: #fff; font-weight: 600; }' +
      '.rebalance-summary { font-size: 13px; line-height: 1.5; color: #8b949e; padding-top: 10px; border-top: 1px solid rgba(139, 148, 158, 0.2); }' +
      '.rebalance-summary strong { color: #fff; font-weight: 600; }' +
      '.highlight-total { color: #56d364; font-weight: 700; }' +
      '.ai-box-styled { border-left: 4px solid #388bfd; white-space: pre-wrap; line-height: 1.6; font-size: 13px; }' +
      // === income-widget ===
      '.income-widget { background: linear-gradient(135deg, rgba(56, 211, 100, 0.06) 0%, rgba(35, 134, 54, 0.1) 100%); border: 1px solid rgba(56, 211, 100, 0.25); border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; color: #e6edf2; position: relative; overflow: hidden; }' +
      '.income-widget::before { content: \'\'; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, #38d364, transparent); opacity: 0.6; }' +
      '.income-widget .income-header { margin: 0 0 16px; font-size: 16px; font-weight: 700; color: #38d364; display: flex; align-items: center; gap: 10px; }' +
      '.income-widget .income-icon { font-size: 20px; line-height: 1; }' +
      '.income-widget .income-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 18px; }' +
      '.income-widget .metric-card { background: rgba(22, 27, 34, 0.6); border: 1px solid rgba(48, 54, 61, 0.6); border-radius: 8px; padding: 12px 14px; transition: border-color 0.2s ease; }' +
      '.income-widget .metric-card:hover { border-color: rgba(56, 211, 100, 0.3); }' +
      '.income-widget .metric-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 4px; font-weight: 500; }' +
      '.income-widget .metric-value { font-size: 18px; font-weight: 700; color: #fff; line-height: 1.3; }' +
      '.income-widget .metric-value--green { color: #56d364; }' +
      '.income-widget .metric-value--muted { color: #8b949e; font-size: 14px; font-weight: 500; }' +
      '.income-widget .income-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 16px; font-size: 13px; border: 1px solid rgba(48, 54, 61, 0.5); border-radius: 8px; overflow: hidden; }' +
      '.income-widget .income-table thead tr { background: rgba(22, 27, 34, 0.8); }' +
      '.income-widget .income-table th { padding: 10px 14px; font-weight: 500; color: #8b949e; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid rgba(48, 54, 61, 0.6); }' +
      '.income-widget .income-table tbody tr { transition: background 0.15s ease; }' +
      '.income-widget .income-table tbody tr:hover { background: rgba(56, 139, 255, 0.04); }' +
      '.income-widget .income-table tbody tr:last-child td { border-bottom: none; }' +
      '.income-widget .income-table td { padding: 10px 14px; color: #c9d1d9; border-bottom: 1px solid rgba(48, 54, 61, 0.3); vertical-align: middle; }' +
      '.income-widget .income-ticker { color: #58a6ff; font-weight: 600; font-size: 13px; }' +
      '.income-widget .income-net { color: #56d364; font-weight: 700; font-size: 14px; white-space: nowrap; }' +
      '.income-widget .income-gross { color: #8b949e; font-size: 12px; }' +
      '.income-widget .income-footer { margin-top: 16px; margin-bottom: 0; font-size: 12px; color: #8b949e; padding-top: 12px; border-top: 1px solid rgba(48, 54, 61, 0.4); display: flex; align-items: center; gap: 6px; }' +
      '.income-widget .income-total { color: #56d364; font-weight: 700; font-size: 14px; }' +
      '.income-widget .income-tax-note { color: #6e7681; font-size: 11px; }' +
      '.income-widget .income-empty { margin-top: 8px; font-size: 13px; color: #6e7681; text-align: center; padding: 24px 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }' +
      '.income-widget .income-empty-icon { font-size: 32px; opacity: 0.4; line-height: 1; }' +
      '.income-widget .income-empty-text { font-size: 13px; font-weight: 500; color: #8b949e; }' +
      '.income-widget .income-empty-hint { font-size: 11px; color: #6e7681; }' +
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
      '<thead><tr><th>Инструмент</th><th>Текущая доля</th><th>Целевая доля</th><th>Дефицит/Профицит</th><th>Статус</th><th class="price-info">Цена входа /<br>Текущая</th><th class="price-diff">Δ</th></tr></thead>' +
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
