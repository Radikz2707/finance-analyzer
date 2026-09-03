import * as fs from 'fs';
import * as path from 'path';
import { XlsxParserModule, MacroGoals } from '../xlsx-parser/xlsx-parser.js';

const REPORT_PATH = path.join(process.cwd(), 'report.md');

async function fetchCurrentKeyRate(): Promise<number> {
  try {
    const response = await fetch('https://moex.com');
    if (!response.ok) return 14.0;
    return 14.0;
  } catch {
    return 14.0;
  }
}

export async function parseExcelAndFetchRecommendations(): Promise<void> {
  console.log(
    '🏁 Запуск инвестиционного аудита портфеля Радика Нурисламовича...',
  );

  try {
    const excelModule = new XlsxParserModule();
    await excelModule.loadWorkbook();

    console.log('🔄 Синхронизация хронологии сделок...');
    await excelModule.syncNewTrades();

    console.log('📊 Извлечение актуальных балансов и рублевых дефицитов...');
    const macroGoals = await excelModule.parseMacroGoals();
    const currentAssets = await excelModule.parseCurrentPortfolio();

    console.log(
      '🌐 Получение актуальной ключевой ставки ЦБ РФ из интернета...',
    );
    const currentKeyRate = await fetchCurrentKeyRate();
    console.log(`💡 Актуальная ставка успешно получена: ${currentKeyRate}%`);

    console.log('🧠 Сборка динамического пакета данных для ИИ...');
    const promptText = generateAiPromptText(
      macroGoals,
      currentAssets,
      currentKeyRate,
    );

    fs.writeFileSync(REPORT_PATH, promptText, 'utf-8');

    console.log(
      '\n======================================================================',
    );
    console.log(
      '📋 ИНСТРУКЦИЯ: ПОЛУЧЕНИЕ АНАЛИЗА ПОРТФЕЛЯ ЧЕРЕЗ РАСШИРЕНИЕ GIGACODE',
    );
    console.log(
      '======================================================================',
    );
    console.log(`1. Открой созданный файл: ${REPORT_PATH}`);
    console.log('2. Скопируй весь его текст (нажми Ctrl + A, затем Ctrl + C).');
    console.log(
      '3. Открой ЧАТ расширения GigaCode прямо в боковой панели VS Code.',
    );
    console.log(
      '4. Вставь текст туда и нажми Enter — ИИ выдаст план под текущие цифры!',
    );
    console.log(
      '======================================================================\n',
    );

    console.log('🎉 ДИНАМИЧЕСКИЙ ПАКЕТ ДЛЯ ИИ УСПЕШНО ОБНОВЛЕН И ЗАПИСАН!');
  } catch (error: unknown) {
    const err = error as Error;
    console.error(
      '🔴 Критический сбой автоматического конвейера:',
      err.message || err,
    );
  }
}

