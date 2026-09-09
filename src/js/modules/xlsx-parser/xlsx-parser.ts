import XLSX from 'xlsx';
import * as fs from 'fs';
import { QuikOrder, parseQuikOrdersFile } from './quik-orders-parser.js';
import * as config from './xlsx-parser-config.js';

export interface MacroGoals {
  totalBalance: number;
  freeCash: number;
  stocksPercent: number;
  bondsPercent: number;
  stocksDeficitRub: number;
  bondsDeficitRub: number;
  iisOrdersSum: number;
  brokerOrdersSum: number;
  activeOrdersListText: string;
}

export interface CurrentAsset {
  name: string;
  ticker: string;
  assetType: string;
  targetPercent: number;
  liquidationPercent: number;
  balancePercent: number;
  unrealizedProfitRub: number;
  dynamicsPercent: number;
  nkdRub?: number;
  nominal?: number;
  quantity?: number;
  balancePrice?: number;
  currentPrice?: number;
}

export class XlsxParserModule {
  private workbook: XLSX.WorkBook | null = null;
  private cachedActiveOrdersText: string = 'Заявки отсутствуют';
  private cachedIisOrdersSum: number = 0;
  private cachedBrokerOrdersSum: number = 0;
  private cachedFreeCashFromQuikSheet: number = 0;
  public parsedActiveOrders: QuikOrder[] = [];

  constructor() {
    this.parsedActiveOrders = [];
  }

  public async loadWorkbook(): Promise<void> {
    if (this.workbook) return;
    if (!fs.existsSync(config.EXCEL_FILE_PATH)) {
      throw new Error('Критическая ошибка: Файл таблицы не найден');
    }
    this.workbook = XLSX.readFile(config.EXCEL_FILE_PATH);
  }

  public async saveWorkbook(): Promise<void> {
    if (this.workbook) XLSX.writeFile(this.workbook, config.EXCEL_FILE_PATH);
  }

  /**
   * Полностью динамическая синхронизация торговых приказов из QUIK на основе живой карты инструментов Excel
   */
  public async syncNewTrades(): Promise<number> {
    const instrumentMap: Record<string, string> = {};
    try {
      const currentAssets = await this.parseCurrentPortfolio();

      currentAssets.forEach((asset) => {
        if (asset.name && asset.ticker) {
          const cleanName = asset.name
            .replace(/[^A-Za-z0-9А-Яа-я-]/g, '')
            .toLowerCase()
            .trim();
          const cleanTicker = asset.ticker
            .replace(/[^A-Za-z0-9-]/g, '')
            .toLowerCase()
            .trim();

          // Зашиваем в динамическую карту все возможные варианты написания, которые может отдать QUIK
          if (cleanName) instrumentMap[cleanName] = asset.name;
          if (cleanTicker) instrumentMap[cleanTicker] = asset.name;
        }
      });
    } catch {
      // Резервный переход, если книга заблокирована процессами Excel
    }

    const orders = parseQuikOrdersFile(instrumentMap);
    this.parsedActiveOrders = orders;

    let totalIis = 0;
    const totalBroker = 0; // Константа для строгого соблюдения правила prefer-const
    let textSummary = '';

    orders.forEach((order) => {
      if (order.status === 'АКТИВНА' || order.status === 'GTC (ПЕРЕНОС)') {
        totalIis += order.sum;
        textSummary += `- ${order.ticker}: ${order.operation} ${order.qty} шт. (${order.status})\n`;
      }
    });

    this.cachedIisOrdersSum = totalIis;
    this.cachedBrokerOrdersSum = totalBroker;
    this.cachedActiveOrdersText = textSummary || 'Активные заявки отсутствуют';

    return this.parsedActiveOrders?.length || 0;
  }

