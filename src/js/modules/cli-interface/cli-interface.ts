import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { XlsxParserModule } from '../xlsx-parser/xlsx-parser';
import { PortfolioMathModule } from '../portfolio-math/portfolio-math';
// Импортируем вашу главную функцию-конвейер
import { parseExcelAndFetchRecommendations } from '../ai-advisor/ai-advisor';

export async function runFullPortfolioAnalysis(): Promise<void> {
  console.log('\n==================================================');
  console.log('🚀 ЗАПУСК АВТОМАТИЧЕСКОГО АНАЛИЗА ПОРТФЕЛЯ');
  console.log('==================================================\n');

  // 1. Инициализируем парсер и собираем данные из Excel
  const parser = new XlsxParserModule();
  const assets = await parser.parseCurrentPortfolio();
  const macroGoals = await parser.parseMacroGoals();

  if (assets.length === 0) {
    console.error('❌ [ОШИБКА]: Массив активов пуст.');
    return;
  }

  // 2. Запускаем комплексный аналитический метод вашей инвестиционной математики
  const math = new PortfolioMathModule();
  const analysisResult = math.analyzePortfolio(macroGoals, assets);

  // 3. Запускаем ваш главный конвейер аналитики без аргументов, так как он сам управляет процессами
  if (typeof parseExcelAndFetchRecommendations === 'function') {
    await parseExcelAndFetchRecommendations();
  }

  // 4. Обновляем файл report.md на диске для локального логирования
  const reportPath = path.join(process.cwd(), 'report.md');

  const totalVal = analysisResult.macro.totalBalance;
  const currentStocksPct = analysisResult.macro.stocksPercent;
  const currentBondsPct = analysisResult.macro.bondsPercent;

  const reportContent = `# 📊 ОТЧЕТ ПО РЕБАЛАНСИРОВКЕ ПОРТФЕЛЯ
Дата анализа: ${new Date().toLocaleDateString('ru-RU')}
Общий баланс портфеля: ${totalVal.toLocaleString('ru-RU')} руб.
Свободные средства: ${analysisResult.macro.freeCash.toLocaleString('ru-RU')} руб.

## 📈 Текущий сплит классов активов (Целевой ориентир стратегии)
- **Целевая доля Акций**: ${currentStocksPct}% (Свободный пул для ИИ: ${analysisResult.freeStocksPoolPercent}%)
- **Целевая доля Облигаций**: ${currentBondsPct}%

### Анализ защитных лимитов и дефицитов по инструментам:
${analysisResult.assetsAnalysis.map((a) => `- **${a.name}**: Доля ${a.currentPercent}% (Цель: ${a.targetPercent}%), Дефицит: ${a.deficitRub.toLocaleString('ru-RU')} руб. [Статус: ${a.status}]`).join('\n')}
`;

  fs.writeFileSync(reportPath, reportContent, 'utf-8');
  console.log(
    `✨ [УСПЕХ]: Математика портфеля посчитана! Локальный отчет обновлен: ${reportPath}`,
  );

  // 5. Открываем веб-интерфейс нейросети в браузере
  const targetUrl = 'https://chatgpt.com';
  console.log('⏳ Автоматически открываем нейросеть в вашем браузере...');

  exec('start ' + targetUrl, (error) => {
    if (error) {
      console.log(
        '💡 Если браузер не открылся сам, перейдите на сайт вручную.',
      );
    } else {
      console.log('🚀 БРАУЗЕР УСПЕШНО ОТКРЫТ!');
    }
  });
}

export const cliInterface = (): void => {
  console.log('📌 Модуль cli-interface (TS) успешно инициализирован');
};
