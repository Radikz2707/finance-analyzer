import { findCardDirectionConflicts } from './ai-validation.js';

describe('findCardDirectionConflicts', () => {
  it('ловит «Держать» с текстом о покупке (кейс IRAO)', () => {
    const conflicts = findCardDirectionConflicts('HOLD', [
      'Рекомендуется покупка по текущей цене.',
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('покупку при действии HOLD');
  });

  it('ловит STABLE с текстом о наращивании позиции', () => {
    const conflicts = findCardDirectionConflicts('STABLE', [
      null,
      'Позицию стоит наращивать частями.',
    ]);

    expect(conflicts).toHaveLength(1);
  });

  it('не считает конфликтом отрицание «не покупать» (кейс ОФЗ)', () => {
    const conflicts = findCardDirectionConflicts('AVOID', [
      'Не покупать. Держать до погашения.',
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it('ловит BUY с текстом о продаже', () => {
    const conflicts = findCardDirectionConflicts('BUY', [
      'Лучше продать часть позиции на росте.',
    ]);

    expect(conflicts).toHaveLength(1);
  });

  it('ловит REDUCE с текстом о покупке', () => {
    const conflicts = findCardDirectionConflicts('REDUCE', [
      'Докупать на просадке.',
    ]);

    expect(conflicts).toHaveLength(1);
  });

  it('возвращает пусто при отсутствии действия или текста', () => {
    expect(findCardDirectionConflicts(null, ['покупать'])).toHaveLength(0);
    expect(findCardDirectionConflicts('HOLD', [null, undefined])).toHaveLength(
      0,
    );
  });

  it('не трогает нейтральный текст при HOLD', () => {
    const conflicts = findCardDirectionConflicts('HOLD', [
      'Держать позицию, следить за отчётностью.',
    ]);

    expect(conflicts).toHaveLength(0);
  });

  it('HOLD + «Рекомендуется покупка при любой коррекции» + «Первая часть — немедленно»', () => {
    const conflicts = findCardDirectionConflicts('HOLD', [
      'Рекомендуется покупка при любой коррекции.',
      'Первая часть — немедленно.',
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('покупку при действии HOLD');
  });

  it('HOLD + «Первая часть — немедленно» без глагола — торговая директива', () => {
    const conflicts = findCardDirectionConflicts('HOLD', [
      'Первая часть — немедленно, вторая при отскоке.',
    ]);

    expect(conflicts).toHaveLength(1);
  });

  it('не считает конфликтом отрицание «Не покупать» при HOLD', () => {
    expect(
      findCardDirectionConflicts('HOLD', ['Не покупать, ждать отскока.']),
    ).toHaveLength(0);
  });

  it('BUY + «Рекомендуется продажа при любой коррекции» — конфликт', () => {
    const conflicts = findCardDirectionConflicts('BUY', [
      'Рекомендуется продажа части позиции при любой коррекции.',
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('продажу при действии BUY');
  });
});
