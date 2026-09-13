import XLSX from 'xlsx';
import * as fs from 'fs';
import { QuikOrder, parseQuikOrdersFile } from './quik-orders-parser.js';
import * as config from './xlsx-parser-config.js';
import { PortfolioConfig } from '../config/portfolio-config.js';

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

/** Единица текущей цены: рубль, процент от номинала или неизвестно */
export type PriceUnit = 'RUB' | 'PERCENT_OF_NOMINAL' | 'UNKNOWN';

export interface CurrentAsset {
  name: string;
  ticker: string;
  assetType: string;
  targetPercent?: number;
  liquidationPercent: number;
  balancePercent: number;
  unrealizedProfitRub: number;
  dynamicsPercent: number;
  dailyDynamicsPercent?: number; // Дневная динамика из листа "Акции"
  nkdRub?: number;
  nominal?: number;
  quantity?: number;
  balancePrice?: number;
  currentPrice?: number;
  /** Единица currentPrice: RUB / PERCENT_OF_NOMINAL / UNKNOWN */
  priceUnit?: PriceUnit;
  /** Идентификатор счёта (например, 'S04J3LB' или '403GPBT') */
  accountId?: string;
  /** Тип счёта: ИИС или брокерский */
  accountType?: 'IIS' | 'BROKER';
  /** Запрет на продажу (например, для защитных позиций) */
  holdOnly?: boolean;
  /** Исключить из расчёта stock pool */
  excludeFromStockPool?: boolean;
  /** Флаг конфликта targetPercent между счетами */
  targetPercentConflict?: boolean;
}

/** Позиция на конкретном счёте (для детализации агрегации) */
export interface AccountPosition {
  accountId: string;
  accountType: 'IIS' | 'BROKER';
  liquidationValue: number;
  liquidationPercent: number;
  balancePercent: number;
  targetPercent?: number;
  quantity: number;
  balancePrice: number;
  currentPrice: number;
  /** Балансовая стоимость из Excel (SUM этого поля = totalBalanceValue) */
  balanceValue: number;
  unrealizedProfitRub: number;
  dynamicsPercent: number;
  dailyDynamicsPercent?: number;
  nkdRub?: number;
  nominal?: number;
  /** Единица currentPrice: RUB / PERCENT_OF_NOMINAL / UNKNOWN */
  priceUnit?: PriceUnit;
  /** Запрет на продажу (например, для защитных позиций) */
  holdOnly?: boolean;
  /** Исключить из расчёта stock pool */
  excludeFromStockPool?: boolean;
}

/** Агрегированная позиция по тикеру с детализацией по счетам */
export interface AggregatedAsset {
  ticker: string;
  name: string;
  assetType: string;
  totalLiquidationValue: number;
  totalLiquidationPercent: number;
  totalBalancePercent: number;
  targetPercent?: number;
  totalQuantity: number;
  balancePrice: number;
  currentPrice: number;
  totalUnrealizedProfitRub: number;
  dynamicsPercent: number;
  dailyDynamicsPercent?: number;
  nkdRub?: number;
  nominal?: number;
  /** Единица currentPrice: RUB / PERCENT_OF_NOMINAL / UNKNOWN */
  priceUnit?: PriceUnit;
  /** Сумма балансовых стоимостей по всем счетам (SUM balanceValue).
    * averageBalancePrice = totalBalanceValue / totalQuantity
    */
  totalBalanceValue: number;
  /** Запрет на продажу — true, если хотя бы на одном счёте holdOnly=true */
  holdOnly?: boolean;
  /** Исключить из stock pool — true, если хотя бы на одном счёте excludeFromStockPool=true */
  excludeFromStockPool?: boolean;
  /** Флаг конфликта targetPercent между счетами (true = разные target на разных счетах) */
  targetPercentConflict?: boolean;
  accounts: AccountPosition[];
}

export class XlsxParserModule {
  private workbook: XLSX.WorkBook | null = null;
  private cachedActiveOrdersText: string = 'Заявки отсутствуют';
  private cachedIisOrdersSum: number = 0;
  private cachedBrokerOrdersSum: number = 0;
  private cachedFreeCashFromQuikSheet: number = 0;
  public parsedActiveOrders: QuikOrder[] = [];
  private nameToTickerMap: Record<string, string> = {};

  constructor() {
    this.parsedActiveOrders = [];
  }

