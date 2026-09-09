import fs from 'fs';
import path from 'path';

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
 * Парсит русское число: "42 677,50" → 42677.50, "99,25" → 99.25
 */
function parseRussianNumber(val: string): number {
  if (!val) return 0;
  const clean = val.replace(/\s+/g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}

/**
 * Парсит целое число из строки (убирает всё кроме цифр)
 */
function parseIntFromStr(val: string): number {
  if (!val) return 0;
  const digits = val.replace(/[^0-9]/g, '');
  return parseInt(digits, 10) || 0;
}

/**
 * Динамический парсинг CSV-файла заявок QUIK
 * Учитывает, что QUIK использует запятую как разделитель дробной части в числах
 * (например: "99,25" → цена, "42 677,50" → объём)
 */
export function parseQuikOrdersFile(
  _instrumentMap?: Record<string, string>,
  customPath?: string,
): QuikOrder[] {
  const defaultPath = path.join('data', 'orders.csv');
  const targetPath = customPath || defaultPath;
  const parsedOrders: QuikOrder[] = [];

  if (!fs.existsSync(targetPath)) {
    console.warn(
      '⚠️ [Orders Parser]: Локальный файл экспорта QUIK заявок не найден: ' +
        targetPath,
    );
    return parsedOrders;
  }

  try {
    const fileBuffer = fs.readFileSync(targetPath);
    const decoder = new TextDecoder('windows-1251');
    const fileContent = decoder.decode(fileBuffer);

    const lines = fileContent.split(/\r?\n/);
    if (lines.length <= 1) return parsedOrders;

    // Парсим заголовки из первой строки
    const headers = lines[0]
      .split(/[;,]/)
      .map((h: string) => h.trim().toUpperCase());

    // Находим индексы нужных столбцов по заголовкам
    const colIndex: Record<string, number> = {};
    headers.forEach((h, idx) => {
      if (h.includes('НОМЕР') || h.includes('ID') || h === '№') colIndex.number = idx;
      if (h.includes('ИНСТРУМЕНТ') || h.includes('НАИМЕНОВАНИЕ')) colIndex.instrument = idx;
      if (h.includes('ОПЕРАЦИЯ') || h.includes('НАПРАВЛ')) colIndex.operation = idx;
      if (h.includes('ПЕРИОД')) colIndex.period = idx;
      if (h.includes('КОЛ')) colIndex.qty = idx;
      if (h.includes('ЦЕНА')) colIndex.price = idx;
      if (h.includes('СОСТОЯНИ') || h.includes('СТАТУС')) colIndex.status = idx;
    });

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Разделяем по запятой ИЛИ точке с запятой
      const rawFields = line.split(/[;,]/);

      // QUIK экспортирует числа в русском формате: "42 677,50"
      // Но запятая также используется как разделитель полей.
      // Решение: объединяем пары "целое + дробное" которые разделены запятой
      // два случая:
      // 1. "42 677" + "50" → "42 677,50" (разделитель тысяч)
      // 2. "99" + "25" → "99,25" (простая дробная часть)
      const fields: string[] = [];
      const rawToFieldMap: number[] = []; // rawToFieldMap[fieldIdx] = startRawIdx
      let rawIdx = 0;

      while (rawIdx < rawFields.length) {
        const val = rawFields[rawIdx].trim();
        let merged = false;

        // Проверяем, является ли это частью числа с разделителем тысяч
        if (!merged && rawIdx + 1 < rawFields.length && val.includes(' ')) {
          const nextVal = rawFields[rawIdx + 1].trim();
          if (/^\d{1,3}$/.test(nextVal)) {
            fields.push(val + ',' + nextVal);
            rawToFieldMap.push(rawIdx); // merge начинается с rawIdx
            rawIdx += 2;
            merged = true;
          }
        }

        // Проверяем простую дробную часть: "99" + "25" → "99,25"
        if (!merged && rawIdx + 1 < rawFields.length) {
          const nextVal = rawFields[rawIdx + 1].trim();
          if (
            /^\d{1,3}$/.test(val) &&
            /^\d{1,2}$/.test(nextVal) &&
            nextVal !== '0'
          ) {
            fields.push(val + ',' + nextVal);
            rawToFieldMap.push(rawIdx); // merge начинается с rawIdx
            rawIdx += 2;
            merged = true;
          }
        }

        if (!merged) {
          fields.push(val);
          rawToFieldMap.push(rawIdx); // не merge, rawIdx == fieldIdx
          rawIdx++;
        }
      }

      // Пересчитываем colIndex: для каждого столбца ищем, на какой позиции в fields он оказался
      const adjustedColIndex: Record<string, number> = {};
      Object.entries(colIndex).forEach(([key, origRawIdx]) => {
        // Ищем поле, которое началось с этого raw-индекса
        // Если точного совпадения нет, значит origRawIdx был частью merge-поля
        // В этом случае берём следующее поле после merge
        let fieldIdx = -1;
        for (let f = 0; f < rawToFieldMap.length; f++) {
          if (rawToFieldMap[f] === origRawIdx) {
            fieldIdx = f;
            break;
          }
        }
        // Если не нашли точное совпадение, ищем следующее поле после origRawIdx
        if (fieldIdx === -1) {
          for (let f = 0; f < rawToFieldMap.length; f++) {
            if (rawToFieldMap[f] > origRawIdx) {
              fieldIdx = f;
              break;
            }
          }
        }
        adjustedColIndex[key] = fieldIdx;
      });

      // Извлекаем значения по известным индексам столбцов
      const getVal = (key: string, fallback = '') => {
        const idx = adjustedColIndex[key];
        return idx !== undefined && idx < fields.length
          ? fields[idx].trim()
          : fallback;
      };

      const orderNumber = getVal('number');
      const rawInstrument = getVal('instrument');
      const rawOperation = getVal('operation').toLowerCase();
      const rawPeriod = getVal('period');
      const rawQty = getVal('qty');
      const rawPrice = getVal('price');

      // Статус ищем по содержанию во всех полях — это надёжнее
      let rawStatus = '';
      for (let ci = 0; ci < fields.length; ci++) {
        const candidate = fields[ci].trim().toUpperCase();
        if (
          candidate.includes('ИСПОЛН') ||
          candidate.includes('АКТИВН') ||
          candidate.includes('СНЯТА') ||
          candidate.includes('GTC')
        ) {
          rawStatus = fields[ci].trim();
          break;
        }
      }

      const statusUpper = rawStatus.toUpperCase();
      if (
        !rawInstrument ||
        orderNumber === '' ||
        orderNumber === '0' ||
        statusUpper.includes('ИНФО')
      ) {
        continue;
      }

      const qty = parseIntFromStr(rawQty);
      const price = parseRussianNumber(rawPrice);

      // Извлекаем чистое название инструмента из QUIK (без биржевых скобок)
      const ticker = rawInstrument
        .replace(/\[.*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Определяем, облигация это или акция — для корректного расчёта суммы
      // QUIK указывает цену облигаций в % от номинала (1000 руб), акции — в рублях
      const isBond = rawInstrument.toLowerCase().includes('облиг');
      const pricePerUnit = isBond ? price * 10 : price; // номинал 1000 / 100 = 10

      // Фильтруем заявки с нулевым количеством или ценой
      if (qty === 0 || price === 0) continue;

      const operation: 'BUY' | 'SELL' =
        rawOperation.includes('куп') || rawOperation.includes('buy')
          ? 'BUY'
          : 'SELL';
      const sum = Math.round(qty * pricePerUnit * 100) / 100;
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
        price: pricePerUnit,
        pricePercent: price,
        isBond,
        sum,
        status,
      });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      '❌ [Orders Parser Error]: Сбой динамического анализа кодировок:',
      msg,
    );
  }

  return parsedOrders;
}
