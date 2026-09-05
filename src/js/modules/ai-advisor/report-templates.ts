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