  /**
   * Динамическое извлечение информации о счетах из Excel
   * Ищет листы с префиксом "Портфель_" (например: Портфель_403GPBT, Портфель_S04J3LB)
   * Извлекает код счета из имени листа и считает сумму позиций на этом листе
   */
  public async parseAccountsInfo(): Promise<Array<{ name: string; value: number }>> {
    await this.loadWorkbook();
    const accounts: Array<{ name: string; value: number }> = [];

    if (!this.workbook) return accounts;

    const workbook = this.workbook;

    // Ищем все листы, начинающиеся с "Портфель_"
    const portfolioSheets = workbook.SheetNames.filter(
      (name) => name.toUpperCase().startsWith('ПОРТФЕЛЬ_') || name.toUpperCase().startsWith('ПОРТФ.')
    );

    portfolioSheets.forEach((sheetName) => {
      // Извлекаем код счета из имени листа (например: "Портфель_403GPBT" → "403GPBT")
      const underscoreIdx = sheetName.indexOf('_');
      if (underscoreIdx < 0) return;

      const accountCode = sheetName.substring(underscoreIdx + 1).trim();
      // Проверяем, что код счета — это 5-7 символов (буквы+цифры)
      if (!accountCode || !/^[A-Z0-9]{5,7}$/i.test(accountCode)) return;

      // Считаем сумму ликвидационных стоимостей на этом листе
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet['!ref']) return;

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      let totalValue = 0;
      const seenNames = new Set<string>();

      rows.forEach((row) => {
        const name = String(row['Инструмент'] || '').trim();
        // Пропускаем служебные строки
        if (
          !name ||
          config.EXCLUDED_ROW_KEYWORDS.some((kw) => name.toUpperCase().includes(kw))
        ) return;
        if (name.startsWith('-') || !isNaN(Number(name)) || name.length > 30) return;

        // Проверяем дубликаты на одном листе
        const cleanName = name.toLowerCase().trim();
        if (seenNames.has(cleanName)) return;
        seenNames.add(cleanName);

        // Суммируем ликвидационную стоимость
        const liqCost = this.parseValue(
          row['Ликвидационная стоимость'] ||
            row['Стоимость'] ||
            row['Балансовая стоимость'],
        );
        if (liqCost > 0) {
          totalValue += liqCost;
        }
      });

      if (totalValue > 0) {
        accounts.push({ name: accountCode, value: totalValue });
      }
    });

    return accounts;
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
    let totalBroker = 0;
    let textSummary = '';

    orders.forEach((order) => {
      if (order.status === 'АКТИВНА' || order.status === 'GTC (ПЕРЕНОС)') {
        const accountType = PortfolioConfig.accountTypeMapping[order.account as keyof typeof PortfolioConfig.accountTypeMapping];
        const isIis = accountType === 'IIS';
        if (isIis) {
          totalIis += order.sum;
        } else {
          totalBroker += order.sum;
        }
        textSummary +=
          `- ${order.account} | ${order.ticker}: ${order.operation} ${order.qty} шт. (${order.status})\n`;
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

    // Загружаем котировки из листа "Акции" — мапа тикер -> { currentPrice, dailyDynamicsPercent }
    const quotesMap = await this.parseQuotesSheet();

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

      // Получаем тикер и тип актива
      const ticker = String(
        row['Код工具'] || row['Код инструмента'] || row['Код'] || '',
      ).trim();
      const assetType = String(row['Вид активов'] || row['Тип'] || '').trim();

      // Парсим номинал динамически из колонки «Номинал»
      const nominal = this.parseNominalFromRow(row);

      // Определяем priceUnit на основе типа актива и наличия номинала
      const priceUnit = this.determinePriceUnit(assetType, nominal);

      // Для облигаций с неизвестным номиналом НЕ подставляем 1000
      // currentPrice = 0 → P&L покажет «—»/N/A
      let finalCurrentPrice = liquidationPrice;
      if (priceUnit === 'UNKNOWN') {
        finalCurrentPrice = 0;
      } else if (priceUnit === 'PERCENT_OF_NOMINAL' && nominal !== undefined && nominal > 0) {
        // Процент от номинала → конвертируем в рубли
        finalCurrentPrice = liquidationPrice * nominal / 100;
      }

      // Ищем дневную динамику — только для акций
      const isStock = assetType === 'А' || assetType === 'Акция' || assetType.includes('Акция');
      let dailyDynamicsPercent: number | undefined = undefined;

      if (isStock && Object.keys(quotesMap).length > 0) {
        // 1. Точное совпадение по QUIK-тикеру (IRAO → IRAO, SBER → SBER)
        const upperTicker = ticker.toUpperCase();
          if (quotesMap[upperTicker]) {
          dailyDynamicsPercent = quotesMap[upperTicker].dailyDynamicsPercent;
        } else {
          // 2. Fuzzy-поиск по названию через nameToTickerMap
          const cleanName = name.replace(/\s+/g, ' ').trim().toUpperCase();
          let foundTicker = this.nameToTickerMap[cleanName];

          // Fuzzy: частичное совпадение
          if (!foundTicker) {
            for (const [key, val] of Object.entries(this.nameToTickerMap)) {
              if (cleanName.includes(key) || key.includes(cleanName)) {
                foundTicker = val;
                break;
              }
            }
          }

          if (foundTicker && quotesMap[foundTicker]) {
            dailyDynamicsPercent = quotesMap[foundTicker].dailyDynamicsPercent;
          }
        }
      }

      assets.push({
        name,
        ticker,
        assetType,
        targetPercent: targetPct,
        liquidationPercent: liqPercent,
        balancePercent: balPercent > 0 ? balPercent : liqPercent,
        unrealizedProfitRub: this.parseValue(row['Нереализованная прибыль']),
        dynamicsPercent: dynamicsPercent,
        dailyDynamicsPercent,
        nkdRub: nkd,
        nominal,
        priceUnit,
        quantity: quantity,
        balancePrice: balancePrice,
        currentPrice: finalCurrentPrice,
      });
    });

    return assets;
  }

