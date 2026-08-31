import fs from 'fs';
import path from 'path';
import { parsePortfolioExcel } from '../xlsx-parser/xlsx-parser';
import { calculateGlobalAllocation, calculateRebalanceDelta, analyzeAssetLimits } from '../portfolio-math/portfolio-math';
import { generateAiPrompt } from '../ai-advisor/ai-advisor';

// ГЛАВНАЯ ФУНКЦИЯ ЗАПУСКА АНАЛИЗА ПОРТФЕЛЯ
export function runFullPortfolioAnalysis(): void {
  console.log('\n==================================================');
  console.log('🚀 ЗАПУСК ПОЛНОГО АВТОМАТИЧЕСКОГО АНАЛИЗА ПОРТФЕЛЯ');
  console.log('==================================================\n');

  // 1. Шаг 1: Автоматически парсим реальный Excel-файл из вашей бухгалтерии
  const assets = parsePortfolioExcel();

  if (assets.length === 0) {
    console.error('❌ [CLI ERROR]: Массив активов пуст. Анализ прерван.');
    return;
  }

  // 2. Шаг 2: Прогоняем данные через математические формулы ребалансировки
  const globalAllocation = calculateGlobalAllocation(assets);
  const rebalanceDelta = calculateRebalanceDelta(globalAllocation);
  const assetsAnalysis = analyzeAssetLimits(assets, globalAllocation.totalValue);

  // 3. Шаг 3: Генерируем структурированный промпт для локального ИИ
  const aiPromptText = generateAiPrompt({
    globalAllocation,
    rebalanceDelta,
    assetsAnalysis
  });

  // 4. Шаг 4: Формируем красивый итоговый Markdown-файл отчета
  const reportContent = `# 📊 ОТЧЕТ ПО РЕБАЛАНСИРОВКЕ ПОРТФЕЛЯ
Дата анализа: ${new Date().toLocaleDateString('ru-RU')}
Рыночная стоимость ценных бумаг: ${globalAllocation.totalValue.toLocaleString('ru-RU')} руб.

## 📈 Текущий сплит классов активов (Цель 52% Акции / 48% Облигации)
- **Акции**: ${((globalAllocation.stockValue / globalAllocation.totalValue) * 100).toFixed(1)}%
- **Облигации**: ${((globalAllocation.bondValue / globalAllocation.totalValue) * 100).toFixed(1)}%

### Необходимые изменения в рублях:
- **В Акции**: ${rebalanceDelta.actions.stockDelta.toLocaleString('ru-RU')} руб.
- **В Облигации**: ${rebalanceDelta.actions.bondDelta.toLocaleString('ru-RU')} руб.

## 🔍 Сформированное техническое задание для ИИ (Промпт):
\`\`\`text
${aiPromptText}
\`\`\`
`;

  // 5. Шаг 5: Сохраняем файл отчета в корень вашего проекта
  try {
    const reportPath = path.join(process.cwd(), 'report.md');
    fs.writeFileSync(reportPath, reportContent, 'utf-8');
    console.log(`\n✨ [CLI SUCCESS]: Итоговый отчет успешно сгенерирован и сохранен по пути: ${reportPath}`);
    console.log('💡 Откройте файл report.md, скопируйте блок ТЗ и отправьте его в локальный ИИ!\n');
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error(`❌ [CLI ERROR]: Не удалось сохранить файл отчета. Причина: ${errMsg}`);
  }
}

// БАЗОВЫЙ ИНИЦИАЛИЗАТОР МОДУЛЯ
export const cliInterface = (): void => {
  console.log('📌 Модуль cli-interface (TS) успешно инициализирован');
};
