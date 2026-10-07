/**
 * Тесты браузерного chatResponder: осмысленные ответы по фактам портфеля
 * вместо фиксированной фразы «спросите про актив».
 */

import {
  buildBrowserChatResponse,
  createBrowserChatResponder,
} from './browser-chat-responder.js';
import type { DirectorFactsContext } from './director-types.js';

function makeFacts(): DirectorFactsContext {
  return {
    assetsAnalysis: [
      {
        ticker: 'PLZL',
        name: 'Полюс',
        currentPercent: 32,
        targetPercent: 15,
        deficitRub: 0,
        status: 'REDUCE',
        balancePrice: 1000,
        currentPrice: 420,
        unrealizedProfitRub: -58000,
        isConcentrated: true,
      },
      {
        ticker: 'SBER',
        name: 'Сбер',
        currentPercent: 8,
        targetPercent: 12,
        deficitRub: 40000,
        status: 'BUY',
        balancePrice: 250,
        currentPrice: 300,
        unrealizedProfitRub: 5000,
      },
    ],
    totalPortfolioValue: 500000,
    freeCashRub: 60000,
  };
}

function emptyFacts(): DirectorFactsContext {
  return { assetsAnalysis: [], totalPortfolioValue: 0, freeCashRub: 0 };
}

describe('buildBrowserChatResponse', () => {
  it('общий вопрос при наличии фактов → сводка портфеля с позициями', () => {
    const text = buildBrowserChatResponse({
      question: 'Расскажи что-нибудь интересное',
      facts: makeFacts(),
      history: '',
    });

    expect(text).not.toBeNull();
    expect(text!).toContain('портфеля');
    expect(text!).toContain('PLZL');
    expect(text!).toContain('Стоимость портфеля');
  });

  it('вопрос про конкретный актив → детали позиции', () => {
    const text = buildBrowserChatResponse({
      question: 'Что с SBER?',
      facts: makeFacts(),
      history: '',
    });

    expect(text).not.toBeNull();
    expect(text!).toContain('SBER');
    expect(text!).toContain('Доля в портфеле');
    expect(text!).toContain('Дефицит к целевой доле');
  });

  it('запрос возможностей → справка с примерами вопросов', () => {
    const text = buildBrowserChatResponse({
      question: 'Что ты умеешь?',
      facts: emptyFacts(),
      history: '',
    });

    expect(text).not.toBeNull();
    expect(text!).toContain('финансовый директор');
    expect(text!).toContain('Что с SBER?');
  });

  it('новостной запрос без данных → честное объяснение, а не отмазка', () => {
    const text = buildBrowserChatResponse({
      question: 'Что нового в новостях?',
      facts: emptyFacts(),
      history: '',
    });

    expect(text).not.toBeNull();
    expect(text!).toContain('Новостной фон не загружен');
    expect(text!).toContain('npm run pipeline');
  });

  it('без данных портфеля → объясняет, как их загрузить', () => {
    const text = buildBrowserChatResponse({
      question: 'Как дела?',
      facts: emptyFacts(),
      history: '',
    });

    expect(text).not.toBeNull();
    // Общий вопрос без данных → справка о возможностях
    expect(text!).toContain('финансовый директор');
  });
});

describe('createBrowserChatResponder', () => {
  it('возвращает функцию-ответчик, которая не падает и отвечает по фактам', async () => {
    const responder = createBrowserChatResponder();
    const text = await responder({
      question: 'Как выглядит портфель?',
      facts: makeFacts(),
      history: '',
    });

    expect(text).not.toBeNull();
    expect(text!).toContain('Стоимость портфеля');
    expect(text!).toContain('Активов в фокусе');
  });
});
