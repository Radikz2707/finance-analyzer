import { PortfolioConfig } from '../../../config/portfolio-config.js';
import { restoreLostPercentRanges } from './text-fixes.js';

describe('restoreLostPercentRanges', () => {
  it('восстанавливает «510%» → «5–10%» в контексте падения от текущей', () => {
    const result = restoreLostPercentRanges(
      'Следите за ценой: если облигация упадет на 510% от текущей — это точка входа.',
    );

    expect(result).toContain('5–10%');
    expect(result).not.toContain('510%');
  });

  it('восстанавливает «1020%» → «10–20%»', () => {
    const result = restoreLostPercentRanges(
      'Если цена снизится на 1020% от текущей, покупаем.',
    );

    expect(result).toContain('10–20%');
  });

  it.each([
    'При снижении на 510% от текущей — докупаем.',
    'Падение на 510% от текущей — это точка входа.',
    'Коррекция на 510% от цены — покупаем частями.',
    'Просадка на 510% — повод пересмотреть позицию.',
    'Если цена окажется на 510% ниже текущей, покупаем.',
  ])('чинит отглагольные формы и якорь после числа: %s', (text) => {
    const result = restoreLostPercentRanges(text);

    expect(result).toContain('5–10%');
    expect(result).not.toContain('510%');
  });

  it('не трогает «оборот вырос на 510%» — нет контекста движения цены', () => {
    const text = 'Оборот вырос на 510% за квартал.';
    expect(restoreLostPercentRanges(text)).toBe(text);
  });

  it('не трогает правдоподобный процент', () => {
    const text = 'Дивдоходность 12% (smart-lab.ru, 18.11.2026).';
    expect(restoreLostPercentRanges(text)).toBe(text);
  });

  it('не трогает число вне контекста движения цены', () => {
    const text = 'Оборот вырос на 510% за квартал.';
    expect(restoreLostPercentRanges(text)).toBe(text);
  });

  it('порог берётся из конфига (в тесте — другой)', () => {
    // При пороге 1000 значение 510% правдоподобно и не переписывается.
    const text = 'Если упадёт на 510% от текущей.';
    expect(restoreLostPercentRanges(text, 1000)).toBe(text);
    expect(PortfolioConfig.textFixes.maxPlausiblePct).toBe(100);
  });

  it('возвращает null для null', () => {
    expect(restoreLostPercentRanges(null)).toBeNull();
  });
});
