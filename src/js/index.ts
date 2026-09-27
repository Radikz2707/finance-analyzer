/**
 * Точка входа CLI-анализа (npm run analyze).
 *
 * Запускает сквозной финансовый конвейер: читает Excel-файл портфеля
 * (путь из env EXCEL_FILE_PATH), выполняет ребалансировку портфеля
 * и генерирует отчёт (report.html / report.md).
 */
import { parseExcelAndFetchRecommendations } from './modules/ai-advisor/ai-advisor.js';

// Запускаем наш сквозной финансовый конвейер
parseExcelAndFetchRecommendations();
