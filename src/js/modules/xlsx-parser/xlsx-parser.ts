import xlsx from 'xlsx';
import { IAsset, AssetClass } from '../portfolio-math/portfolio-math';

// 1. НАСТРОЙКА ПОСТОЯННОГО ПУТИ К ВАШЕМУ ФАЙЛУ БУХГАЛТЕРИИ
export const EXCEL_FILE_PATH = 'C:\\Users\\Радик\\Documents\\Бухгалтерия Радика\\Отчет\\Данные новые.xlsx';

// 2. ВСПОМОГАТЕЛЬНЫЙ АЛГОРИТМ: АВТОМАТИЧЕСКОЕ ОПРЕДЕЛЕНИЕ КЛАССА АКТИВА
function detectAssetClass(instrumentName: string): AssetClass {
  const name = instrumentName.toLowerCase();

  // Если в названии есть маркеры облигаций из вашего портфеля — это bond
  if (name.includes('брус') || name.includes('селигдар') || name.includes('гтлк')) {
    return 'bond';
  }

  // По умолчанию для Сбера, Полюса, Татнефти, Интер РАО и ETF ставим stock
  return 'stock';
}

// 3. ГЛАВНАЯ ФУНКЦИЯ ПАРСИНГА EXCEL-ТАБЛИЦЫ
export function parsePortfolioExcel(): IAsset[] {
  try {
    // Читаем файл по вашему абсолютному пути
    const workbook = xlsx.readFile(EXCEL_FILE_PATH);

    // Берем самый первый лист из книги
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Превращаем строки таблицы в удобный массив объектов JavaScript без использования any
    const rawData = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, { raw: false });

    const parsedAssets: IAsset[] = [];

    // Перебираем каждую строчку из Excel
    rawData.forEach((row) => {
      const instrument = row['Инструмент'];

      // Фильтруем пустые строки, итоговые строки и свободный кэш
      if (!instrument || typeof instrument !== 'string' || instrument.includes('Рубль') || instrument === '9') {
        return;
      }

      // Вспомогательная функция очистки числовых значений от знака рубля "₽" и пробелов
      const cleanNumber = (val: unknown): number => {
        if (!val) return 0;
        const cleaned = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
        return parseFloat(cleaned) || 0;
      };

      // Сопоставляем колонки вашего Excel-листа со структурой IAsset
      const position = cleanNumber(row['Позиция']);
      const price = cleanNumber(row['Цена']);
      const costValue = cleanNumber(row['Балансовая стоимость']);
      const marketValue = cleanNumber(row['Стоимость']); // Колонка "Стоимость" — это текущий рынок

      parsedAssets.push({
        instrument: instrument.trim(),
        position,
        price,
        costValue,
        marketValue,
        assetClass: detectAssetClass(instrument),
        accountType: 'iis' // Временно ставим iis, далее научим распределять по счетам
      });
    });

    console.log(`\n📊 [PARSER]: Успешно прочитано ${parsedAssets.length} ценных бумаг из Excel!`);
    return parsedAssets;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
    console.error(`\n❌ [PARSER ERROR]: Не удалось прочитать файл Excel. Причина: ${errorMessage}`);
    return [];
  }
}

// 4. БАЗОВЫЙ ИНИЦИАЛИЗАТОР МОДУЛЯ XLSX-PARSER
export const xlsxParser = (): void => {
  console.log('📈 Модуль xlsx-parser (TS) успешно инициализирован');
};
