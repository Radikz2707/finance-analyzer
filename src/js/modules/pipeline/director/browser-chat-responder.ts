/**
 * Browser Chat Responder — «честный» исполнитель свободного диалога Director
 * для браузерных сборок (app.ts, dashboard, report.html).
 *
 * Проблема, которую решает: раньше общий вопрос без подключённого LLM
 * (chatResponder) уходил в захардкоженный fallback «Я — ваш финансовый
 * директор…» — один и тот же ответ на любой вопрос. Здесь ответ строится
 * по РЕАЛЬНЫМ фактам портфеля (доли, цель, P&L, концентрация, свободные
 * средства), а при их отсутствии — даётся понятная справка о возможностях
 * и о том, как загрузить данные.
 *
 * Модуль не имеет Node-зависимостей и работает в браузере (file://, http://).
 */

import type {
  ChatDialogueContext,
  ChatResponder,
  DirectorFactsContext,
} from './director-types.js';

/** Ключевые слова запроса возможностей Director */
const CAPABILITIES_PATTERNS: RegExp[] = [
  /что (ты )?(умеешь|можешь)/i,
  /какие (у тебя )?(возможности|функции|команды)/i,
  /^(помощь|help|хелп)$/i,
  /помоги(те)?( пожалуйста)?$/i,
];

/** Ключевые слова запроса новостного фона */
const NEWS_PATTERNS: RegExp[] = [
  /новост/i,
  /событи/i,
  /сводк/i,
  /что (происходит|нового)/i,
];

/** Ключевые слова запроса рыночной/макро информации */
const MARKET_PATTERNS: RegExp[] = [
  /рынок/i,
  /индекс/i,
  /мосбиржа/i,
  /макро/i,
  /инфляци/i,
  /ставк/i,
];

/** Приветствия/благодарности — короткая вежливая реплика без анализа */
const COURTESY_PATTERNS: RegExp[] = [
  /^спасибо/i,
  /^благодарю/i,
  /^понятно/i,
  /^ок$/i,
  /^окей$/i,
  /^ага$/i,
  /^да$/i,
  /^нет$/i,
];

/** Форматирование рублей */
function formatMoney(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('ru-RU') + ' ₽';
}

/** Форматирование процентов */
function formatPercent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value.toFixed(1) + '%';
}

/** Есть ли загруженные данные портфеля */
function hasPortfolioData(facts: DirectorFactsContext): boolean {
  return facts.assetsAnalysis.length > 0 || facts.totalPortfolioValue > 0;
}

/** Сводка портфеля по фактам */
function buildPortfolioSummary(facts: DirectorFactsContext): string {
  const lines: string[] = [];
  const assets = [...facts.assetsAnalysis];

  if (facts.totalPortfolioValue > 0) {
    lines.push(
      '💰 Стоимость портфеля: ' + formatMoney(facts.totalPortfolioValue),
    );
  }
  lines.push('📊 Активов в фокусе: ' + assets.length);
  if (facts.freeCashRub > 0) {
    lines.push('💵 Свободные средства: ' + formatMoney(facts.freeCashRub));
  }

  // Топ позиций по доле
  const sorted = [...assets].sort(
    (a, b) => (b.currentPercent ?? 0) - (a.currentPercent ?? 0),
  );
  const top = sorted.slice(0, 5);
  if (top.length > 0) {
    lines.push('');
    lines.push('Крупнейшие позиции:');
    for (const asset of top) {
      lines.push(
        '• ' +
          asset.ticker +
          ' — доля ' +
          formatPercent(asset.currentPercent) +
          (asset.targetPercent && asset.targetPercent > 0
            ? ' (цель ' + formatPercent(asset.targetPercent) + ')'
            : '') +
          ', P&L ' +
          formatMoney(asset.unrealizedProfitRub),
      );
    }
  }

  // Концентрация > 25%
  const concentrated = assets.filter((a) => (a.currentPercent ?? 0) > 25);
  if (concentrated.length > 0) {
    lines.push('');
    lines.push(
      '⚠️ Концентрация: ' +
        concentrated
          .map((a) => a.ticker + ' (' + formatPercent(a.currentPercent) + ')')
          .join(', '),
    );
  }

  // Дефицит к целевым долям
  const deficit = assets.filter((a) => (a.deficitRub ?? 0) > 0);
  if (deficit.length > 0) {
    lines.push('');
    lines.push(
      '📈 Докупка для выравнивания структуры: ' +
        deficit
          .map((a) => a.ticker + ' на ' + formatMoney(a.deficitRub))
          .join(', '),
    );
  }

  const totalPnl = assets.reduce(
    (sum, a) => sum + (a.unrealizedProfitRub ?? 0),
    0,
  );
  lines.push('');
  lines.push(
    'Суммарный нереализованный P&L: ' +
      formatMoney(totalPnl) +
      (totalPnl >= 0 ? ' ✅' : ' ⚠️'),
  );

  return lines.join('\n');
}