    /**
     * Построение карты целевых долей из основного листа (QUIK).
     *
     * Читает колонки:
     *   "Инструмент" → ticker (из "Код工具"/"Код инструмента"/"Код")
     *   "Целевая доля, %" → targetPercent
     *
     * Возвращает Record< tickerUpper, targetPercent | undefined >
     *   undefined → target отсутствует в Excel
     *   0 → явный target 0 (EXIT)
     *   15 → целевая доля 15%
     */
    private async parseTargetMapFromMainSheet(): Promise<Record<string, number | undefined>> {
      await this.loadWorkbook();
      if (!this.workbook) return {};

      const sheetName = this.workbook?.SheetNames.find(
        (name) => name === config.QUIK_SHEET_NAME,
      );
      if (!sheetName || !this.workbook) return {};

      const sheet = this.workbook.Sheets[sheetName];
      if (!sheet || !sheet['!ref']) return {};

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const targetMap: Record<string, number | undefined> = {};

      for (const row of rows) {
        const name = String(row['Инструмент'] || '').trim();
        if (
          !name ||
          config.EXCLUDED_ROW_KEYWORDS.some((kw) => name.toUpperCase().includes(kw))
        )
          continue;
        if (name.startsWith('-') || !isNaN(Number(name)) || name.length > 30)
          continue;
        if (config.FREE_CASH_ROW_KEYWORDS.some((kw) => name === kw)) continue;

        const ticker = String(
          row['Код工具'] || row['Код инструмента'] || row['Код'] || '',
        ).trim().toUpperCase();
        if (!ticker) continue;

        // Читаем ТОЛЬКО из колонки "Целевая доля, %" — не используем parseValue
        // чтобы различать 0 и undefined
        const targetRaw = row['Целевая доля, %'] ?? row['Target Percent'] ?? row['S'];
        let targetPct = this.parseOptionalTargetPercent(targetRaw);

        // Excel хранит дроби (0.15), конвертируем в проценты (15)
        // 0 остаётся 0 (EXIT), undefined остаётся undefined
        if (targetPct !== undefined && targetPct > 0 && targetPct <= 1) {
          targetPct = Math.round(targetPct * 100 * 100) / 100;
        }

        targetMap[ticker] = targetPct;
      }

      return targetMap;
    }

