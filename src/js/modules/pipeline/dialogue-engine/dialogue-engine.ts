/**
 * DialogueEngine — фасад естественного диалога Director.
 *
 * Объединяет:
 * - IntentClassifier (LLM + fallback на nl-parser);
 * - ContextTracker (follow-up, анафоры, история);
 * - EmotionDetector (эмоции реплики);
 * - живые ответы на smalltalk/off-topic/courtesy/status БЕЗ запуска агентов.
 *
 * Это замена regex-маршрутизации BrowserDirector.processUserMessage():
 * вместо цепочки `if (/привет/.test(...))` — один вызов `engine.analyze(text)`,
 * а маршрутизация веток идёт по DialogueAnalysis.intent.
 *
 * Модуль чистый: без Node-зависимостей, LLM — DI (type-only импорт).
 */

import { detectEmotion, emotionToneInstruction } from './emotion-detector.js';
import { ContextTracker } from './context-tracker.js';
import { IntentClassifier } from './intent-classifier.js';
import type {
  DialogueAnalysis,
  DialogueAnalysisInput,
  DialogueContext,
  DialogueEmotion,
  IntentClassifierOptions,
} from './types.js';
import type { DirectorFactsContext } from '../director/director-types.js';
import { buildPortfolioSummary } from '../director/browser-chat-responder.js';

// ──────────────────────────────────────────────
// 1. Опции движка
// ──────────────────────────────────────────────

/** Опции DialogueEngine (DI) */
export interface DialogueEngineOptions {
  /** LLM-клиент (передаётся в IntentClassifier) */
  llm?: IntentClassifierOptions['llm'];
  /** Опции классификатора */
  classifier?: IntentClassifierOptions;
  /** Имя пользователя (для обращений) */
  userName?: string;
  /** Максимум хранимых реплик истории */
  historyLimit?: number;
  /** Инжектируемый классификатор (для тестов) */
  classifierInstance?: IntentClassifier;
  /** Инжектируемый трекер контекста (для тестов) */
  trackerInstance?: ContextTracker;
}

// ──────────────────────────────────────────────
// 2. DialogueEngine
// ──────────────────────────────────────────────

/**
 * Движок естественного диалога: анализ + живой smalltalk-ответ.
 */
export class DialogueEngine {
  private readonly classifier: IntentClassifier;
  private readonly tracker: ContextTracker;
  private readonly userName: string;

  constructor(options?: DialogueEngineOptions) {
    this.classifier =
      options?.classifierInstance ?? new IntentClassifier(options?.classifier);
    this.tracker = options?.trackerInstance ?? new ContextTracker();
    this.userName = options?.userName ?? 'Радик';
  }

  /** Подключён ли LLM (для отображения в UI) */
  hasLlm(): boolean {
    return this.classifier.hasLlm();
  }

  /** Текущий контекст диалога (копия) */
  getContext(): DialogueContext {
    return this.tracker.getContext();
  }

  /** Сбросить контекст (новая тема/сессия) */
  resetContext(): void {
    this.tracker.reset();
  }

  /**
   * Проанализировать реплику: классификация + эмоция + follow-up.
   * Обновляет контекст трекера.
   */
  async analyze(input: DialogueAnalysisInput): Promise<DialogueAnalysis> {
    const text = (input.text ?? '').trim();
    const context = this.tracker.getContext();

    const analysis = await this.classifier.classify(text, context);

    // Эмоция: если классификатор вернул neutral, но лексика говорит иначе —
    // уточняем (LLM-эмоция приоритетнее только при высокой уверенности).
    const lexEmotion = detectEmotion(text);
    const emotion: DialogueEmotion =
      analysis.confidence >= 0.8 ? analysis.emotion : lexEmotion;

    const enriched: DialogueAnalysis = {
      ...analysis,
      emotion,
      isFollowUp: this.tracker.isFollowUp(text, analysis.tickers),
      rawText: text,
    };

    // Обновляем контекст трекера
    this.tracker.update(enriched, text);
    return enriched;
  }

  /** Записать реплику Директора в контекст (для follow-up истории) */
  pushDirector(text: string): void {
    this.tracker.pushDirector(text);
  }

  /**
   * Построить «живой» ответ на реплики без агентов (greeting/status/
   * off-topic/courtesy/farewell/smalltalk). Возвращает null, если реплика
   * требует агентов или не распознана.
   */
  buildSmallTalk(
    analysis: DialogueAnalysis,
    facts?: DirectorFactsContext,
  ): string | null {
    switch (analysis.intent) {
      case 'greeting':
        return this.buildGreeting(facts);
      case 'farewell':
        return this.buildFarewell();
      case 'courtesy':
        return this.buildCourtesy();
      case 'off-topic':
        return this.buildOffTopic();
      case 'status':
        return this.buildStatus(facts);
      case 'smalltalk':
        return this.buildSmallTalkText(facts);
      default:
        return null;
    }
  }

