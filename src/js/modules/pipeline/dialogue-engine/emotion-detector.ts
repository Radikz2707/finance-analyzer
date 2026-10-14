/**
 * EmotionDetector — определение эмоций реплики пользователя.
 *
 * Эвристика по лексике (без ML). Покрывает основные группы:
 * - positive: радость, благодарность, оптимизм;
 * - negative: недовольство, разочарование;
 * - concerned: тревога, опасение (часто по портфелю: «боюсь», «тревожно»);
 * - urgent: срочность («срочно», «немедленно», «быстрее»);
 * - neutral: всё остальное.
 *
 * Приоритет: urgent > concerned > negative > positive > neutral.
 * Модуль чистый — без Node-зависимостей.
 */

import type { DialogueEmotion } from './types.js';

// ──────────────────────────────────────────────
// 1. Лексика эмоций
// ──────────────────────────────────────────────

/** Слова позитивных эмоций */
const POSITIVE_PATTERNS: readonly RegExp[] = [
  /^(отлично|супер|класс|здорово|прекрасно|спасибо|благодар|круто|топ)\b/i,
  /рад[аоы]?\b|радост/i,
  /нравится|понравилось|доволен|довольна/i,
  /молодец|умница|хорошая работа|отличная работа/i,
  /(?:ура|yes|yay|🎉|😊|😀|👍)/i,
];

/** Слова негативных эмоций */
const NEGATIVE_PATTERNS: readonly RegExp[] = [
  /(?:плохо|ужасно|отвратительно|безобразно|кошмар)\b/i,
  /не нравится|недоволен|недовольна|разочарован/i,
  /злит|бесит|надоело|достало|отврат/i,
  /😡|😠|😞|😤/i,
];

/** Слова тревоги/опасения */
const CONCERNED_PATTERNS: readonly RegExp[] = [
  /боюсь|боишься|страшно|тревог|волну(?:ет|юсь|ешься)|пережива(?:ю|ешь)/i,
  /опасен|опасно|рискованно|неужели\s+всё\s+плохо|паника|паник/i,
  /убыт(?:ок|ки)|потеряю|потерять|провал|провалит/i,
  /😨|😱|😰|😥|😟/i,
];

/** Слова срочности */
const URGENT_PATTERNS: readonly RegExp[] = [
  /срочно|немедленно|быстрее|как можно скорее|urgent/i,
  /прямо сейчас|сейчас же|немедля/i,
  /🔥|⏰/i,
];

// ──────────────────────────────────────────────
// 2. Детектор
// ──────────────────────────────────────────────

/**
 * Определить эмоцию реплики по лексике.
 * Приоритет: urgent > concerned > negative > positive > neutral.
 */
export function detectEmotion(text: string): DialogueEmotion {
  const lower = (text ?? '').trim();
  if (lower === '') return 'neutral';

  if (matches(URGENT_PATTERNS, lower)) return 'urgent';
  if (matches(CONCERNED_PATTERNS, lower)) return 'concerned';
  if (matches(NEGATIVE_PATTERNS, lower)) return 'negative';
  if (matches(POSITIVE_PATTERNS, lower)) return 'positive';
  return 'neutral';
}

/** Проверить, соответствует ли текст хотя бы одному паттерну */
function matches(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Человекочитаемая метка эмоции (для UI/аудита) */
export function emotionLabel(emotion: DialogueEmotion): string {
  switch (emotion) {
    case 'positive':
      return '😊 позитив';
    case 'negative':
      return '😞 недовольство';
    case 'concerned':
      return '😟 тревога';
    case 'urgent':
      return '🔥 срочность';
    default:
      return '😐 нейтрально';
  }
}

/** Тон ответа для Директора в зависимости от эмоции (для LLM-промпта) */
export function emotionToneInstruction(emotion: DialogueEmotion): string {
  switch (emotion) {
    case 'concerned':
      return (
        'Пользователь тревожится: ответь спокойно, с эмпатией, приведи ' +
        'конкретные цифры и успокой фактами. Не добавляй тревожных формулировок.'
      );
    case 'urgent':
      return (
        'Пользователь просит срочно: ответь по делу, без воды, приведи ' +
        'решение/рекомендацию первым блоком.'
      );
    case 'negative':
      return (
        'Пользователь недоволен: признай проблему, объясни причину честно, ' +
        'предложи следующий шаг. Без оправданий.'
      );
    case 'positive':
      return 'Пользователь в хорошем настроении: поддерживай позитивный тон.';
    default:
      return 'Отвечай ровно, по делу, на русском языке.';
  }
}