    /**
      * Парсинг позиций по каждому счёту из отдельных листов "Портфель_XXX"
      * Возвращает мапу: тикер → агрегированная позиция с детализацией по счетам
      *
      * КРИТИЧЕСКОЕ ПРАВИЛО: проценты НЕ складываются!
      * Сначала агрегируем liquidationValue (руб.), затем пересчитываем проценты.
      *
      * Пример:
      *   IIS:   PLZL = 100 000 ₽, IIS total = 500 000 ₽  → 20%
      *   BROKER: PLZL = 100 000 ₽, BROKER total = 1 000 000 ₽ → 10%
      *   ИТОГО:  PLZL = 200 000 ₽, Portfolio total = 1 500 000 ₽ → 13.33%
      *   НЕ 20% + 10% = 30%!
      */
     public async parseAggregatedPortfolio(): Promise<AggregatedAsset[]> {
       await this.loadWorkbook();
       if (!this.workbook) return [];

       const workbook = this.workbook;

       // 0. Строим карту целевых долей из основного листа (QUIK)
       const targetMap = await this.parseTargetMapFromMainSheet();

       const accountsMap = new Map<string, { code: string; type: 'IIS' | 'BROKER' }>();

     // 1. Собираем список счетов из листов "Портфель_XXX"
     const portfolioSheets = workbook.SheetNames.filter(
       (name) => name.toUpperCase().startsWith('ПОРТФЕЛЬ_') || name.toUpperCase().startsWith('ПОРТФ.')
     );

     portfolioSheets.forEach((sheetName) => {
       const underscoreIdx = sheetName.indexOf('_');
       if (underscoreIdx < 0) return;
       const accountCode = sheetName.substring(underscoreIdx + 1).trim();
       if (!accountCode || !/^[A-Z0-9]{5,7}$/i.test(accountCode)) return;

       const accountType = PortfolioConfig.accountTypeMapping[accountCode as keyof typeof PortfolioConfig.accountTypeMapping];
       accountsMap.set(accountCode, {
         code: accountCode,
         type: accountType === 'IIS' ? 'IIS' : 'BROKER',
       });
     });

       // 2. Парсим позиции по каждому счёту, собираем AccountPosition[]
        const tickerMap = new Map<string, {
          ticker: string;
          name: string;
          assetType: string;
          totalLiquidationValue: number;
          totalQuantity: number;
          totalBalanceValue: number;
          totalUnrealizedProfitRub: number;
          balancePrice: number;
          currentPrice: number;
          dynamicsPercent: number;
          dailyDynamicsPercent?: number;
          nkdRub?: number;
          nominal?: number;
          priceUnit?: PriceUnit;
          targetPercentValues: Set<number | undefined>;
          holdOnly: boolean;
          excludeFromStockPool: boolean;
          accounts: AccountPosition[];
        }>();

     for (const [accountCode, accountInfo] of accountsMap) {
       // Ищем лист с этим кодом счёта
       const sheetName = portfolioSheets.find(
         (s) => {
           const idx = s.indexOf('_');
           if (idx < 0) return false;
           const code = s.substring(idx + 1).trim().toUpperCase();
           return code === accountCode.toUpperCase();
         }
       );
       if (!sheetName) continue;

       const sheet = workbook.Sheets[sheetName];
       if (!sheet || !sheet['!ref']) continue;

        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

          // Шаг 1: агрегируем строки по (accountId, ticker) внутри одного счёта
          // чтобы избежать дубликатов одного тикера на одном счёте
          const localTickerAgg = new Map<string, {
            name: string;
            assetType: string;
            liqPercent: number;
            balPercent: number;
            targetPct: number | undefined;
            nkd: number;
            quantity: number;
            balancePrice: number;
            balanceValue: number;
            currentPrice: number;
            unrealizedProfit: number;
            dynamicsPercent: number;
            liquidationValue: number;
            holdOnly: boolean;
            excludeFromStockPool: boolean;
            nominal: number | undefined;
            priceUnit: PriceUnit;
          }>();

        for (const row of rows) {
          const name = String(row['Инструмент'] || '').trim();
          if (
            !name ||
            config.EXCLUDED_ROW_KEYWORDS.some((kw) =>
              name.toUpperCase().includes(kw),
            )
          )
            continue;
          if (name.startsWith('-') || !isNaN(Number(name)) || name.length > 30)
            continue;

          const liqPercent = this.parseValue(
            row['%, активов'] ||
              row['%, активов, по ликвидационной стоимости'] ||
              row['Доля'],
          );
          const balPercent = this.parseValue(
            row['%, активов, по балансовой стоимости'] || row['%, активов'],
          );
           const targetPct = this.parseOptionalTargetPercent(
             row['Target Percent'] || row['Целевая доля, %'] || row['S'],
           );
          const nkd = this.parseValue(row['НКД'] || row['Накопленный купон']);
          const quantity = this.parseValue(
            row['Позиция'] ||
              row['Кол-во'] ||
              row['Количество'] ||
              row['Кол'] ||
              0,
          );
           const balancePrice = this.parseValue(row['Балансовая цена']);
           const balanceValue = this.parseValue(
             row['Балансовая стоимость'] || row['Стоимость'],
           );
           const currentPrice = this.parseValue(row['Ликвидационная цена']);
          const unrealizedProfit = this.parseValue(
            row['Нереализованная прибыль'],
          );
          const dynamicsPercent = this.parseValue(row['Динамика актива']);
          const ticker = String(
            row['Код工具'] || row['Код инструмента'] || row['Код'] || '',
          ).trim();
          const assetType = String(
            row['Вид активов'] || row['Тип'] || '',
          ).trim();

          // Парсим номинал динамически из колонки «Номинал»
          const rowNominal = this.parseNominalFromRow(row);

          // Определяем priceUnit на основе типа актива и наличия номинала
          const rowPriceUnit = this.determinePriceUnit(assetType, rowNominal);

          // Для облигаций с неизвестным номиналом НЕ подставляем 1000
          let rowCurrentPrice = currentPrice;
          if (rowPriceUnit === 'UNKNOWN') {
            rowCurrentPrice = 0;
          } else if (rowPriceUnit === 'PERCENT_OF_NOMINAL' && rowNominal !== undefined && rowNominal > 0) {
            rowCurrentPrice = currentPrice * rowNominal / 100;
          }

          const holdOnly = this.parseBooleanColumn(row, [
            config.QUIK_COLUMN_HOLD_ONLY,
            config.QUIK_COLUMN_HOLD_ONLY_ALT1,
            config.QUIK_COLUMN_HOLD_ONLY_ALT2,
            config.QUIK_COLUMN_HOLD_ONLY_ALT3,
          ]);
          const excludeFromStockPool = this.parseBooleanColumn(row, [
            config.QUIK_COLUMN_EXCLUDE_STOCK_POOL,
            config.QUIK_COLUMN_EXCLUDE_STOCK_POOL_ALT1,
            config.QUIK_COLUMN_EXCLUDE_STOCK_POOL_ALT2,
            config.QUIK_COLUMN_EXCLUDE_STOCK_POOL_ALT3,
          ]);

          // Ликвидационная стоимость:
          //   1. Приоритет — готовая колонка «Ликвидационная стоимость» из Excel
          //   2. Fallback — цена × количество (только когда колонка отсутствует)
          const explicitLiqValue = this.parseValue(
            row['Ликвидационная стоимость'] ||
              row['Стоимость'] ||
              row['Балансовая стоимость'],
          );
          const liqValue = explicitLiqValue > 0 ? explicitLiqValue : currentPrice * quantity;

          const tickerKey = ticker.toUpperCase();
          const key = `${accountCode}::${tickerKey}`;

          if (localTickerAgg.has(key)) {
            const existing = localTickerAgg.get(key)!;
            existing.quantity += quantity;
            existing.balanceValue += balanceValue;
            existing.unrealizedProfit += unrealizedProfit;
            existing.liquidationValue += liqValue;
            // OR-логика
            existing.holdOnly = existing.holdOnly || holdOnly;
            existing.excludeFromStockPool =
              existing.excludeFromStockPool || excludeFromStockPool;
            // Берём targetPct/nominal/priceUnit из первой непустой строки
            if (existing.targetPct === undefined && targetPct !== undefined) {
              existing.targetPct = targetPct;
            } else if (existing.targetPct === 0 && targetPct !== undefined && targetPct > 0) {
              existing.targetPct = targetPct;
            }
            if (existing.nominal === undefined && rowNominal !== undefined) {
              existing.nominal = rowNominal;
            }
            if (existing.priceUnit === 'UNKNOWN' && rowPriceUnit !== 'UNKNOWN') {
              existing.priceUnit = rowPriceUnit;
            }
          } else {
            localTickerAgg.set(key, {
              name,
              assetType,
              liqPercent,
              balPercent,
              targetPct,
              nkd,
              quantity,
              balancePrice,
              balanceValue,
              currentPrice: rowCurrentPrice,
              unrealizedProfit,
              dynamicsPercent,
              liquidationValue: liqValue,
              holdOnly,
              excludeFromStockPool,
              nominal: rowNominal,
              priceUnit: rowPriceUnit,
            });
          }
        }

        // Шаг 2: создаём AccountPosition из агрегированных данных и добавляем в tickerMap
        for (const [key, agg] of localTickerAgg) {
          const parts = key.split('::');
          const ticker = parts[1];
          const tickerKey = ticker.toUpperCase();

            const accPos: AccountPosition = {
              accountId: accountCode,
              accountType: accountInfo.type,
              liquidationValue: agg.liquidationValue,
              liquidationPercent: agg.liqPercent,
              balancePercent: agg.balPercent > 0 ? agg.balPercent : agg.liqPercent,
              targetPercent: agg.targetPct,
              quantity: agg.quantity,
              balancePrice: agg.balancePrice,
              balanceValue: agg.balanceValue,
              currentPrice: agg.currentPrice,
              unrealizedProfitRub: agg.unrealizedProfit,
              dynamicsPercent: agg.dynamicsPercent,
              nkdRub: agg.nkd,
              nominal: agg.nominal,
              priceUnit: agg.priceUnit,
              holdOnly: agg.holdOnly,
              excludeFromStockPool: agg.excludeFromStockPool,
            };

          if (tickerMap.has(tickerKey)) {
            const existing = tickerMap.get(tickerKey)!;
            existing.totalLiquidationValue += accPos.liquidationValue;
            existing.totalQuantity += accPos.quantity;
            existing.totalBalanceValue += accPos.balanceValue;
            existing.totalUnrealizedProfitRub += accPos.unrealizedProfitRub;
            existing.targetPercentValues.add(accPos.targetPercent);
            existing.holdOnly = existing.holdOnly || accPos.holdOnly === true;
            existing.excludeFromStockPool =
              existing.excludeFromStockPool ||
              accPos.excludeFromStockPool === true;
            existing.accounts.push(accPos);
          } else {
            tickerMap.set(tickerKey, {
              ticker: tickerKey,
              name: agg.name,
              assetType: agg.assetType,
              totalLiquidationValue: accPos.liquidationValue,
              totalQuantity: accPos.quantity,
              totalBalanceValue: accPos.balanceValue,
              totalUnrealizedProfitRub: accPos.unrealizedProfitRub,
              balancePrice: agg.balancePrice,
              currentPrice: agg.currentPrice,
              dynamicsPercent: agg.dynamicsPercent,
              nkdRub: agg.nkd,
              nominal: accPos.nominal,
              priceUnit: accPos.priceUnit,
              targetPercentValues: new Set([agg.targetPct]),
              holdOnly: accPos.holdOnly === true,
              excludeFromStockPool: accPos.excludeFromStockPool === true,
              accounts: [accPos],
            });
          }
        }
      }

     // 3. Считаем ОБЩУЮ ликвидационную стоимость всего портфеля
     let totalPortfolioLiqValue = 0;
     for (const asset of tickerMap.values()) {
       totalPortfolioLiqValue += asset.totalLiquidationValue;
     }

     // 4. Пересчитываем проценты из агрегированных liquidationValue
     const result: AggregatedAsset[] = [];

      for (const asset of tickerMap.values()) {
        // Правильный пересчёт: totalLiqValue / totalPortfolioLiqValue * 100
        const totalLiquidationPercent = totalPortfolioLiqValue > 0
          ? Math.round((asset.totalLiquidationValue / totalPortfolioLiqValue) * 100 * 100) / 100
          : 0;

        // Аналогично для balancePercent — собираем balanceValue из accounts
        let totalBalanceValue = 0;
        for (const acc of asset.accounts) {
          totalBalanceValue += acc.balancePercent > 0
            ? acc.balancePercent * acc.liquidationValue / (acc.liquidationPercent > 0 ? acc.liquidationPercent : 1)
            : acc.liquidationValue;
        }
        const totalBalancePercent = totalPortfolioLiqValue > 0
          ? Math.round((totalBalanceValue / totalPortfolioLiqValue) * 100 * 100) / 100
          : 0;

        // averageBalancePrice = SUM(balanceValue) / SUM(quantity)
        // balanceValue берётся из Excel колонки «Балансовая стоимость»
        // Округляем до 2 знаков после запятой
        const averageBalancePrice = asset.totalQuantity > 0
          ? Math.round((asset.totalBalanceValue / asset.totalQuantity) * 100) / 100
          : 0;

        // Обработка targetPercent
          // Приоритет: targetMap из основного листа > account sheets
          //
          // undefined + undefined → undefined (TARGET_NOT_SET)
          // 15 + 15 → 15 (совпадение)
          // 15 + 8 → undefined + conflict (TARGET_CONFLICT)
          const targetValues = Array.from(asset.targetPercentValues);
          const definedTargets = targetValues.filter((v) => v !== undefined);
          let targetPercent: number | undefined;
          let targetPercentConflict: boolean;

          // 1. Проверяем targetMap из основного листа (QUIK sheet)
          const mainSheetTarget = targetMap[asset.ticker];

          if (mainSheetTarget !== undefined) {
            // Target найден в основном листе → используем его
            targetPercent = mainSheetTarget;
            targetPercentConflict = false;
          } else if (definedTargets.length === 0) {
            // Target отсутствует и в основном листе, и на счетах → TARGET_NOT_SET
            targetPercent = undefined;
            targetPercentConflict = false;
          } else if (definedTargets.length === 1 && targetValues.length === 1) {
            // Одинаковый target на всех счетах (но нет в основном листе)
            targetPercent = definedTargets[0];
            targetPercentConflict = false;
          } else if (definedTargets.length > 1) {
            // КОНФЛИКТ: разные target на разных счетах
            targetPercentConflict = true;
            targetPercent = undefined;

           const accountDetails = asset.accounts.map((a) =>
             `${a.accountId}(${a.accountType}): ${a.targetPercent}`
           ).join(', ');
           console.warn(
             `⚠️ [AGGREGATE] TARGET_CONFLICT: ticker=${asset.ticker}, ` +
             `targets=[${definedTargets.join(', ')}], details=[${accountDetails}]`,
           );
         } else {
           // definedTargets.length === 1, но targetValues.length > 1
           // Например: один счёт имеет target=15, другой — undefined
           targetPercent = definedTargets[0];
           targetPercentConflict = false;
         }

         result.push({
           ticker: asset.ticker,
           name: asset.name,
           assetType: asset.assetType,
           totalLiquidationValue: asset.totalLiquidationValue,
           totalLiquidationPercent,
           totalBalancePercent,
           targetPercent,
           totalQuantity: asset.totalQuantity,
           balancePrice: averageBalancePrice,
           currentPrice: asset.currentPrice,
           totalUnrealizedProfitRub: asset.totalUnrealizedProfitRub,
           dynamicsPercent: asset.dynamicsPercent,
           nkdRub: asset.nkdRub,
           nominal: asset.nominal,
           priceUnit: asset.priceUnit,
           totalBalanceValue: asset.totalBalanceValue,
           holdOnly: asset.holdOnly,
           excludeFromStockPool: asset.excludeFromStockPool,
           targetPercentConflict,
           accounts: asset.accounts,
         });
     }

     return result;
   }