  /**
   * Построчный обход сырого листа QUIK с автоматической фильтрацией служебных строк
   */
  public async parseCurrentPortfolio(): Promise<CurrentAsset[]> {
    await this.loadWorkbook();
    const assets: CurrentAsset[] = [];
    const sheetName = this.workbook?.SheetNames.find(
      (name) => name === config.QUIK_SHEET_NAME,
    );
    if (!sheetName || !this.workbook) return [];

    const sheet = this.workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    rows.forEach((row) => {
      const name = String(row['Инструмент'] || '').trim();
      if (
        !name ||
        config.EXCLUDED_ROW_KEYWORDS.some((kw) => name.toUpperCase().includes(kw))
      )
        return;
      if (name.startsWith('-') || !isNaN(Number(name)) || name.length > 30)
        return;

      if (
        config.FREE_CASH_ROW_KEYWORDS.some((kw) => name === kw)
      ) {
        this.cachedFreeCashFromQuikSheet = this.parseValue(
          row['Стоимость'] ||
            row['Ликвидационная стоимость'] ||
            row['Балансовая стоимость'],
        );
        return;
      }

      let liqPercent = this.parseValue(
        row['%, активов, по ликвидационной стоимости'] || row['Доля'],
      );
      if (liqPercent > 0 && liqPercent <= 1) {
        liqPercent = Math.round(liqPercent * 100 * 100) / 100;
      }

      let balPercent = this.parseValue(
        row['%, активов, по балансовой стоимости'],
      );
      if (balPercent > 0 && balPercent <= 1) {
        balPercent = Math.round(balPercent * 100 * 100) / 100;
      }

      let targetPct = this.parseValue(
        row['Target Percent'] || row['Целевая доля, %'] || row['S'] || 0,
      );
      if (targetPct > 0 && targetPct <= 1) {
        targetPct = Math.round(targetPct * 100 * 100) / 100;
      }

      const nkd = this.parseValue(row['НКД'] || row['Накопленный купон']);
      const quantityKey = Object.keys(row).find((k) =>
        k.toUpperCase().includes('КОЛ'),
      );
      const quantity = quantityKey ? this.parseValue(row[quantityKey]) : 0;

      // Парсим цены входа и текущие цены из Excel
      const balancePrice = this.parseValue(row['Балансовая цена']);
      const liquidationPrice = this.parseValue(row['Ликвидационная цена']);
      const dynamicsPercent = this.parseValue(row['Динамика актива']);

      assets.push({
        name,
        ticker: String(
          row['Код工具'] || row['Код инструмента'] || row['Код'] || '',
        ).trim(),
        assetType: String(row['Вид активов'] || row['Тип'] || '').trim(),
        targetPercent: targetPct,
        liquidationPercent: liqPercent,
        balancePercent: balPercent > 0 ? balPercent : liqPercent,
        unrealizedProfitRub: this.parseValue(row['Нереализованная прибыль']),
        dynamicsPercent: dynamicsPercent,
        nkdRub: nkd,
        nominal: config.DEFAULT_BOND_NOMINAL,
        quantity: quantity,
        balancePrice: balancePrice,
        currentPrice: liquidationPrice,
      });
    });

    return assets;
  }
    /**
     * Динамическое извлечение макроцелей и ликвидного кэша по текстовым маркерам
     * Если данные не найдены — выбрасывает ошибку
     */
    public async parseMacroGoals(): Promise<MacroGoals> {
      await this.loadWorkbook();
      let stocksPercent: number | undefined;
      let bondsPercent: number | undefined;

      // 1. Ищем целевые доли на листе «Цели»
      const goalsSheet = this.workbook?.Sheets[config.GOALS_SHEET_NAME];
      if (goalsSheet) {
        const rows =
          XLSX.utils.sheet_to_json<Record<string, unknown>>(goalsSheet);
        for (const row of rows) {
          const key = String(
            row['Группа инструментов'] || row['Тип'] || '',
          ).toUpperCase();
          const targetKey = Object.keys(row).find(
            (k) => k.includes('доля') || k.includes('Процент') || k === 'S',
          );
          const val = targetKey ? this.parseValue(row[targetKey]) : 0;
          if (val === 0) continue;

          if (key.includes('АКЦИ')) {
            stocksPercent = val > 1 ? val : val * 100;
          }
          if (key.includes('ОБЛИГ')) {
            bondsPercent = val > 1 ? val : val * 100;
          }
        }

        // Альтернативный поиск по строке «Целевая доля»
        if (stocksPercent === undefined || bondsPercent === undefined) {
          const targetRow = rows.find((row) => {
            const emptyVal = row['__EMPTY'];
            return (
              typeof emptyVal === 'string' &&
              emptyVal.includes('Целевая доля')
            );
          });

          if (targetRow) {
            const bondsVal = this.parseValue(targetRow['__EMPTY_5']);
            const stocksVal = this.parseValue(targetRow['__EMPTY_6']);

            if (stocksVal > 0 && stocksPercent === undefined) {
              stocksPercent = stocksVal > 1 ? stocksVal : stocksVal * 100;
            }
            if (bondsVal > 0 && bondsPercent === undefined) {
              bondsPercent = bondsVal > 1 ? bondsVal : bondsVal * 100;
            }
          }
        }
      }

      // 2. freeCash и totalBalance берём из листа «Отчет по сделкам»
      const reportSheet = this.workbook?.Sheets[config.TRADES_SHEET_NAME];
      let freeCash: number | undefined;
      let totalBalance: number | undefined;

      if (reportSheet && reportSheet['!ref']) {
        const range = XLSX.utils.decode_range(reportSheet['!ref']);

        for (let row = range.s.r + 1; row <= range.e.r; row++) {
          const nameCell = reportSheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
          const name = nameCell && nameCell.v !== undefined
            ? String(nameCell.v).trim().toUpperCase()
            : '';

          const valueCell = reportSheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
          const value = this.parseValue(valueCell?.v);

          if (name.includes('ЛИКВИДН') && name.includes('СРЕДСТВ')) {
            freeCash = value;
          } else if (name.includes('ИТОГО АКТИВ')) {
            totalBalance = value;
          }
        }
      }

      // Fallback: если не нашли в «Отчете по сделкам», ищем в QUIK
      if (freeCash === undefined || freeCash === 0) {
        freeCash = this.cachedFreeCashFromQuikSheet;
      }

      if (totalBalance === undefined || totalBalance === 0) {
        // Считаем как сумму ликвидационных стоимостей всех позиций из QUIK
        const quikSheet = this.workbook?.Sheets[config.QUIK_SHEET_NAME];
        if (quikSheet && quikSheet['!ref']) {
          const quikRows =
            XLSX.utils.sheet_to_json<Record<string, unknown>>(quikSheet);

          for (const row of quikRows) {
            const name = String(row['Инструмент'] || '').trim();

            if (
              !name ||
              config.EXCLUDED_ROW_KEYWORDS.some((kw) => name.toUpperCase().includes(kw))
            ) continue;

            if (config.FREE_CASH_ROW_KEYWORDS.some((kw) => name === kw)) continue;

            const liqCost = this.parseValue(
              row['Ликвидационная стоимость'] ||
                row['Стоимость'] ||
                row['Балансовая стоимость'],
            );

            if (liqCost === 0) {
              const liqPrice = this.parseValue(row['Ликвидационная цена']);
              const quantityKey = Object.keys(row).find((k) =>
                k.toUpperCase().includes('КОЛ'),
              );
              const quantity = quantityKey
                ? this.parseValue(row[quantityKey])
                : 0;
              totalBalance = (totalBalance || 0) + liqPrice * quantity;
            } else {
              totalBalance = (totalBalance || 0) + liqCost;
            }
          }
        }
      }

      // 3. ВАЛИДАЦИЯ: все значения должны быть найдены в Excel
      if (stocksPercent === undefined) {
        throw new Error(
          'Не найдена целевая доля акций в листе «Цели». Укажите значение в столбце с ключевым словом "доля" или "Процент".',
        );
      }
      if (bondsPercent === undefined) {
        throw new Error(
          'Не найдена целевая доля облигаций в листе «Цели». Укажите значение в столбце с ключевым словом "доля" или "Процент".',
        );
      }
      if (freeCash === undefined || freeCash === 0) {
        throw new Error(
          'Не найден ликвидный кэш (свободные средства). ' +
          'Добавьте строку "Ликвидные средства" в лист «Отчет по сделкам» или "Рубль" в лист QUIK.',
        );
      }
      if (totalBalance === undefined || totalBalance === 0) {
        throw new Error(
          'Не удалось рассчитать totalBalance. ' +
          'Добавьте строку "Итого активов" в лист «Отчет по сделкам» или проверьте данные в QUIK.',
        );
      }

      return {
        totalBalance,
        freeCash,
        stocksPercent,
        bondsPercent,
        stocksDeficitRub: 0,
        bondsDeficitRub: 0,
        iisOrdersSum: this.cachedIisOrdersSum,
        brokerOrdersSum: this.cachedBrokerOrdersSum,
        activeOrdersListText: this.cachedActiveOrdersText,
      };
    }