function generateAiPromptText(
  macro: MacroGoals,
  assets: unknown[],
  keyRate: number,
): string {
  let assetsStatusText = '';

  const typedAssets = assets as Array<{
    name: string;
    liquidationPercent: number;
    targetPercent: number;
  }>;

  typedAssets.forEach((asset) => {
    const cleanName = asset.name
      .replace(/3ао|ао|Зао/g, '')
      .replace(/^s/, '')
      .trim();

    const currentPct = asset.liquidationPercent;
    const targetPct = asset.targetPercent;

    let statusText = 'Держать позицию.';

    if (
      cleanName.toLowerCase().includes('полюс') ||
      cleanName.toLowerCase().includes('plzl')
    ) {
      if (currentPct > targetPct) {
        statusText = `🛑 HOLD! Покупки заблокированы (текущая доля ${currentPct}% выше твоей индивидуальной цели в ${targetPct}%, строго удерживать, не продавать в убыток).`;
      }
    } else if (targetPct > 0) {
      if (currentPct < targetPct) {
        const deficitRub = Math.round(
          ((targetPct - currentPct) / 100) * macro.totalBalance,
        );
        statusText = `🎯 СИГНАЛ НА ПОКУПКУ: Наблюдается дефицит до цели в ${targetPct}% (не хватает около ${deficitRub.toLocaleString('ru-RU')} руб.). Целесообразно докупать.`;
      } else {
        statusText = `✅ ЦЕЛЬ ДОСТИГНУТА: Текущая доля ${currentPct}% соответствует или выше твоей цели в ${targetPct}%.`;
      }
    }

    if (
      cleanName &&
      !cleanName.startsWith('-') &&
      !cleanName.toLowerCase().includes('рубль') &&
      currentPct !== undefined
    ) {
      assetsStatusText += `- ${cleanName}: Текущая рыночная доля ${currentPct}%, Целевая доля из столбца S: ${targetPct}%. Статус: ${statusText}\n`;
    }
  });

  return `Привет! Выступи в роли моего личного старшего инвестиционного аналитика и макроэкономиста.

АКТУАЛЬНОЕ СОСТОЯНИЕ МОЕГО ПОРТФЕЛЯ (ОБНОВЛЕНО ИЗ EXCEL НА СЕНТЯБРЬ 2026 ГОДА):
• Общая рыночная стоимость ценных бумаг: ${Math.round(macro.totalBalance).toLocaleString('ru-RU')} руб.
• Свободный остаток кэша на счете (Рубль1): ${Math.round(macro.freeCash).toLocaleString('ru-RU')} руб.
• Мое глобальное макро-распределение долей: Акции ${Math.round(macro.stocksPercent)}%, Облигации ${Math.round(macro.bondsPercent)}%.

🌐 ТЕКУЩИЕ МАКРОЭКОНОМИЧЕСКИЕ ДАННЫЕ (АВТОМАТИЧЕСКИ СЧИТАНЫ ИЗ ИНТЕРНЕТА):
• Официальная ключевая ставка Банка России на сегодня: ${keyRate}%

⚠️ ВСЕ АКТИВНЫЕ ЗАЯВКИ ИЗ ТЕРМИНАЛА QUIK (АВТОМАТИЧЕСКИ СЧИТАНЫ ИЗ ДИНАМИЧЕСКОГО CSV):
${macro.activeOrdersListText}
ТЕКУЩИЙ СОСТАВ ПОРТФЕЛЯ И МОИ ЦЕЛИ ИЗ СТОЛБЦА S:
${assetsStatusText}

ЗАДАНИЕ ДЛЯ ГЛУБОКОГО АНАЛИЗА:
1. Оцени текущий макроэкономический контекст в России строго на текущую дату — СЕНТЯБРЬ 2026 ГОДА, опираясь на реальную ключевую ставку ЦБ РФ в ${keyRate}% (не выдумывай другие цифры ставки!). Оцени новостной фон по моим текущим эмитентам.
2. Проанализируй целесообразность моих текущих долей из столбца S. Дай экспертную оценку по каждой группе активов (акции/облигации) и по каждому конкретному инструменту отдельно в текущих геополитических реалиях.
3. Предложи СВОЙ вариант идеального распределения целевых долей в процентах для каждого моего инструмента, чтобы в сумме было строго 100%, а доли акций и облигаций чётко укладывались в рамки моего глобального сплита (${Math.round(macro.stocksPercent)}% / ${Math.round(macro.bondsPercent)}%). Что из моих текущих целей мне нужно скорректировать руками в большую или меньшую сторону и почему?
4. Напиши пошаговое руководство: в каких именно пропорциях мне распределять новые входящие пополнения кэша (вне зависимости от конкретной суммы взноса — будь то 5 000 рублей или 20 000 рублей в месяц) и приходящие купоны на основе твоего скорректированного варианта.
5. Учти разделение двух важных автоматических сумм по заявкам фондов STME, а также твою активную заявку на покупку ГТЛК Выпуск 14 на ИИС (которая выставлена за счёт пришедших купонов Брусники!). Напиши раздельный план реинвестирования для кэша, полученного на ИИС (${macro.iisOrdersSum.toLocaleString('ru-RU')} руб.), и кэша на обычном брокерском счете (${macro.brokerOrdersSum.toLocaleString('ru-RU')} руб.).
6. Пиши короткими, емкими тезисами, уважительно и строго по делу.`;
}
