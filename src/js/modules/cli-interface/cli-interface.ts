import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { parseExcelAndFetchRecommendations } from '../ai-advisor/ai-advisor';

export async function runFullPortfolioAnalysis(): Promise<void> {
  console.log('\n==================================================');
  console.log('🚀 ЗАПУСК АВТОМАТИЧЕСКОГО АНАЛИЗА ПОРТФЕЛЯ');
  console.log('==================================================\n');

  // 1. Запускаем главный конвейер аналитики ИИ (генерация купонов, дивидендов Сбера, MD и HTML-отчетов)
  if (typeof parseExcelAndFetchRecommendations === 'function') {
    await parseExcelAndFetchRecommendations();
  }

  // 2. Дополнительная валидация генерации дашбордов для контроля целостности системы
  const reportPathHtml = path.resolve(process.cwd(), 'report.html');
  const reportPathMd = path.resolve(process.cwd(), 'report.md');

  console.log('📝 Контроль генерации отчетов:');
  if (fs.existsSync(reportPathMd)) {
    console.log(` 🔎 Локальный текстовый отчет зафиксирован: ${reportPathMd}`);
  }

  if (fs.existsSync(reportPathHtml)) {
    console.log(
      ' 🔍 Проверка Node.js: Файл report.html точно существует в корне папки.',
    );
  } else {
    console.error('❌ Ошибка: Файл report.html не был сгенерирован ядром ИИ.');
    return;
  }

  // 3. Открываем обновленный дашборд через встроенный системный вызов Windows Explorer
  exec('explorer ' + reportPathHtml, (err) => {
    if (err) {
      console.log('💡 Браузер заблокировал автоматическое открытие.');
    } else {
      console.log('🚀 Системный вызов выполнен! Дашборд успешно открывается.');
    }
  });
}

/**
 * Заглушка экспорта интерфейса для соответствия архитектурным требованиям сборки Gulp
 */
export const cliInterface = (): void => {
  console.log('📌 Модуль cli-interface (TS) успешно инициализирован');
};
