import { describe, it, expect } from 'vitest';
import { XlsxParserModule } from './xlsx-parser.js';

describe('Тестирование финансового парсера Excel', () => {
  it('Модуль XlsxParserModule должен успешно инициализироваться', () => {
    const parser = new XlsxParserModule();
    expect(parser).toBeDefined();
  });
});
