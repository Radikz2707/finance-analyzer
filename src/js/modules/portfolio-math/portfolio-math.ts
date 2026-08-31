// 1. ОПРЕДЕЛЕНИЕ БАЗОВЫХ ТИПОВ ДЛЯ ВАШИХ СУБСЧЕТОВ И КЛАССОВ АКТИВОВ
export type AccountType = 'brokerage' | 'iis';
export type AssetClass = 'stock' | 'bond';

// 2. СТРУКТУРА ОДНОЙ СТРОКИ АКТИВА (ПОЛНОСТЬЮ СОВПАДАЕТ С ВАШИМ ЕХСЕL-ЛИСТОМ)
export interface IAsset {
  instrument: string;       // Название (например: 'Сбербанк', 'Селигдар 10')
  position: number;         // Количество штук в наличии (Позиция)
  price: number;            // Текущая рыночная цена
  costValue: number;        // Балансовая стоимость (затраты: ~645 000 руб.)
  marketValue: number;      // Ликвидационная стоимость (рынок: ~500 000 руб.)
  assetClass: AssetClass;   // Класс актива (акция или облигация)
  accountType: AccountType; // С какого счета выгружена строка (Брокерский или ИИС)
}

// 3. ЖЕСТКИЕ ПРАВИЛА И ЛИМИТЫ ВАШЕЙ ИНВЕСТИЦИОННОЙ СТРАТЕГИИ
export const TARGET_STRATEGY = {
  allocation: {
    stock: 0.52, // Жесткая цель: 52% акции
    bond: 0.48   // Жесткая цель: 48% облигации
  },
  tickerLimits: {
    'Полюс': { maxShare: 0.199, type: 'strict-below' }, // Строго чуть меньше 20%
    'Сбербанк': { maxShare: 0.15, type: 'smooth-target' },
    'Татифт Зао': { maxShare: 0.15, type: 'smooth-target' }, // Татнефть из вашего листа
    'ИнтерРАОао': { maxShare: 0.15, type: 'smooth-target' },
    'КЦ ИКС 5': { maxShare: 0.15, type: 'smooth-target' },   // X5 Group из вашего листа
    'ѕГТЛК2P-14': { maxShare: 0.10, type: 'smooth-target' } // Целевая планка защитных облигаций 10%
  }
};

// 4. ГЛАВНАЯ ВХОДНАЯ ФУНКЦИЯ МОДУЛЯ (ВАШ БАЗОВЫЙ ИНИЦИАЛИЗАТОР)
export const portfolioMath = (): void => {
  console.log('🚀 Модуль portfolio-math (TS) успешно инициализирован');
  console.log('📊 Математические лимиты стратегии (52/48) успешно загружены в память');
};

// 5. РАСЧЕТ ОБЩЕГО БАЛАНСА ПОРТФЕЛЯ (АКЦИИ / ОБЛИГАЦИИ)
export interface IGlobalAllocation {
  stockValue: number; // Общая стоимость акций в рублях
  bondValue: number;  // Общая стоимость облигаций в рублях
  totalValue: number; // Вся ликвидационная стоимость портфеля (~500 000 руб.)
}

export function calculateGlobalAllocation(assets: IAsset[]): IGlobalAllocation {
  return assets.reduce(
    (acc, asset) => {
      // Суммируем рыночную стоимость текущего актива
      if (asset.assetClass === 'stock') {
        acc.stockValue += asset.marketValue;
      } else if (asset.assetClass === 'bond') {
        acc.bondValue += asset.marketValue;
      }

      // Считаем общий котел
      acc.totalValue += asset.marketValue;
      return acc;
    },
    { stockValue: 0, bondValue: 0, totalValue: 0 }
  );
}

// 6. СТРУКТУРА ОТЧЕТА О ДИСПАЛАНСЕ ВЕРХНЕГО УРОВНЯ
export interface IRebalanceDelta {
  currentShares: {
    stock: number; // Текущая доля акций (например, 0.595)
    bond: number;  // Текущая доля облигаций (например, 0.405)
  };
  actions: {
    stockDelta: number; // Сколько докинуть в акции (если минус — значит, перебор)
    bondDelta: number;  // Сколько докинуть в облигации
  };
}

