import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

export interface QuikOrder {
  number: string;
  ticker: string;
  operation: 'BUY' | 'SELL';
  qty: number;
  price: number;
  pricePercent: number; // цена в % от номинала (для облигаций)
  isBond: boolean;
  sum: number;
  status: 'АКТИВНА' | 'ИСПОЛНЕНА' | 'СНЯТА' | 'GTC (ПЕРЕНОС)';
}

/**
 * Универсальный парсинг статуса заявки с учетом автоматического ночного клиринга GTC-приказов
 */
export function parseOrderStatus(
  rowStatus: string,
  periodType: string,
): 'АКТИВНА' | 'ИСПОЛНЕНА' | 'СНЯТА' | 'GTC (ПЕРЕНОС)' {
  const statusUpper = rowStatus.trim().toUpperCase();
  const periodUpper = periodType.trim().toUpperCase();

  if (statusUpper.includes('ИСПОЛН')) return 'ИСПОЛНЕНА';
  if (statusUpper.includes('АКТИВН')) return 'АКТИВНА';

  if (statusUpper.includes('СНЯТА')) {
    if (periodUpper.includes('ОТКРЫТ')) {
      return 'GTC (ПЕРЕНОС)';
    }
    return 'СНЯТА';
  }
  return 'СНЯТА';
}

/**
 * Парсит Excel-файл с текущими заявками QUIK
 */
export function parseQuikOrdersFile(
  _instrumentMap?: Record<string, string>,
  customPath?: string,
): QuikOrder[] {
  const defaultPath = process.env.QUIK_ORDERS_PATH;
  const targetPath = customPath || defaultPath;
  const parsedOrders: QuikOrder[] = [];

  if (!targetPath) {
    console.warn(
      '⚠️ [Orders Parser]: Путь к Excel-файлу не указан',
    );
    return parsedOrders;
  }

  try {
    const workbook = XLSX.readFile(targetPath);
    const sheetName = 'Текущие заявки';

    if (!workbook.SheetNames.includes(sheetName)) {
      console.warn(
        '⚠️ [Orders Parser]: Лист "' +
          sheetName +
          '" не найден в файле: ' +
          targetPath,
      );
      return parsedOrders;
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
    });

    if (rows.length <= 1) {
      return parsedOrders;
    }

    // Индексы столбцов по заголовкам (первая строка)
    const headers = rows[0].map((h: unknown) => String(h).trim().toUpperCase());

    const colIndex: Record<string, number> = {};
    headers.forEach((h: string, idx: number) => {
      if (h === 'НОМЕР' || h === 'ID' || h === '№') colIndex.number = idx;
      if (h === 'ИНСТРУМЕНТ' || h === 'НАИМЕНОВАНИЕ')
        colIndex.instrument = idx;
      if (h === 'ОПЕРАЦИЯ' || h === 'НАПРАВЛ') colIndex.operation = idx;
      if (h === 'ПЕРИОД') colIndex.period = idx;
      if (h.startsWith('КОЛ') && colIndex.qty === undefined)
        colIndex.qty = idx;
      if (h === 'ЦЕНА') colIndex.price = idx;
      if (h === 'СОСТОЯНИЕ' || h === 'СТАТУС') colIndex.status = idx;
      if (h === 'ОБЪЕМ') colIndex.sum = idx;
    });

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const getVal = (key: string, fallback = '') => {
        const idx = colIndex[key];
        if (idx === undefined || idx >= row.length) return fallback;
        return String(row[idx] ?? fallback).trim();
      };

      const orderNumber = getVal('number');
      const rawInstrument = getVal('instrument');
      const rawOperation = getVal('operation').toLowerCase();
      const rawPeriod = getVal('period');
      const rawQty = getVal('qty');
      const rawPrice = getVal('price');
      const rawSum = getVal('sum');
      const rawStatus = getVal('status');

      const statusUpper = rawStatus.toUpperCase();
      if (
        !rawInstrument ||
        orderNumber === '' ||
        orderNumber === '0' ||
        statusUpper.includes('ИНФО')
      ) {
        continue;
      }

      const qty = parseFloat(rawQty) || 0;
      const price = parseFloat(rawPrice) || 0;
      const sum = parseFloat(rawSum) || 0;

      // Извлекаем чистое название инструмента из QUIK (без биржевых скобок)
      const ticker = rawInstrument
        .replace(/\[.*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Определяем, облигация это или акция
      const isBond = rawInstrument.toLowerCase().includes('облиг');

      // Фильтруем заявки с нулевым количеством или ценой
      if (qty === 0 || price === 0) continue;

      const operation: 'BUY' | 'SELL' =
        rawOperation.includes('куп') || rawOperation.includes('buy')
          ? 'BUY'
          : 'SELL';

      // Используем сумму из Excel, если она есть
      const finalSum = sum > 0 ? sum : Math.round(qty * price * 100) / 100;
      const status = parseOrderStatus(rawStatus, rawPeriod);

      // Фильтруем: показываем только активные и исполненные заявки
      if (status === 'СНЯТА') {
        continue;
      }

      parsedOrders.push({
        number: orderNumber,
        ticker,
        operation,
        qty,
        price,
        pricePercent: price,
        isBond,
        sum: finalSum,
        status,
      });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      '❌ [Orders Parser Error]: Сбой чтения Excel-файла:',
      msg,
    );
  }

  return parsedOrders;
}
