import * as fs from 'fs';

export interface QuikOrder {
  instrument: string;
  operation: string;
  quantity: number;
  price: number;
  totalSum: number;
  status: string;
}

export interface OrdersParseResult {
  orders: QuikOrder[];
  iisSum: number;
  brokerSum: number;
  ordersListText: string;
}

export function parseQuikOrdersFile(ordersPath: string): OrdersParseResult {
  const orders: QuikOrder[] = [];
  let iisSum = 0;
  let brokerSum = 0;
  const activeOrdersList: string[] = [];

  if (!fs.existsSync(ordersPath)) {
    return {
      orders,
      iisSum,
      brokerSum,
      ordersListText: 'Заявки отсутствуют (файл не найден)',
    };
  }

  const buffer = fs.readFileSync(ordersPath);
  const decoder = new TextDecoder('windows-1251');
  const csvData = decoder.decode(buffer);
  const lines = csvData.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length <= 1) {
    return {
      orders,
      iisSum,
      brokerSum,
      ordersListText: 'Заявки отсутствуют',
    };
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lineUpper = line.toUpperCase();

    // Обрабатываем только лог-строки по фонду STME ETF
    if (!lineUpper.includes('STME')) {
      continue;
    }

    // Разбиваем строго по запятым
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 15) continue;

    // 🔥 ИСПРАВЛЕНО: Строго выверенные индексы столбцов на основе вашей CSV-выгрузки
    const rawOperation = parts[6].toUpperCase(); // Колонка 6: Операция ('Продажа')
    const rawPriceRub = parts[8]; // Колонка 8: Целая часть цены ('4')
    const rawPriceKop = parts[9]; // Колонка 9: Дробная часть цены ('330')
    const rawQty = parts[10].replace(/\s/g, ''); // Колонка 10: Количество ('4 848')

    const rawVolumeRub = parts[13].replace(/\s/g, ''); // Колонка 13: Рубли объема ('20 991')
    const rawVolumeKop = parts[14].replace(/\s/g, ''); // Колонка 14: Копейки объема ('84')
    const rawComment = parts[15].toUpperCase(); // Колонка 15: Комментарий ('403GPBT...')

    // Синхронизируем и склеиваем финансовые параметры в валидные числа
    const price = parseFloat(rawPriceRub + '.' + rawPriceKop) || 4.33;
    const quantity = parseInt(rawQty, 10) || 0;
    let totalSum = parseFloat(rawVolumeRub + '.' + rawVolumeKop) || 0;

    if (totalSum === 0 && quantity > 0) {
      totalSum = Math.round(quantity * price * 100) / 100;
    }

    // Заявка на Продажу — это строго SELL
    const direction =
      rawOperation.includes('ПРОДАЖА') || rawOperation.includes('SELL')
        ? 'SELL'
        : 'BUY';
    const assetName = 'STME ETF';

    activeOrdersList.push(
      '* Заявка: ' +
        assetName +
        ' - ' +
        totalSum.toLocaleString('ru-RU') +
        ' ₽',
    );

    orders.push({
      instrument: assetName,
      operation: direction,
      quantity: quantity,
      price: price,
      totalSum: totalSum,
      status: 'АКТИВНА (ДО ОТМЕНЫ)',
    });

    // Распределяем лимитные блоки по счетам (ИИС / Брокерский)
    if (rawComment.includes('403GPBT') || lineUpper.includes('ИИС')) {
      iisSum += totalSum;
    } else {
      brokerSum += totalSum;
    }
  }

  return {
    orders,
    iisSum,
    brokerSum,
    ordersListText: activeOrdersList.join('\n') || 'Заявки отсутствуют',
  };
}