  /** Инструкция по тону ответа для LLM (по эмоции последней реплики) */
  toneInstruction(): string {
    return emotionToneInstruction(this.tracker.getContext().lastEmotion);
  }

  // ── Встроенные ответы ──

  private buildGreeting(facts?: DirectorFactsContext): string {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'утро' : hour < 18 ? 'день' : 'вечер';
    let greeting = `Добрый ${timeOfDay}, ${this.userName}! 👋\n\n`;
    if (facts && facts.totalPortfolioValue > 0) {
      greeting +=
        `💰 Портфель сейчас стоит **${formatRub(facts.totalPortfolioValue)} ₽**\n` +
        `📊 Активов: **${facts.assetsAnalysis.length}**\n\n`;
    }
    greeting +=
      'Чем могу помочь?\n\n' +
      '• Спроси «**как портфель**» — покажу текущее состояние\n' +
      '• Спроси о конкретной акции — «**SBER**», «**GAZP**»\n' +
      '• Спроси «**рекомендации**» — соберу мнения агентов\n' +
      '• Спроси «**риски**» — проверю портфель на проблемы';
    return greeting;
  }

  private buildFarewell(): string {
    return `До встречи, ${this.userName}! Буду ждать — портфель под присмотром. 🤝`;
  }

  private buildCourtesy(): string {
    return (
      'Пожалуйста! Если захотите разобрать актив или стратегию — ' +
      'спросите «Что с SBER?» или укажите любой тикер из портфеля.'
    );
  }

  private buildOffTopic(): string {
    return (
      'Хороший вопрос, но он не про портфель 😊\n\n' +
      'Я — ваш финансовый директор и разбираюсь в инвестициях, ' +
      'а не в погоде, спорте или кулинарии. Зато могу помочь с:\n' +
      '• «Что с SBER?» — разбор конкретного актива\n' +
      '• «Как выглядит портфель?» — сводка по всем позициям\n' +
      '• «Есть ли риски?» — концентрация, просадки, отклонения\n' +
      '• «Стратегия» — план по структуре портфеля'
    );
  }

  private buildStatus(facts?: DirectorFactsContext): string {
    if (!facts || facts.assetsAnalysis.length === 0) {
      return (
        'Всё под контролем ✅ Данные портфеля пока не загружены — ' +
        'запустите пайплайн или загрузите Excel, и я покажу полную картину.'
      );
    }
    const sorted = [...facts.assetsAnalysis].sort(
      (a, b) => (b.unrealizedProfitRub ?? 0) - (a.unrealizedProfitRub ?? 0),
    );
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const lines: string[] = [
      `Всё под контролем ✅ Портфель: ${facts.assetsAnalysis.length} активов, ` +
        `стоимость ${formatRub(facts.totalPortfolioValue)} ₽, свободные ` +
        `${formatRub(facts.freeCashRub)} ₽.`,
    ];
    if (best && worst && best.ticker !== worst.ticker) {
      lines.push(
        `Лидер: ${best.ticker} (+${formatRub(best.unrealizedProfitRub ?? 0)} ₽), ` +
          `аутсайдер: ${worst.ticker} (${formatRub(worst.unrealizedProfitRub ?? 0)} ₽).`,
      );
    }
    return lines.join('\n');
  }

  private buildSmallTalkText(facts?: DirectorFactsContext): string {
    if (facts && facts.assetsAnalysis.length > 0) {
      return (
        'Могу поболтать или разобрать портфель 😊\n\n' +
        'Вот текущее состояние:\n' +
        buildPortfolioSummary(facts)
      );
    }
    return (
      'Я — ваш финансовый директор. Разбираюсь в инвестициях, портфеле, ' +
      'рынке и новостях. Спросите «Что с SBER?», «Как выглядит портфель?» ' +
      'или «Новости».'
    );
  }
}

// ──────────────────────────────────────────────
// 3. Helpers
// ──────────────────────────────────────────────

/** Форматирование рублей (ru-RU) */
function formatRub(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(value));
}

/**
 * Фабрика DialogueEngine для DirectorConfig:
 * подключается в браузерных сборках вместо отсутствующего LLM (как
 * createBrowserChatResponder), но с полноценной классификацией интентов.
 */
export function createDialogueEngine(
  options?: DialogueEngineOptions,
): DialogueEngine {
  return new DialogueEngine(options);
}
