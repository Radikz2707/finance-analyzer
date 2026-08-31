import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runFullPortfolioAnalysis } from './cli-interface';

describe('Тестирование сквозного CLI-интерфейса платформы', () => {

  it('Должен успешно выполнить полный цикл анализа и создать файл report.md', () => {
    const reportPath = path.join(process.cwd(), 'report.md');

    // Если старый файл отчета существовал, удаляем его перед тестом
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }

    // Запускаем полный цикл анализа портфеля
    runFullPortfolioAnalysis();

    // Проверяем, что файл физически создался на диске
    const isReportCreated = fs.existsSync(reportPath);
    expect(isReportCreated).toBe(true);

    // Проверяем, что файл не пустой и содержит данные
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('# 📊 ОТЧЕТ ПО РЕБАЛАНСИРОВКЕ ПОРТФЕЛЯ');
  });
});
