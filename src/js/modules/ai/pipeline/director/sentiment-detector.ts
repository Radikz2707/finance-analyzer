/**
 * SentimentDetector — определяет эмоциональное состояние пользователя
 * и адаптирует тон ответов Director.
 *
 * Анализирует:
 * - Эмоциональные маркеры (страх, радость, раздражение, спокойствие)
 * - Интенсивность (капс, множественные знаки вопроса/восклицания)
 * - Контекстные триггеры (убыток, риск, потеря, прибыль)
 *
 * Результаты используются для:
 * - Адаптации тона ответа (спокойный, поддерживающий, энтузиаст)
 * - Выбора эмодзи (уместно, не переборщить)
 * - Приоритизации ответов (если пользователь расстроен — быстрее и спокойнее)
 */

export type SentimentType = 'positive' | 'negative' | 'neutral' | 'anxious' | 'angry' | 'excited';

export interface SentimentResult {
  /** Основной тип настроения */
  sentiment: SentimentType;
  /** Интенсивность (0-1) */
  intensity: number;
  /** Определённые эмоции */
  emotions: string[];
  /** Рекомендации по тону ответа */
  toneAdvice: string;
  /** Уместные эмодзи */
  suggestedEmojis: string[];
}

/** Словарь эмоциональных маркеров */
const EMOTION_PATTERNS: Array<{
  pattern: RegExp;
  emotion: string;
  sentiment: SentimentType;
  intensity: number;
  emojis: string[];
}> = [
  // Страх/тревога
  {
    pattern: /боюсь|страх|нервничаю|паникую|тревожно|опасаюсь|пугаю|беспокоюсь/i,
    emotion: 'fear',
    sentiment: 'anxious',
    intensity: 0.8,
    emojis: ['😰', '🙏'],
  },
  // Раздражение/гнев
  {
    pattern: /злюсь|бешусь|достал|надоело|разочарован|недоволен|злой|бешеный|ааа|ugh|wtf/i,
    emotion: 'anger',
    sentiment: 'angry',
    intensity: 0.9,
    emojis: ['😤', '🤦'],
  },
  // Радость/энтузиазм
  {
    pattern: /рад|счастлив|отлично|замечательно|класс|супер|wow|wow|круто|восторг|прекрасно/i,
    emotion: 'joy',
    sentiment: 'positive',
    intensity: 0.7,
    emojis: ['😊', '🎉'],
  },
  // Потеря/убыток (триггер тревоги)
  {
    pattern: /убыток|потерял|минус|down|loss|провал|крах|обвал/i,
    emotion: 'loss',
    sentiment: 'negative',
    intensity: 0.75,
    emojis: ['😔', '💔'],
  },
  // Прибыль/успех
  {
    pattern: /прибыль|плюс|рост|profit|gain|успех|победа|record|топ/i,
    emotion: 'gain',
    sentiment: 'positive',
    intensity: 0.7,
    emojis: ['📈', '💰'],
  },
  // Уверенность
  {
    pattern: /уверен|точно|точно знаю|знаю что|твёрдо решил|решил/i,
    emotion: 'confidence',
    sentiment: 'positive',
    intensity: 0.6,
    emojis: ['💪', '✅'],
  },
  // Сомнение
  {
    pattern: /не уверен|хз|может быть|возможно|скорее всего|думаю|наверное|как бы/i,
    emotion: 'doubt',
    sentiment: 'neutral',
    intensity: 0.5,
    emojis: ['🤔', '💭'],
  },
];

/** Рекомендации по тону для каждого настроения */
const TONE_ADVICE: Record<SentimentType, { tone: string; emojis: string[]; advice: string }> = {
  positive: {
    tone: 'supportive',
    emojis: ['😊', '👍'],
    advice: 'Поддержите позитив, будьте энтузиастом, используйте лёгкие эмодзи',
  },
  negative: {
    tone: 'calm',
    emojis: ['😔'],
    advice: 'Будьте спокойны, проявите эмпатию, избегайте излишнего оптимизма',
  },
  neutral: {
    tone: 'professional',
    emojis: ['💼'],
    advice: 'Профессиональный тон, факты и цифры, минимум эмоций',
  },
  anxious: {
    tone: 'reassuring',
    emojis: ['😰', '🙏'],
    advice: 'Успокойте, дайте чёткий план действий, избегайте неопределённости',
  },
  angry: {
    tone: 'diplomatic',
    emojis: ['😤'],
    advice: 'Признайте чувства, будьте дипломатичны, предложите конкретные решения',
  },
  excited: {
    tone: 'enthusiastic',
    emojis: ['🎉', '🚀'],
    advice: 'Поддержите энтузиазм, но напомните о рисках',
  },
};