    /**
     * Динамический парсинг объема лично внесенных средств по имени категории
     * Если данные не найдены — выбрасывает ошибку
     */
    public async parseInvestedFunds(): Promise<{ totalNet: number }> {
      await this.loadWorkbook();

      // 1. Ищем строку "Внесено своих средств" на листе «Отчет по сделкам»
      const reportSheet = this.workbook?.Sheets[config.TRADES_SHEET_NAME];
      if (reportSheet && reportSheet['!ref']) {
        const range = XLSX.utils.decode_range(reportSheet['!ref']);

        for (let row = range.s.r + 1; row <= range.e.r; row++) {
          const nameCell = reportSheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
          const name = nameCell && nameCell.v !== undefined
            ? String(nameCell.v).trim().toUpperCase()
            : '';

          if (name.includes('ВНЕС') && name.includes('СРЕДСТВ')) {
            const valueCell = reportSheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
            const value = this.parseValue(valueCell?.v);
            if (value > 0) {
              return { totalNet: value };
            }
          }
        }
      }

      // 2. Если не нашли — считаем totalNet как сумму балансовых стоимостей всех позиций из QUIK
      const quikSheet = this.workbook?.Sheets[config.QUIK_SHEET_NAME];
      if (!quikSheet || !quikSheet['!ref']) {
        throw new Error(
          'Не найден лист «' + config.QUIK_SHEET_NAME + '» для расчета вложенных средств.',
        );
      }

      const range = XLSX.utils.decode_range(quikSheet['!ref']);
      let totalNet = 0;
      let positionCount = 0;

      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const nameCell = quikSheet[XLSX.utils.encode_cell({ r: row, c: 3 })];
        const name = nameCell && nameCell.v !== undefined
          ? String(nameCell.v).trim()
          : '';

        // Пропускаем служебные строки
        if (
          !name ||
          config.EXCLUDED_ROW_KEYWORDS.some((kw) => name.toUpperCase().includes(kw))
        ) continue;

        // Пропускаем строку "Рубль" — это свободный кэш, не инвестиция
        if (config.FREE_CASH_ROW_KEYWORDS.some((kw) => name === kw)) continue;

        // Ищем столбец с балансовой ценой (цена входа)
        let balancePrice = 0;
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cell = quikSheet[XLSX.utils.encode_cell({ r: row, c: col })];
          if (cell && cell.v !== undefined) {
            const headerCell = quikSheet[XLSX.utils.encode_cell({ r: 0, c: col })];
            const header = headerCell && headerCell.v !== undefined
              ? String(headerCell.v).toLowerCase()
              : '';
            if (
              header.includes('балансов') ||
              header.includes('цена входа') ||
              header.includes('цена покупки') ||
              header.includes('цена')
            ) {
              balancePrice = this.parseValue(cell.v);
              break;
            }
          }
        }

