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
  stocks: number,
  bonds: number,
  legend: string,
  bars: string,
  aiBox: string,
  table: string,
  orders: string,
  date: string,
  time: string,
): string {
  return (
    '<!DOCTYPE html>\n' +
    "<html lang='ru'>\n" +
    '<head>\n' +
    "  <meta charset='UTF-8'>\n" +
    '  <title>Инвестиционный Дашборд Радика</title>\n' +
    '  <style>\n' +
    "    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }\n" +
    '    .container { max-width: 1200px; margin: 0 auto; }\n' +
    '    h1 { color: #fff; border-bottom: 1px solid #21262d; padding-bottom: 10px; font-size: 24px; }\n' +
    '    h2 { color: #fff; font-size: 18px; margin-top: 30px; }\n' +
    '    .update-time { font-size: 13px; color: #8b949e; margin-bottom: 20px; }\n' +
    '    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; }\n' +
    '    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; }\n' +
    '    .card .value { font-size: 22px; font-weight: bold; color: #58a6ff; margin-top: 5px; }\n' +
    '    .visual-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }\n' +
    '    .chart-container { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 20px; }\n' +
    '    .chart-title { font-size: 14px; font-weight: bold; color: #fff; margin-bottom: 15px; }\n' +
    '    .ai-box { background: #0f141c; border: 1px solid #388bfd; border-radius: 6px; padding: 20px; margin-bottom: 25px; }\n' +
    '    .ai-header { font-size: 16px; font-weight: bold; color: #58a6ff; margin-bottom: 15px; display: flex; align-items: center; gap: 8px; }\n' +
    '    .ai-section { margin-bottom: 15px; }\n' +
    '    .ai-section:last-child { margin-bottom: 0; }\n' +
    '    .ai-section .ai-header { font-size: 14px; color: #fff; margin-bottom: 5px; }\n' +
    '    .ai-list { margin: 5px 0; padding-left: 20px; }\n' +
    '    .ai-list li { margin-bottom: 5px; }\n' +
    '    table { width: 100%; border-collapse: collapse; margin-top: 10px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }\n' +
    '    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #30363d; font-size: 13px; }\n' +
    '    th { background: #21262d; color: #fff; font-weight: bold; }\n' +
    '    .status-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }\n' +
    '    .status-BUY { background: rgba(35, 134, 54, 0.2); color: #56d364; border: 1px solid #238636; }\n' +
    '    .status-HOLD { background: rgba(158, 106, 3, 0.2); color: #e3b341; border: 1px solid #9e6a03; }\n' +
    '    .status-STABLE { background: rgba(110, 118, 129, 0.2); color: #8b949e; border: 1px solid #6e7681; }\n' +
    '    .status-REDUCE { background: rgba(218, 54, 51, 0.2); color: #ff7b72; border: 1px solid #da3633; }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body>\n' +
    "<div class='container'>\n" +
    '  <h1>📊 Инвестиционный Дашборд Радика Нурисламовича</h1>\n' +
    "  <div class='update-time'>Дата обновления данных: " +
    date +
    ' в ' +
    time +
    '</div>\n' +
    '  \n' +
    "  <div class='summary-grid'>\n" +
    "    <div class='card'>\n" +
    '      <div>Общий баланс портфеля</div>\n' +
    "      <div class='value'>" +
    totalVal +
    ' ₽</div>\n' +
    '    </div>\n' +
    "    <div class='card'>\n" +
    '      <div>Свободный кэш (ИИС)</div>\n' +
    "      <div class='value'>" +
    freeCash +
    ' ₽</div>\n' +
    '    </div>\n' +
    "    <div class='card'>\n" +
    '      <div>Макро-сплит стратегии</div>\n' +
    "      <div class='value'>Акции " +
    stocks +
    '% / Облигации ' +
    bonds +
    '%</div>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '\n' +
    "  <div class='visual-grid'>\n" +
    "    <div class='chart-container'>\n" +
    "      <div class='chart-title'>Текущее распределение долей инструментов (%)</div>\n" +
    '      ' +
    legend +
    '\n' +
    '    </div>\n' +
    "    <div class='chart-container'>\n" +
    "      <div class='chart-title'>Сравнение долей: Текущая доля vs Стратегия (Столбец S)</div>\n" +
    '      ' +
    bars +
    '\n' +
    '    </div>\n' +
    '  </div>\n' +
    '\n' +
    "  <div class='ai-box'>\n" +
    '    ' +
    aiBox +
    '\n' +
    '  </div>\n' +
    '\n' +
    '  <h2>📋 Действующие заявки в терминале QUIK</h2>\n' +
    '  <table>\n' +
    '    <thead>\n' +
    '      <tr>\n' +
    '        <th>Инструмент</th>\n' +
    '        <th>Операция</th>\n' +
    '        <th>Количество</th>\n' +
    '        <th>Цена заявки</th>\n' +
    '        <th>Общая сумма</th>\n' +
    '        <th>Статус</th>\n' +
    '      </tr>\n' +
    '    </thead>\n' +
    '    <tbody>\n' +
    '      ' +
    orders +
    '\n' +
    '    </tbody>\n' +
    '  </table>\n' +
    '\n' +
    '  <h2>🔍 Детальный анализ защитных лимитов и дефицитов</h2>\n' +
    '  <table>\n' +
    '    <thead>\n' +
    '      <tr>\n' +
    '        <th>Инструмент</th>\n' +
    '        <th>Текущая доля</th>\n' +
    '        <th>Целевая доля (S)</th>\n' +
    '        <th>Дефицит / Профицит</th>\n' +
    '        <th>Рекомендуемый статус</th>\n' +
    '      </tr>\n' +
    '    </thead>\n' +
    '    <tbody>\n' +
    '      ' +
    table +
    '\n' +
    '    </tbody>\n' +
    '  </table>\n' +
    '</div>\n' +
    '</body>\n' +
    '</html>\n'
  );
}