/** Интенсивность по знакам препинания */
function analyzePunctuation(text: string): { intensity: number; emojis: string[] } {
  let intensity = 0;
  const emojis: string[] = [];

  // Множественные знаки вопроса/восклицания
  const questionMarks = (text.match(/\?/g) ?? []).length;
  const exclamationMarks = (text.match(/!/g) ?? []).length;

  if (questionMarks > 2) {
    intensity += 0.3;
    emojis.push('❓');
  }
  if (exclamationMarks > 2) {
    intensity += 0.3;
    emojis.push('❗');
  }

  // КАПС (все буквы заглавные)
  const words = text.split(/\s+/);
  const capsWords = words.filter((w) => w === w.toUpperCase() && w.length > 2 && /[а-яёa-z]/i.test(w));
  if (capsWords.length > 2) {
    intensity += 0.4;
    emojis.push('📢');
  }

  return { intensity: Math.min(intensity, 1), emojis };
}

/** Определить настроение сообщения */
export function detectSentiment(message: string): SentimentResult {
  // Если сообщение пустое — нейтральное
  if (!message || message.trim().length === 0) {
    return {
      sentiment: 'neutral',
      intensity: 0,
      emotions: [],
      toneAdvice: TONE_ADVICE.neutral.tone,
      suggestedEmojis: TONE_ADVICE.neutral.emojis,
    };
  }

  let bestMatch: (typeof EMOTION_PATTERNS)[0] | null = null;
  let bestIntensity = 0;

  // Ищем наиболее подходящий паттерн
  for (const pattern of EMOTION_PATTERNS) {
    if (pattern.pattern.test(message)) {
      if (pattern.intensity > bestIntensity) {
        bestIntensity = pattern.intensity;
        bestMatch = pattern;
      }
    }
  }

  // Если паттерн не найден — анализируем пунктуацию
  let intensity = bestMatch ? bestIntensity : 0;
  const punctuationResult = analyzePunctuation(message);
  intensity = Math.max(intensity, punctuationResult.intensity);

  // Определяем итоговое настроение
  const sentiment = bestMatch?.sentiment ?? 'neutral';
  const emotions = bestMatch ? [bestMatch.emotion] : [];
  const baseAdvice = TONE_ADVICE[sentiment];

  // Добавляем эмодзи из пунктуации
  const allEmojis = [...baseAdvice.emojis, ...punctuationResult.emojis];
  // Убираем дубликаты
  const uniqueEmojis = [...new Set(allEmojis)].slice(0, 3); // Максимум 3 эмодзи

  return {
    sentiment,
    intensity,
    emotions,
    toneAdvice: baseAdvice.tone,
    suggestedEmojis: uniqueEmojis,
  };
}

/** Получить адаптивный префикс ответа */
export function getResponsePrefix(sentiment: SentimentResult): string {
  switch (sentiment.sentiment) {
    case 'anxious':
      return 'Понимаю вашу обеспокоенность. Давайте разберёмся спокойно и по шагам. ';
    case 'angry':
      return 'Ваше разочарование понятно. Давайте найдём лучшее решение. ';
    case 'positive':
      return 'Отлично! Хорошая ситуация. ';
    case 'excited':
      return 'Замечательно! Вот что я думаю. ';
    case 'negative':
      return 'Ситуация требует внимания. ';
    default:
      return '';
  }
}

/** Проверить, нужно ли успокоить пользователя */
export function needsReassurance(sentiment: SentimentResult): boolean {
  return sentiment.sentiment === 'anxious' || sentiment.sentiment === 'angry';
}