/** Детали по конкретному активу */
function buildAssetDetail(
  facts: DirectorFactsContext,
  ticker: string,
): string | null {
  const asset = facts.assetsAnalysis.find(
    (a) => a.ticker.toUpperCase() === ticker.toUpperCase(),
  );
  if (!asset) return null;

  const lines: string[] = [];
  lines.push('📌 ' + asset.name + ' (' + asset.ticker + ')');
  lines.push('Доля в портфеле: ' + formatPercent(asset.currentPercent));
  if (asset.targetPercent && asset.targetPercent > 0) {
    lines.push('Целевая доля: ' + formatPercent(asset.targetPercent));
  }
  if (asset.currentPrice) {
    lines.push('Текущая цена: ' + formatMoney(asset.currentPrice));
  }
  if (asset.balancePrice) {
    lines.push('Цена покупки: ' + formatMoney(asset.balancePrice));
    const drawdown = asset.currentPrice
      ? ((asset.currentPrice - asset.balancePrice) / asset.balancePrice) * 100
      : 0;
    if (Number.isFinite(drawdown)) {
      lines.push(
        'Изменение к цене покупки: ' +
          (drawdown >= 0 ? '+' : '') +
          drawdown.toFixed(1) +
          '%',
      );
    }
  }
  if (asset.unrealizedProfitRub !== undefined) {
    lines.push(
      'Нереализованный P&L: ' + formatMoney(asset.unrealizedProfitRub),
    );
  }
  if ((asset.deficitRub ?? 0) > 0) {
    lines.push(
      'Дефицит к целевой доле: ' +
        formatMoney(asset.deficitRub) +
        ' — кандидат на докупку в пределах свободных средств',
    );
  }
  if (asset.isConcentrated) {
    lines.push(
      '⚠️ Позиция концентрированная (доля более 25%) — повышенный риск',
    );
  }

  lines.push('');
  lines.push(
    'Полный анализ с привлечением агентов доступен после запуска пайплайна (npm run pipeline).',
  );
  return lines.join('\n');
}

/** Справка о возможностях Director */
function buildCapabilities(facts: DirectorFactsContext): string {
  const lines: string[] = [];
  lines.push('Я — ваш финансовый директор. Могу помочь с портфелем:');
  lines.push('');
  lines.push('• «Что с SBER?» — разбор конкретного актива');
  lines.push('• «Как выглядит портфель?» — сводка по всем позициям');
  lines.push('• «Есть ли риски?» — концентрация, просадки, отклонения');
  lines.push('• «Стратегия» — план по структуре портфеля');
  lines.push('• «Новости» — новостной фон (если загружен пайплайном)');
  lines.push('• «Рынок» — рыночная и макро-обстановка');
  lines.push('');
  lines.push('⌨️ Системные команды: /status · /log [N] · /undo · /help');

  if (!hasPortfolioData(facts)) {
    lines.push('');
    lines.push(
      '⚠️ Сейчас данные портфеля не загружены. Запустите npm run pipeline ' +
        '(для report.html) или npm run dev (для dashboard), чтобы я видел ваши позиции.',
    );
  }
  return lines.join('\n');
}