export function calculateRebalanceDelta(allocation: IGlobalAllocation): IRebalanceDelta {
  const { stockValue, bondValue, totalValue } = allocation;

  // Если портфель пустой, отклонений нет
  if (totalValue === 0) {
    return {
      currentShares: { stock: 0, bond: 0 },
      actions: { stockDelta: 0, bondDelta: 0 }
    };
  }

  // 1. Считаем реальные доли здесь и сейчас
  const currentStockShare = stockValue / totalValue;
  const currentBondShare = bondValue / totalValue;

  // 2. Считаем, сколько рублей ДОЛЖНО быть в каждом классе по стратегии
  const targetStockValue = totalValue * TARGET_STRATEGY.allocation.stock; // total * 0.52
  const targetBondValue = totalValue * TARGET_STRATEGY.allocation.bond;   // total * 0.48

  // 3. Вычисляем разницу (Дельту) в рублях
  // Положительное число = нужно докупить. Отрицательное = перебор (замораживаем покупки).
  const stockDelta = targetStockValue - stockValue;
  const bondDelta = targetBondValue - bondValue;

  return {
    currentShares: {
      stock: Math.round(currentStockShare * 1000) / 1000, // Округляем до 3 знаков
      bond: Math.round(currentBondShare * 1000) / 1000
    },
    actions: {
      stockDelta: Math.round(stockDelta * 100) / 100, // Округляем до копеек
      bondDelta: Math.round(bondDelta * 100) / 100
    }
  };
}

// 7. СТРУКТУРА ОДНОГО АГРЕГИРОВАННОГО АКТИВА ДЛЯ СРАВНЕНИЯ С ЛИМИТАМИ
export interface IAssetAnalysis {
  instrument: string;
  totalMarketValue: number; // Сумма стоимости этой бумаги на Брокерском + ИИС
  currentShare: number;     // Доля от всего вашего капитала (~500 000 руб.)
  status: 'BLOCK' | 'BUY' | 'HOLD'; // Вердикт системы
  suggestedQuantityToBuy: number;  // Сколько ШТУК нужно докупить (строго на ИИС)
}

export function analyzeAssetLimits(assets: IAsset[], totalPortfolioValue: number): IAssetAnalysis[] {
  // 1. Схлопываем дубликаты ценных бумаг с разных счетов в один список
  const aggregatedMap: Record<string, { totalValue: number; singlePrice: number }> = {};

  assets.forEach(asset => {
    if (!aggregatedMap[asset.instrument]) {
      aggregatedMap[asset.instrument] = { totalValue: 0, singlePrice: asset.price };
    }
    aggregatedMap[asset.instrument].totalValue += asset.marketValue;
  });

  // 2. Проверяем каждую бумагу на соответствие правилам вашей стратегии
  return Object.keys(aggregatedMap).map(instrument => {
    const { totalValue, singlePrice } = aggregatedMap[instrument];
    const currentShare = totalPortfolioValue > 0 ? totalValue / totalPortfolioValue : 0;

    // Получаем лимиты из нашей константы стратегии (если они там прописаны)
    const limitConfig = TARGET_STRATEGY.tickerLimits[instrument as keyof typeof TARGET_STRATEGY.tickerLimits];

    let status: 'BLOCK' | 'BUY' | 'HOLD' = 'HOLD';
    let suggestedQuantityToBuy = 0;

    if (limitConfig) {
      if (limitConfig.type === 'strict-below' && currentShare >= limitConfig.maxShare) {
        // 🛑 ПРАВИЛО ПОЛЮСА: Если доля выше или равна 20% -> Жесткий блок покупки
        status = 'BLOCK';
      } else if (currentShare < limitConfig.maxShare) {
        // 🎯 ПРАВИЛО СБЕРА / ГТЛК: Если доля меньше целевой -> Сигнал к покупке
        status = 'BUY';

        // Вычисляем, сколько рублей не хватает до целевой доли
        const targetValue = totalPortfolioValue * limitConfig.maxShare;
        const rubleDelta = targetValue - totalValue;

        // Переводим рубли в точное количество ШТУК (округляем в меньшую сторону, чтобы не выйти за лимит)
        if (rubleDelta > 0 && singlePrice > 0) {
          suggestedQuantityToBuy = Math.floor(rubleDelta / singlePrice);
        }
      }
    }

    return {
      instrument,
      totalMarketValue: Math.round(totalValue * 100) / 100,
      currentShare: Math.round(currentShare * 1000) / 1000,
      status,
      suggestedQuantityToBuy: status === 'BUY' ? suggestedQuantityToBuy : 0
    };
  });
}
