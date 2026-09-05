export function getMarkdownTemplate(
  date: string,
  totalVal: string,
  freeCash: string,
  stocks: number,
  bonds: number,
  assetsList: string,
): string {
  return (
    '# 📊 ОТЧЕТ ПО РЕБАЛАНСИРОВКЕ ПОРТФЕЛЯ\n\n' +
    '**Дата анализа:** ' +
    date +
    '\n' +
    '**Рыночная стоимость ценных бумаг:** ' +
    totalVal +
    ' руб.\n' +
    '**Свободные средства:** ' +
    freeCash +
    ' руб.\n\n' +
    '## 📈 Текущий сплит классов активов\n' +
    '* Акции: ' +
    stocks +
    '%\n' +
    '* Облигации: ' +
    bonds +
    '%\n\n' +
    '## 🔍 Анализ защитных лимитов и дефицитов по инструментам:\n' +
    assetsList
  );
}

export function getHtmlTemplate(
  totalVal: string,
  freeCash: string,
  stocksPct: number,
  bondsPct: number,
  cbrRate: number,
  barRows: string,
  aiBoxHtml: string,
  tableRows: string,
  ordersRows: string,
  dateStr: string,
  timeStr: string,
  totalInvested: string,
  resultC10: string,
  profitC11: string,
  c10Color: string,
  c11Color: string,
  priorityBlock: string,
  concentrationBlock: string,
  rebalanceBlock: string,
): string {
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
    "<div class='block-box' style='border-left: 4px solid #388bfd; white-space: pre-wrap; line-height: 1.6; font-size: 13px;'>" +
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