  /**
    * Преобразует агрегированный портфель в массив CurrentAsset
    * для совместимости с существующей бизнес-логикой
    *
    * Использует ПРАВИЛЬНО пересчитанные totalLiquidationPercent
    * из parseAggregatedPortfolio(), а не суммирует проценты счетов.
    */
   public aggregatedToCurrentAssets(aggregated: AggregatedAsset[]): CurrentAsset[] {
     return aggregated.map((agg) => {
       const totalQty = agg.totalQuantity;

       // accountId: для агрегированного портфеля не используем формат "A,B"
       // Если позиция на одном счёте — берём его ID, иначе undefined
       const accountId = agg.accounts.length === 1
         ? agg.accounts[0].accountId
         : undefined;

       const accountType = agg.accounts.length === 1
         ? agg.accounts[0].accountType
         : undefined;

          return {
            name: agg.name,
            ticker: agg.ticker,
            assetType: agg.assetType,
            targetPercent: agg.targetPercent,
            liquidationPercent: agg.totalLiquidationPercent,
            balancePercent: agg.totalBalancePercent,
            unrealizedProfitRub: agg.totalUnrealizedProfitRub,
            dynamicsPercent: agg.dynamicsPercent,
            dailyDynamicsPercent: agg.dailyDynamicsPercent,
            nkdRub: agg.nkdRub,
            nominal: agg.nominal,
            priceUnit: agg.priceUnit,
            quantity: totalQty,
            balancePrice: agg.balancePrice,
            currentPrice: agg.currentPrice,
            accountId,
            accountType,
            holdOnly: agg.holdOnly || false,
            excludeFromStockPool: agg.excludeFromStockPool || false,
            targetPercentConflict: agg.targetPercentConflict || false,
          };
      });
    }

