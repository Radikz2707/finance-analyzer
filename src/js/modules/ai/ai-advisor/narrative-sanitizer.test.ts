import {
  isAssetRecommendationsTableHeader,
  isRecommendationsSectionHeading,
  stripRecommendationsTableFromNarrative,
} from './narrative-sanitizer.js';

describe('isRecommendationsSectionHeading', () => {
  it('распознаёт заголовки с markdown-разметкой и нумерацией', () => {
    expect(
      isRecommendationsSectionHeading('## 2. Рекомендации по каждому активу'),
    ).toBe(true);
    expect(
      isRecommendationsSectionHeading('**2. Рекомендации по активам**'),
    ).toBe(true);
    expect(
      isRecommendationsSectionHeading('2) Рекомендации по каждому инструменту'),
    ).toBe(true);
    expect(isRecommendationsSectionHeading('### Рекомендации по активам')).toBe(
      true,
    );
    expect(isRecommendationsSectionHeading('2. Рекомендации')).toBe(true);
  });

  it('не считает заголовком обычный абзац или другую секцию', () => {
    expect(
      isRecommendationsSectionHeading(
        'Рекомендации по активам стоит давать только после анализа.',
      ),
    ).toBe(false);
    expect(isRecommendationsSectionHeading('2. План ребалансировки')).toBe(
      false,
    );
    expect(isRecommendationsSectionHeading('## 1. Макро и структура')).toBe(
      false,
    );
  });
});

describe('isAssetRecommendationsTableHeader', () => {
  it('распознаёт таблицу рекомендаций по активам', () => {
    expect(
      isAssetRecommendationsTableHeader(
        '| Актив | Действие | Доля % | Целевая % | Дефицит/Профицит | Краткое обоснование |',
      ),
    ).toBe(true);
    expect(isAssetRecommendationsTableHeader('| Тикер | Тип | Статус |')).toBe(
      true,
    );
    expect(
      isAssetRecommendationsTableHeader(
        '| Актив | Рекомендация | Целевая доля |',
      ),
    ).toBe(true);
  });

  it('не трогает обычные таблицы', () => {
    expect(isAssetRecommendationsTableHeader('| Метрика | Значение |')).toBe(
      false,
    );
    expect(
      isAssetRecommendationsTableHeader('| Сценарий | Доходность | Риск |'),
    ).toBe(false);
  });
});

describe('stripRecommendationsTableFromNarrative', () => {
  const fullNarrative = `## 1. Макро и структура портфеля
Ставка ЦБ 14%.

## 2. Рекомендации по каждому активу

| Актив | Действие | Доля % | Целевая % | Дефицит/Профицит | Краткое обоснование |
| :--- | :--- | :--- | :--- | :--- | :--- |
| SBER (Сбербанк) | BUY | 10,0 | 15,0 | -5,0 | Дефицит доли |
| GAZP (Газпром) | HOLD | 12,0 | 12,0 | 0,0 | В цели |

## 3. План ребалансировки
1. Докупить SBER.
`;

  it('удаляет секцию «Рекомендации по каждому активу» и таблицу', () => {
    const cleaned = stripRecommendationsTableFromNarrative(fullNarrative);

    expect(cleaned).toContain('## 1. Макро и структура портфеля');
    expect(cleaned).toContain('Ставка ЦБ 14%.');
    expect(cleaned).not.toContain('Рекомендации по каждому активу');
    expect(cleaned).not.toContain('| Актив |');
    expect(cleaned).not.toContain('| SBER (Сбербанк) | BUY |');
    expect(cleaned).toContain('## 3. План ребалансировки');
    expect(cleaned).toContain('1. Докупить SBER.');
  });

  it('удаляет секцию с жирным заголовком **2. …**', () => {
    const text = `**1. Макро**
Ставка 14%.

**2. Рекомендации по активам**
| Актив | Действие | Доля % |
| --- | --- | --- |
| SBER | BUY | 10 |

**3. План ребалансировки**
Докупить SBER.
`;

    const cleaned = stripRecommendationsTableFromNarrative(text);

    expect(cleaned).not.toContain('Рекомендации по активам');
    expect(cleaned).not.toContain('| SBER | BUY |');
    expect(cleaned).toContain('**3. План ребалансировки**');
    expect(cleaned).toContain('Докупить SBER.');
  });

  it('удаляет таблицу рекомендаций без заголовка секции', () => {
    const text = `## 1. Макро
| Актив | Действие | Доля % |
| --- | --- | --- |
| SBER | BUY | 10 |

Текст после таблицы.
`;

    const cleaned = stripRecommendationsTableFromNarrative(text);

    expect(cleaned).toContain('## 1. Макро');
    expect(cleaned).not.toContain('| Актив |');
    expect(cleaned).not.toContain('| SBER | BUY |');
    expect(cleaned).toContain('Текст после таблицы.');
  });

  it('не удаляет обычные markdown-таблицы', () => {
    const text = `## 1. Макро
| Метрика | Значение |
| --- | --- |
| Ставка ЦБ | 14% |
`;

    const cleaned = stripRecommendationsTableFromNarrative(text);

    expect(cleaned).toContain('| Метрика | Значение |');
    expect(cleaned).toContain('| Ставка ЦБ | 14% |');
  });

  it('останавливается на разделителе --- и сохраняет следующую секцию', () => {
    const text = `## 1. Макро
Текст.

## 2. Рекомендации по каждому активу
| Актив | Действие |
| --- | --- |
| SBER | BUY |

---

## 3. План ребалансировки
Докупить SBER.
`;

    const cleaned = stripRecommendationsTableFromNarrative(text);

    expect(cleaned).not.toContain('Рекомендации по каждому активу');
    expect(cleaned).not.toContain('| SBER | BUY |');
    expect(cleaned).toContain('---');
    expect(cleaned).toContain('## 3. План ребалансировки');
  });

  it('не меняет текст без рекомендаций по активам', () => {
    const text = `## 1. Макро
Ставка ЦБ 14%.

## 2. План ребалансировки
1. Докупить SBER.`;

    expect(stripRecommendationsTableFromNarrative(text)).toBe(text);
  });

  it('идемпотентна', () => {
    const once = stripRecommendationsTableFromNarrative(fullNarrative);
    const twice = stripRecommendationsTableFromNarrative(once);

    expect(twice).toBe(once);
  });

  it('возвращает пустую строку, если narrative состоял только из таблицы', () => {
    const text = `## 2. Рекомендации по каждому активу
| Актив | Действие | Доля % |
| --- | --- | --- |
| SBER | BUY | 10 |
`;

    expect(stripRecommendationsTableFromNarrative(text)).toBe('');
  });
});
