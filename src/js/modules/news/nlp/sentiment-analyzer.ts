/**
 * NLP Sentiment Analyzer — анализ тональности новостей через Python.
 *
 * Использует Python-движок (BERT/RuBERT) для анализа тональности.
 * Fallback на keyword-матчинг если Python недоступен.
 */

import { PythonBridge } from '../../python-engine/python-bridge.js';
import { config as newsConfig } from '../news-config.js';

/** Результат анализа сентимента */
export interface SentimentResult {
  /** Тональность: POSITIVE, NEGATIVE, NEUTRAL */
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  /** Оценка тональности (-1.0 — 1.0) */
  score: number;
  /** Обоснование анализа */
  reason: string;
  /** Использовался ли fallback */
  isFallback: boolean;
}

/** NLP Sentiment Analyzer */
export class SentimentAnalyzer {
  private bridge = new PythonBridge();

  /**
   * Анализ тональности новости.
   * @param title — заголовок
   * @param summary — описание
   * @returns результат анализа
   */
  async analyze(
    title: string,
    summary: string,
  ): Promise<SentimentResult> {
    // Проверка включен ли NLP
    if (!newsConfig.NLP_ANALYSIS_ENABLED) {
      return this.keywordFallback(title, summary);
    }

    try {
      // Вызов Python ML-модели
      const result = await this.bridge.call<unknown>({
        command: 'analyze_sentiment' as const,
        payload: {
          title,
          summary,
          text: `${title} ${summary}`,
        },
      });

      const r = result as { sentiment?: string; score?: number; reason?: string };

      return {
        sentiment: r.sentiment as SentimentResult['sentiment'] || 'NEUTRAL',
        score: r.score || 0,
        reason: r.reason || 'Анализ через Python BERT',
        isFallback: false,
      };
    } catch (error) {
      console.warn('[Sentiment] Python недоступен, fallback на keyword:', error);
      return this.keywordFallback(title, summary);
    }
  }

  /**
   * Fallback: keyword-матчинг.
   */
  private keywordFallback(
    title: string,
    summary: string,
  ): SentimentResult {
    const text = `${title} ${summary}`.toLowerCase();

    const positiveWords = [
      'рост', 'прибыль', 'доход', 'успех', 'развит', 'инвестиц', 'покупк',
      'увелич', 'рекорд', 'дивиденд', 'выкуп', 'одобр', 'контракт', 'выигр',
      'лучш', 'позитив', 'дивид',
    ];

    const negativeWords = [
      'паден', 'снижен', 'убыт', 'кризис', 'риск', 'санкц', 'обвал', 'потер',
      'долг', 'дефолт', 'банкрот', 'суд', 'арест', 'штраф', 'расслед',
      'негатив', 'провал', 'угроз', 'сокращ', 'блокировк', 'конфискац',
    ];

    let score = 0;
    for (const word of positiveWords) {
      if (text.includes(word)) score++;
    }
    for (const word of negativeWords) {
      if (text.includes(word)) score--;
    }

    // Нормализация в -1.0 — 1.0
    const normalizedScore = Math.max(-1, Math.min(1, score / 5));

    let sentiment: SentimentResult['sentiment'];
    if (normalizedScore > 0.2) sentiment = 'POSITIVE';
    else if (normalizedScore < -0.2) sentiment = 'NEGATIVE';
    else sentiment = 'NEUTRAL';

    return {
      sentiment,
      score: normalizedScore,
      reason: 'Анализ через keyword-матчинг (fallback)',
      isFallback: true,
    };
  }
}
