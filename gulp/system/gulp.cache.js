import { execSync } from 'child_process';

let currentSig = '';

/**
 * Генерирует детерминированный отпечаток сборки без загрязнения global
 */
export function getBuildSignature() {
  if (currentSig) return currentSig;

  // Если мы в продакшене, пытаемся взять хэш последнего коммита Git
  if (process.env.NODE_ENV === 'production') {
    try {
      currentSig = execSync('git rev-parse --short HEAD').toString().trim();
      return currentSig;
    } catch {
      // ИСПРАВЛЕНО: Убран неиспользуемый аргумент (e)
    }
  }

  // Для дев-режима фиксируем один таймстамп на ВСЮ сессию работы сервера
  currentSig = String(Date.now());
  return currentSig;
}