  /**
   * Парсинг листа "Акции" — котировки всех акций Московской биржи.
   * Структура таблицы:
   *   L: Код инструмента (тикер: SELG, PLZL, SBER...)
   *   M: Инструмент сокр. (Селигдар, Полюс, Сбербанк...)
   *   O: Цена послед.
   *   Q: % измен.закр.
   * Возвращает мапу: тикер -> { currentPrice, dailyDynamicsPercent }
   */
  public async parseQuotesSheet(): Promise<Record<string, { currentPrice: number; dailyDynamicsPercent: number; shortName: string }>> {
    await this.loadWorkbook();
    const quotesMap: Record<string, { currentPrice: number; dailyDynamicsPercent: number; shortName: string }> = {};
    const nameToTicker: Record<string, string> = {};

    const sheetName = this.workbook?.SheetNames.find(
      (name) => name === config.QUOTES_SHEET_NAME,
    );
    if (!sheetName || !this.workbook) return quotesMap;

    const sheet = this.workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) return quotesMap;

    const range = XLSX.utils.decode_range(sheet['!ref']);

    // 1. Находим строку с заголовками и столбцы
    let headerRow = -1;
    let tickerCol = -1;        // "Код инструмента"
    let nameCol = -1;          // "Инструмент сокр."
    let priceCol = -1;         // "Цена послед."
    let dynamicsCol = -1;      // "% измен.закр."