/**
 * Построить ответ на свободный вопрос по фактам портфеля.
 * Чистая функция — покрывается unit-тестами.
 *
 * @returns строка ответа или null, если вопрос не распознан (ответит Director).
 */
export function buildBrowserChatResponse(
  input: ChatDialogueContext,
): string | null {
  const question = (input.question ?? '').trim();
  const facts = input.facts;
  if (!question) return null;

  // Вежливые реплики — короткий ответ
  if (COURTESY_PATTERNS.some((p) => p.test(question))) {
    return (
      'Пожалуйста! Если захотите разобрать конкретный актив — ' +
      'спросите «Что с SBER?» или укажите любой тикер из портфеля.'
    );
  }

  // Запрос возможностей
  if (CAPABILITIES_PATTERNS.some((p) => p.test(question))) {
    return buildCapabilities(facts);
  }

  // Упоминание тикера (в т.ч. русского названия)
  const mentionedTicker = findMentionedTicker(question, facts);
  if (mentionedTicker) {
    const detail = buildAssetDetail(facts, mentionedTicker);
    if (detail) return detail;
  }

  // Запрос новостей
  if (NEWS_PATTERNS.some((p) => p.test(question))) {
    if (facts.newsContext && facts.newsContext.trim() !== '') {
      return (
        '📰 Новостной контекст (из последнего пайплайна):\n\n' +
        facts.newsContext.slice(0, 800)
      );
    }
    return (
      '📰 Новостной фон не загружен в этом режиме.\n\n' +
      'Запустите npm run pipeline, чтобы пайплайн собрал новости по портфелю — ' +
      'тогда я смогу показать сводку и предупреждения.'
    );
  }

  // Запрос рынка/макро — прокси к фактам портфеля (рыночные провайдеры в браузере недоступны)
  if (MARKET_PATTERNS.some((p) => p.test(question))) {
    if (!hasPortfolioData(facts)) {
      return (
        'Рыночные данные в браузере не подключены: провайдеры работают ' +
        'в Node-контуре (npm run pipeline).\n\n' +
        'Пока могу показать состояние вашего портфеля: ' +
        'спросите «Как выглядит портфель?».'
      );
    }
    return (
      'Подробные рыночные данные (индексы, ставка ЦБ, макропоказатели) ' +
      'доступны после запуска пайплайна. Вот что я знаю о вашем портфеле:\n\n' +
      buildPortfolioSummary(facts)
    );
  }

  // Есть данные портфеля → сводка
  if (hasPortfolioData(facts)) {
    return (
      'Вот текущее состояние вашего портфеля:\n\n' +
      buildPortfolioSummary(facts) +
      '\n\nЧто разобрать подробнее — например, «Что с ' +
      (facts.assetsAnalysis[0]?.ticker ?? 'SBER') +
      '?»?'
    );
  }

  // Данных нет и вопрос общий — справка
  return buildCapabilities(facts);
}

/** Найти упомянутый в вопросе тикер (прямое имя или русское название) */
function findMentionedTicker(
  question: string,
  facts: DirectorFactsContext,
): string | null {
  const lower = question.toLowerCase();
  for (const asset of facts.assetsAnalysis) {
    const ticker = asset.ticker.toUpperCase();
    // Прямое упоминание тикера
    if (lower.includes(ticker.toLowerCase())) return ticker;
    // Русское название компании
    const name = asset.name?.toLowerCase() ?? '';
    if (name.length >= 4 && lower.includes(name)) return ticker;
  }
  return null;
}

/**
 * Фабрика ChatResponder для DirectorConfig:
 * подключается в браузерных сборках вместо отсутствующего LLM.
 */
export function createBrowserChatResponder(): ChatResponder {
  return async (input: ChatDialogueContext): Promise<string | null> => {
    try {
      return buildBrowserChatResponse(input);
    } catch (err) {
      console.warn('[Director] Ошибка браузерного chatResponder:', err);
      return null;
    }
  };
}
