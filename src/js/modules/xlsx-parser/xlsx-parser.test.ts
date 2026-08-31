import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parsePortfolioExcel, EXCEL_FILE_PATH } from './xlsx-parser';

describe('Тестирование модуля автоматического парсинга xlsx-parser', () => {

  it('1. Физический файл Excel должен существовать по указанному пути', () => {
    // Проверяем, на месте ли ваш файл в папке Отчет
    const fileExists = fs.existsSync(EXCEL_FILE_PATH);
    expect(fileExists).toBe(true);
  });

  it('2. Должен успешно открывать реальный файл Excel и парсить ценные бумаги', () => {
    const assets = parsePortfolioExcel();

    // Проверяем, что парсер смог прочитать строки и массив не пустой
    expect(assets.length).toBeGreaterThan(0);

    // Ищем в прочитанных данных Полюс и Сбербанк для проверки точности
    const polyus = assets.find((a) => a.instrument === 'Полюс');
    const sber = assets.find((a) => a.instrument === 'Сбербанк');

    if (polyus) {
      console.log(`\n✅ [TEST]: Полюс успешно найден в файле! Цена: ${polyus.price} руб., Количество: ${polyus.position} шт.`);
      expect(polyus.assetClass).toBe('stock');
    }

    if (sber) {
      console.log(`\n✅ [TEST]: Сбербанк успешно найден в файле! Цена: ${sber.price} руб., Количество: ${sber.position} шт.`);
      expect(sber.assetClass).toBe('stock');
    }
  });
});