    for (let r = range.s.r; r <= Math.min(range.e.r, 10); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v === undefined) continue;
        const val = String(cell.v).trim().toLowerCase();

        if (val === 'код инструмента') {
          tickerCol = c;
          headerRow = r;
        }
        if (val.includes('инструмент сокр') || val === 'инструмент') {
          nameCol = c;
          headerRow = r;
        }
        if (val.includes('цена послед')) {
          priceCol = c;
          headerRow = r;
        }
        if (val.includes('% изм') || val.includes('% измен')) {
          dynamicsCol = c;
          headerRow = r;
        }
      }
    }

    if (headerRow < 0) {
      console.warn('⚠️ [QUOTES] Заголовки таблицы не найдены на листе "Акции"');
      return quotesMap;
    }

    // 2. Читаем данные начиная со строки после заголовков
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      // Тикер из столбца "Код инструмента"
      const tickerCell = sheet[XLSX.utils.encode_cell({ r, c: tickerCol })];
      if (!tickerCell || tickerCell.v === undefined) continue;
      const ticker = String(tickerCell.v).trim().toUpperCase();
      if (!ticker || ticker.length < 2) continue;

      // Название из столбца "Инструмент сокр."
      let rawName = '';
      if (nameCol >= 0) {
        const nameCell = sheet[XLSX.utils.encode_cell({ r, c: nameCol })];
        if (nameCell && nameCell.v !== undefined) {
          rawName = String(nameCell.v).trim();
        }
      }
      const cleanName = rawName
        .replace(/\s+/g, ' ')
        .trim();

      // Текущая цена
      let currentPrice = 0;
      if (priceCol >= 0) {
        const priceCell = sheet[XLSX.utils.encode_cell({ r, c: priceCol })];
        if (priceCell && priceCell.v !== undefined) {
          currentPrice = this.parseValue(priceCell.v);
        }
      }

      // Дневная динамика
      let dailyDynamicsPercent = 0;
      if (dynamicsCol >= 0) {
        const dynamicsCell = sheet[XLSX.utils.encode_cell({ r, c: dynamicsCol })];
        if (dynamicsCell && dynamicsCell.v !== undefined) {
          dailyDynamicsPercent = this.parseValue(dynamicsCell.v);
          // Фильтр аномальных значений (лимит Мосбиржи 20%, ставим 25% с запасом)
          if (dailyDynamicsPercent > 25 || dailyDynamicsPercent < -25) {
            dailyDynamicsPercent = 0;
          }
        }
      }

      quotesMap[ticker] = { currentPrice, dailyDynamicsPercent, shortName: cleanName };

      // Маппим название → тикер для fuzzy-поиска
      if (cleanName) {
        nameToTicker[cleanName.toUpperCase()] = ticker;
      }
    }

    // Сохраняем nameToTicker для fuzzy-поиска
    this.nameToTickerMap = nameToTicker;

    return quotesMap;
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
      // Заменяем русскую запятую на точку для десятичных дробей
      let normalized = val.replace(',', '.');
      // Удаляем пробелы (разделители тысяч) и символ рубля
      normalized = normalized.replace(/\s/g, '').replace('₽', '').replace('руб', '');
      const parsed = parseFloat(normalized);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  /**
   * Парсинг целевой доли с различением undefined и 0.
   *
   *   undefined / null / '' → undefined (target не указан в Excel)
   *   0 → 0 (target явно равен нулю → EXIT)
   *   15 → 15 (обычная целевая доля)
   */
  private parseOptionalTargetPercent(val: unknown): number | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'number') {
      // NaN → undefined, 0 → 0, 15 → 15
      return isNaN(val) ? undefined : val;
    }
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed === '') return undefined;
      const normalized = trimmed.replace(',', '.');
      const parsed = parseFloat(normalized);
      if (isNaN(parsed)) return undefined;
      return parsed;
    }
    return undefined;
  }

  /**
   * Поиск значения в строке Excel по нескольким возможным именам столбцов.
   * Возвращает значение первого найденного столбца или undefined.
   */
  private findColumnValue(
    row: Record<string, unknown>,
    columnNames: string[],
  ): unknown {
    for (const name of columnNames) {
      if (row[name] !== undefined && row[name] !== null) {
        return row[name];
      }
    }
    // Fallback: case-insensitive поиск
    const rowKeys = Object.keys(row);
    for (const name of columnNames) {
      const found = rowKeys.find(
        (k) => k.toLowerCase().trim() === name.toLowerCase().trim(),
      );
      if (found && row[found] !== undefined && row[found] !== null) {
        return row[found];
      }
    }
    return undefined;
  }

  /**
   * Парсинг булева значения из Excel-колонки по нескольким возможным именам.
   * Поддерживает: true/false, 1/0, TRUE/FALSE, да/нет, yes/no
   * Default: false если колонка отсутствует.
   */
  private parseBooleanColumn(
    row: Record<string, unknown>,
    columnNames: string[],
  ): boolean {
    const val = this.findColumnValue(row, columnNames);
    return this.parseBooleanValue(val);
  }

  /**
    * Безопасный парсинг булева значения.
    */
  private parseBooleanValue(val: unknown): boolean {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    if (typeof val !== 'string') return false;

    const normalized = val.trim().toLowerCase();
    const trueValues = ['true', '1', 'да', 'yes', 'y'];
    const falseValues = ['false', '0', 'нет', 'no', 'n'];

    if (trueValues.includes(normalized)) return true;
    if (falseValues.includes(normalized)) return false;

    return false;
  }

  /**
   * Динамический поиск колонки «Номинал» в строке Excel.
   * Возвращает значение номинала или undefined, если колонка отсутствует.
   */
  private parseNominalFromRow(row: Record<string, unknown>): number | undefined {
    const nominal = this.parseValue(
      row['Номинал'] || row['Номинал облигации'] || row['Номинал облигации, руб'] || 0,
    );
    return nominal > 0 ? nominal : undefined;
  }

  /**
   * Определение priceUnit для актива.
   * Для облигаций (assetType === 'О'):
   *   - nominal известен → 'PERCENT_OF_NOMINAL'
   *   - nominal неизвестен → 'UNKNOWN'
   * Для остальных (акции, ETF) → 'RUB'
   */
  private determinePriceUnit(
    assetType: string,
    nominal: number | undefined,
  ): PriceUnit {
    const isBond = assetType === 'О' || assetType === 'Облигация';
    if (!isBond) return 'RUB';
    if (nominal !== undefined && nominal > 0) return 'PERCENT_OF_NOMINAL';
    return 'UNKNOWN';
  }
}