        if (balancePrice > 0) {
          totalNet += balancePrice;
          positionCount++;
        }
      }

      if (totalNet === 0) {
        throw new Error(
          'Не удалось рассчитать вложенные средства. ' +
          'Проверьте, что в столбце с заголовком "Балансовая цена" или "Цена входа" указаны значения для всех позиций.',
        );
      }

      return { totalNet };
    }

    /**
     * Сквозной исторический анализ оборотов
     * Читает данные напрямую из ячеек Excel по названиям строк
     */
     public async parseHistoricalTradesAnalysis(): Promise<{
       tradesCount: number;
       totalPurchasesSum: number;
       totalSalesSum: number;
       totalHistoricalCommission: number;
       profitC10: number;
       profitC11: number;
     }> {
       await this.loadWorkbook();

       // 1. Читаем данные напрямую из листа «Отчет по сделкам»
       const reportSheet = this.workbook?.Sheets[config.TRADES_SHEET_NAME];
       let totalPurchasesSum: number | undefined;
       let totalSalesSum: number | undefined;
       let totalHistoricalCommission: number | undefined;
       let profitC10: number | undefined;
       let profitC11: number | undefined;

       if (reportSheet && reportSheet['!ref']) {
         const range = XLSX.utils.decode_range(reportSheet['!ref']);

         for (let row = range.s.r + 1; row <= range.e.r; row++) {
           // Колонка B (индекс 1) — название строки
           const nameCell = reportSheet[XLSX.utils.encode_cell({ r: row, c: 1 })];
           const name = nameCell && nameCell.v !== undefined
             ? String(nameCell.v).trim().toUpperCase()
             : '';

           // Колонка C (индекс 2) — значение
           const valueCell = reportSheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
           const value = this.parseValue(valueCell?.v);

           if (name.includes('КУПЛЯ') || name.includes('ПОКУПК')) {
             totalPurchasesSum = value;
           } else if (name.includes('ПРОДАЖ')) {
             totalSalesSum = value;
           } else if (name.includes('КОМИССИ')) {
             totalHistoricalCommission = value;
           } else if (name.includes('РАЗНИЦ')) {
             // C5 — просто разница, не используем как C10
           } else if (name.includes('ТЕКУЩАЯ') && (name.includes('ПРИБЫЛЬ') || name.includes('УБЫТОК'))) {
             profitC10 = value;
           } else if (name.includes('ПРИБЫЛЬ/УБЫТОК')) {
             profitC11 = value;
           }
         }
       }

       // Если не нашли в «Отчете по сделкам» — считаем из QUIK
       if (totalPurchasesSum === undefined || totalSalesSum === undefined) {
         console.log(
           '\n⚠️ [HISTORICAL] Сводные строки не найдены. Считаем из листа QUIK...',
         );

         const quikSheet = this.workbook?.Sheets[config.QUIK_SHEET_NAME];
         if (!quikSheet || !quikSheet['!ref']) {
           throw new Error(
             'Не найден лист «' + config.QUIK_SHEET_NAME + '» для расчета исторических данных.',
           );
         }

         const quikRows =
           XLSX.utils.sheet_to_json<Record<string, unknown>>(quikSheet);

         let purchasesSum = 0;
         let salesSum = 0;
         let positionCount = 0;

         for (const row of quikRows) {
           const name = String(row['Инструмент'] || '').trim();

           if (
             !name ||
             config.EXCLUDED_ROW_KEYWORDS.some((kw) => name.toUpperCase().includes(kw))
           ) continue;

           if (config.FREE_CASH_ROW_KEYWORDS.some((kw) => name === kw)) continue;

           const balancePrice = this.parseValue(row['Балансовая цена']);
           const liquidationPrice = this.parseValue(row['Ликвидационная цена']);

           if (balancePrice > 0) {
             purchasesSum += balancePrice;
           }
           if (liquidationPrice > 0) {
             salesSum += liquidationPrice;
           }
           positionCount++;
         }

         if (totalPurchasesSum === undefined) totalPurchasesSum = purchasesSum;
         if (totalSalesSum === undefined) totalSalesSum = salesSum;
         if (profitC10 === undefined) profitC10 = salesSum - purchasesSum;

        console.log(
          '  → Позиций: ' + positionCount +
          ' | Вложено (баланс): ' + purchasesSum.toLocaleString('ru-RU') +
          ' | Текущая стоимость (ликвид): ' + salesSum.toLocaleString('ru-RU'),
        );
       }

        if (totalPurchasesSum === undefined || totalPurchasesSum === 0) {
          throw new Error(
            'Не удалось рассчитать объем покупок.',
          );
        }
        if (totalSalesSum === undefined || totalSalesSum === 0) {
          throw new Error(
            'Не удалось рассчитать объем продаж.',
          );
        }

        // Если profitC10 не найден в Excel — грубая оценка
        if (profitC10 === undefined) {
          profitC10 = totalSalesSum - totalPurchasesSum;
        }

       return {
         tradesCount: 0,
         totalPurchasesSum,
         totalSalesSum,
         totalHistoricalCommission: totalHistoricalCommission || 0,
         profitC10,
         profitC11: profitC11 || 0,
       };
     }

  private parseValue(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const parsed = parseFloat(val.replace(/[^0-9.-]/g, ''));
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }
}
