import {
  formatCalendarDate,
  parseCalendarDate,
  parseRuDate,
} from './date-utils.js';

describe('date-utils — единый парсер календарных дат', () => {
  describe('parseRuDate / ДД.ММ.ГГГГ', () => {
    it('11.02.2027 — это 11 февраля, а не 2 ноября', () => {
      const date = parseRuDate('11.02.2027');

      expect(date).not.toBeNull();
      expect(formatCalendarDate(date)).toBe('2027-02-11');
      expect(date?.getUTCMonth()).toBe(1); // февраль
      expect(date?.getUTCDate()).toBe(11);
    });

    it('однозначные день и месяц: 1.3.2026', () => {
      expect(formatCalendarDate(parseRuDate('1.3.2026'))).toBe('2026-03-01');
    });

    it('несуществующая дата 31.02.2027 не превращается в 3 марта', () => {
      expect(parseRuDate('31.02.2027')).toBeNull();
    });

    it('ISO-строку не принимает как ДД.ММ.ГГГГ', () => {
      expect(parseRuDate('2027-02-11')).toBeNull();
    });
  });

  describe('parseCalendarDate', () => {
    it('строка ДД.ММ.ГГГГ разбирается как календарная дата', () => {
      expect(formatCalendarDate(parseCalendarDate('11.02.2027'))).toBe(
        '2027-02-11',
      );
    });

    it('ISO-строка остаётся тем же днём', () => {
      expect(formatCalendarDate(parseCalendarDate('2026-12-11'))).toBe(
        '2026-12-11',
      );
    });

    it('Excel serial: 25569 — это 1970-01-01', () => {
      expect(formatCalendarDate(parseCalendarDate(25569))).toBe('1970-01-01');
    });

    it('Date возвращается как есть', () => {
      const source = new Date(Date.UTC(2027, 1, 11));
      expect(parseCalendarDate(source)).toBe(source);
    });

    it('пустые и битые значения → null (fail-closed)', () => {
      expect(parseCalendarDate(undefined)).toBeNull();
      expect(parseCalendarDate(null)).toBeNull();
      expect(parseCalendarDate('')).toBeNull();
      expect(parseCalendarDate('   ')).toBeNull();
      expect(parseCalendarDate('не дата')).toBeNull();
      expect(parseCalendarDate(Number.NaN)).toBeNull();
      expect(parseCalendarDate(Number.POSITIVE_INFINITY)).toBeNull();
    });
  });

  describe('formatCalendarDate — без сдвига дня', () => {
    it('UTC-полночь 11.02.2027 не превращается в 10.02', () => {
      const date = new Date(Date.UTC(2027, 1, 11));
      expect(formatCalendarDate(date)).toBe('2027-02-11');
    });

    it('null/undefined/битая дата → null', () => {
      expect(formatCalendarDate(null)).toBeNull();
      expect(formatCalendarDate(undefined)).toBeNull();
      expect(formatCalendarDate(new Date('invalid'))).toBeNull();
    });

    it('round-trip: строка → дата → строка', () => {
      for (const iso of ['2026-01-01', '2027-02-11', '2030-12-31']) {
        expect(formatCalendarDate(parseCalendarDate(iso))).toBe(iso);
      }
    });
  });
});
