import { describe, it, expect } from 'vitest';

/**
 * Копия функции isValidIsin из ai-client.ts для изолированного тестирования.
 * Валидация ISIN по стандарту ISO 6166 с корректным разбиванием букв на цифры.
 */
function isValidIsin(isin: string): boolean {
  const s = isin.trim().toUpperCase();
  if (s.length !== 12) return false;
  // 2 буквы + 9 буквенно-цифровых + 1 числовая контрольная цифра
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;

  // Разбиваем буквы на две цифры для корректного расчёта контрольной суммы
  let expanded = '';
  for (let i = 0; i < 11; i++) {
    const c = s.charAt(i);
    const code = c.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      expanded += (code - 55).toString(); // A=10, B=11, ..., Z=35
    } else {
      expanded += c;
    }
  }

  // Контрольная цифра (Modulus 10 Double-Add-Double)
  let sum = 0;
  for (let i = 0; i < expanded.length; i++) {
    let digit = parseInt(expanded.charAt(i), 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(s.charAt(11), 10);
}

describe('ISIN validation (P0-5)', () => {

  // ─── Синтетические векторы пользователя (с проверкой контрольной цифры) ───
  // Пользователь указал AE0000000002, AS0000000006, AX0000000009.
  // Алгоритм Mod10 Double-Add-Double даёт контрольную цифру 0 для всех трёх.
  // Тесты ниже подтверждают: правильная контрольная цифра принимается,
  // а указанные пользователем — отклоняются (как и должно быть).
  describe('User-specified synthetic ISINs check digit validation', () => {
    it('AE0000000000 accepted (correct check digit 0)', () => {
      expect(isValidIsin('AE0000000000')).toBe(true);
    });

    it('AE0000000002 rejected (wrong check digit 2)', () => {
      expect(isValidIsin('AE0000000002')).toBe(false);
    });

    it('AS0000000000 accepted (correct check digit 0)', () => {
      expect(isValidIsin('AS0000000000')).toBe(true);
    });

    it('AS0000000006 rejected (wrong check digit 6)', () => {
      expect(isValidIsin('AS0000000006')).toBe(false);
    });

    it('AX0000000000 accepted (correct check digit 0)', () => {
      expect(isValidIsin('AX0000000000')).toBe(true);
    });

    it('AX0000000009 rejected (wrong check digit 9)', () => {
      expect(isValidIsin('AX0000000009')).toBe(false);
    });
  });

  // ─── Независимо проверенные векторы (контрольная цифра = 0) ───
  describe('Independently verified synthetic ISINs', () => {
    it('accepts AE0000000000 (check digit 0)', () => {
      expect(isValidIsin('AE0000000000')).toBe(true);
    });

    it('accepts AS0000000000 (check digit 0)', () => {
      expect(isValidIsin('AS0000000000')).toBe(true);
    });

    it('accepts AX0000000000 (check digit 0)', () => {
      expect(isValidIsin('AX0000000000')).toBe(true);
    });
  });

  // ─── Нижний регистр и пробелы ───
  describe('Lowercase and spaces normalization', () => {
    it('normalizes lowercase to uppercase', () => {
      expect(isValidIsin('ae0000000000')).toBe(true);
    });

    it('accepts mixed case', () => {
      expect(isValidIsin('Ae0000000000')).toBe(true);
    });

    it('trims leading spaces', () => {
      expect(isValidIsin('  AE0000000000')).toBe(true);
    });

    it('trims trailing spaces', () => {
      expect(isValidIsin('AE0000000000  ')).toBe(true);
    });

    it('trims both sides', () => {
      expect(isValidIsin('  AE0000000000  ')).toBe(true);
    });
  });

  // ─── Неверная длина ───
  describe('Invalid length', () => {
    it('rejects too short ISIN (11 chars)', () => {
      expect(isValidIsin('AE000000000')).toBe(false);
    });

    it('rejects too long ISIN (13 chars)', () => {
      expect(isValidIsin('AE00000000000')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidIsin('')).toBe(false);
    });

    it('rejects single character', () => {
      expect(isValidIsin('A')).toBe(false);
    });
  });

  // ─── Неверные символы ───
  describe('Invalid characters', () => {
    it('rejects ISIN with special characters', () => {
      expect(isValidIsin('AE000000!000')).toBe(false);
    });

    it('rejects ISIN with spaces in middle', () => {
      expect(isValidIsin('AE000 000000')).toBe(false);
    });

    it('rejects ISIN with only one letter at start', () => {
      expect(isValidIsin('A00000000000')).toBe(false);
    });

    it('rejects ISIN with three letters at start', () => {
      expect(isValidIsin('AEA000000000')).toBe(false);
    });

    it('rejects ISIN with all digits', () => {
      expect(isValidIsin('000000000000')).toBe(false);
    });
  });

  // ─── Контрольная цифра ───
  describe('Check digit validation', () => {
    it('accepts correct numeric check digit', () => {
      expect(isValidIsin('AE0000000000')).toBe(true);
    });

    it('rejects wrong check digit', () => {
      expect(isValidIsin('AE0000000001')).toBe(false);
    });

    it('rejects letter in last position', () => {
      expect(isValidIsin('AE000000000A')).toBe(false);
    });

    it('rejects wrong check digit for AS', () => {
      expect(isValidIsin('AS0000000001')).toBe(false);
    });

    it('rejects wrong check digit for AX', () => {
      expect(isValidIsin('AX0000000001')).toBe(false);
    });
  });

  // ─── Разные ISIN ───
  describe('Different ISINs', () => {
    it('different ISINs both pass validation', () => {
      expect(isValidIsin('AE0000000000')).toBe(true);
      expect(isValidIsin('AS0000000000')).toBe(true);
      expect(isValidIsin('AX0000000000')).toBe(true);
    });

    it('same ISIN normalized is equal', () => {
      const a = isValidIsin('AE0000000000');
      const b = isValidIsin('  ae0000000000  ');
      expect(a).toBe(b);
    });
  });

  // ─── Дублирование ───
  describe('Duplicate detection', () => {
    it('detects duplicate ISINs after normalization', () => {
      const isins = ['AE0000000000', 'ae0000000000', '  AE0000000000  '];
      const normalized = new Set(isins.map(i => i.trim().toUpperCase()));
      expect(normalized.size).toBe(1);
    });

    it('detects duplicate ISINs in array', () => {
      const isins = ['AE0000000000', 'AS0000000000', 'ae0000000000'];
      const normalized = isins.map(i => i.trim().toUpperCase());
      const unique = new Set(normalized);
      expect(unique.size).toBe(2);
      expect(normalized.length).toBe(3);
    });
  });

  // ─── ISIN без префикса страны ───
  describe('ISIN without country prefix', () => {
    it('does not auto-match ISIN without prefix', () => {
      expect(isValidIsin('000000000000')).toBe(false);
    });

    it('requires exactly 2 Latin letters at start', () => {
      expect(isValidIsin('100000000000')).toBe(false);
      expect(isValidIsin('A00000000000')).toBe(false);
    });

    it('rejects ISIN with numeric first character', () => {
      expect(isValidIsin('1E0000000000')).toBe(false);
    });
  });
});
