/**
 * Ремонт текста на слое рендера карточек.
 *
 * Проблема (найдена в дашборде): модель писала «упадёт на 5–10% от текущей»,
 * а в карточку попадало «упадёт на 510% от текущей» — разделитель диапазона
 * терялся. Это не переписывание смысла: восстанавливается только разбивка
 * слипшегося числа, и только в контексте «упадёт/снизится … от текущей».
 *
 * Принципы:
 * - не трогаем правдоподобные проценты (<= maxPlausiblePct);
 * - не трогаем числа вне контекста движения цены;
 * - если разбивка неоднозначна — оставляем как есть (fail-open для рендера,
 *   но с записью в лог только при реальном восстановлении).
 */

import { PortfolioConfig } from '../../../config/portfolio-config.js';

/**
 * Контекст, в котором число после «упадёт на …%» — это диапазон снижения.
 * Без этого якоря «510%» может быть легитимным значением другой метрики.
 *
 * Покрыты и глагольные, и отглагольные формы: модель пишет и «снизится»,
 * и «при снижении», и «падение», и «коррекция». Раньше существительные
 * не покрывались, поэтому в карточках ОФЗ/АЛРОСА/Брус/ВИС/ДелПорт
 * «510%» оставался, а в Газпромнефти (форма «снизится») чинился.
 */
const RANGE_CONTEXT =
  /(упадёт|упадет|упад[а-яё]*|снизится|снижени[а-яё]*|падени[а-яё]*|коррекци[а-яё]*|просядет|просадк[а-яё]*|от текущей|от цены|ниже текущей)/i;

/**
 * Восстановить потерянный разделитель диапазона в процентах.
 *
 * Пример: «упадёт на 510% от текущей» → «упадёт на 5–10% от текущей».
 * «упадёт на 1020% от текущей» → «10–20%».
 */
export function restoreLostPercentRanges(
  text: string | null | undefined,
  maxPlausiblePct: number = PortfolioConfig.textFixes.maxPlausiblePct,
): string | null {
  if (!text) return text ?? null;

  return text.replace(
    /(\d{3,4})\s*%/g,
    (match, digits: string, offset: number) => {
      // Контекст проверяется и до, и после числа: «510% ниже текущей»
      // задаёт якорь после процента, а не перед ним.
      const before = text.slice(Math.max(0, offset - 60), offset);
      const after = text.slice(
        offset + match.length,
        offset + match.length + 40,
      );
      if (!RANGE_CONTEXT.test(`${before} ${after}`)) return match;

      const value = Number(digits);
      if (!Number.isFinite(value) || value <= maxPlausiblePct) return match;

      // Делим ближе к середине: 4 цифры → 2+2, 3 цифры → 1+2.
      for (let split = Math.floor(digits.length / 2); split >= 1; split--) {
        const low = Number(digits.slice(0, split));
        const high = Number(digits.slice(split));
        if (
          Number.isFinite(low) &&
          Number.isFinite(high) &&
          low > 0 &&
          high > low &&
          high <= maxPlausiblePct
        ) {
          console.warn(
            `[CARD_TEXT_FIX] restored range "${digits}%" → "${low}–${high}%"`,
          );
          return `${low}–${high}%`;
        }
      }

      return match;
    },
  );
}
