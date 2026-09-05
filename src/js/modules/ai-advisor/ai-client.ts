import { PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import axios from 'axios';

export interface UIOrdersData {
  md: string;
}

export class AiClient {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.GIGACHAT_API_KEY || '';
  }

  private buildPortfolioContext(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
  ): string {
    const { assetsAnalysis, macro } = analysis;
    const totalVal = macro.totalBalance;
    const investedNet = 744689.65;
    const totalNetProfit = totalVal - investedNet;
    const totalNetProfitPercent = (totalNetProfit / investedNet) * 100;

    // === ГРУППИРОВКА АКЦИЙ И ОБЛИГАЦИЙ ===
    const stockAssets = assetsAnalysis.filter(a => a.currentPercent > 0);
    const bondAssets = assetsAnalysis.filter(a => a.nkdRub && a.nkdRub > 0);

    let currentStocksPct = 0;
    let currentBondsPct = 0;
    let targetStocksPct = 0;
    let targetBondsPct = 0;

    stockAssets.forEach(a => { currentStocksPct += a.currentPercent; targetStocksPct += a.targetPercent; });
    bondAssets.forEach(a => { currentBondsPct += a.currentPercent; targetBondsPct += a.targetPercent; });

    let ctx = '=== ДАННЫЕ ПОРТФЕЛЯ ДЛЯ АНАЛИЗА ===\n';
    ctx += 'Дата: 05.09.2026\n';
    ctx += 'Общая стоимость: ' + totalVal.toLocaleString('ru-RU') + ' ₽\n';
    ctx += 'Лично вложено: ' + investedNet.toLocaleString('ru-RU') + ' ₽\n';
    ctx += 'Инвест-результат: ' + totalNetProfit.toFixed(2) + ' ₽ (' + totalNetProfitPercent.toFixed(2) + '%)\n';
    ctx += 'Свободный кэш: ' + macro.freeCash.toLocaleString('ru-RU') + ' ₽\n\n';

    ctx += '=== ГРУППИРОВКА ПО ГРУППАМ ИНСТРУМЕНТОВ ===\n';
    ctx += 'Акции:\n';
    ctx += '  Целевая доля (из листа «Цели»): ' + macro.stocksPercent + '%\n';
    ctx += '  Фактическая доля (по ликвидационной стоимости): ' + currentStocksPct.toFixed(1) + '%\n';
    ctx += '  Разница (факт − цель): ' + (currentStocksPct - macro.stocksPercent).toFixed(1) + '%\n';
    ctx += '  Дефицит/профицит в рублях: ' + macro.stocksDeficitRub.toLocaleString('ru-RU') + ' ₽\n\n';

    ctx += 'Облигации:\n';
    ctx += '  Целевая доля (из листа «Цели»): ' + macro.bondsPercent + '%\n';
    ctx += '  Фактическая доля (по ликвидационной стоимости): ' + currentBondsPct.toFixed(1) + '%\n';
    ctx += '  Разница (факт − цель): ' + (currentBondsPct - macro.bondsPercent).toFixed(1) + '%\n';
    ctx += '  Дефицит/профицит в рублях: ' + macro.bondsDeficitRub.toLocaleString('ru-RU') + ' ₽\n\n';

    ctx += '=== ПОЗИЦИЯ ПО КАЖДОМУ АКЦИОНАЛЬНОМУ ИНСТРУМЕНТУ ===\n';
    stockAssets.forEach(a => {
      ctx += '- ' + a.name + ':\n';
      ctx += '    Текущая доля: ' + a.currentPercent.toFixed(1) + '% | Целевая доля: ' + a.targetPercent.toFixed(1) + '%\n';
      ctx += '    Дефицит/профицит: ' + a.deficitRub.toLocaleString('ru-RU') + ' ₽ | Статус: ' + a.status + '\n';
      ctx += '    Динамика: ' + a.dynamicsPercent.toFixed(2) + '% | Цена входа: ' + a.balancePrice.toLocaleString('ru-RU') + ' ₽ → Текущая: ' + a.currentPrice.toLocaleString('ru-RU') + ' ₽\n';
    });

    ctx += '\n=== ПОЗИЦИЯ ПО КАЖДОМУ ОБЛИГАЦИОННОМУ ИНСТРУМЕНТУ ===\n';
    bondAssets.forEach(a => {
      ctx += '- ' + a.name + ':\n';
      ctx += '    Текущая доля: ' + a.currentPercent.toFixed(1) + '% | Целевая доля: ' + a.targetPercent.toFixed(1) + '%\n';
      ctx += '    Дефицит/профицит: ' + a.deficitRub.toLocaleString('ru-RU') + ' ₽ | Статус: ' + a.status + '\n';
      ctx += '    НКД: ' + a.nkdRub.toLocaleString('ru-RU') + ' ₽ | Динамика: ' + a.dynamicsPercent.toFixed(2) + '%\n';
    });

    ctx += '\n=== ДИВИДЕНДЫ ===\n';
    ctx += 'Ожидаемый чистый поток (LTM): ' + inc.totalDivsNet.toLocaleString('ru-RU') + ' ₽\n';
    inc.stocks.forEach(s => {
      ctx += '- ' + s.name + ': ' + s.quantity + ' шт. × ' + s.rate + ' ₽ = ' + s.netIncome.toLocaleString('ru-RU') + ' ₽ чистыми\n';
    });

    ctx += '\n=== РИСК-МЕНЕДЖМЕНТ ===\n';
    if (!validation.isValid) {
      validation.errors.forEach(err => { ctx += '⚠️ ' + err + '\n'; });
    } else {
      ctx += 'Лимиты соблюдены.\n';
    }

    ctx += '\n=== ЗАЯВКИ ===\n';
    if (orders.md) {
      ctx += orders.md;
    } else {
      ctx += 'Нет активных заявок.\n';
    }

    return ctx;
  }

  private buildSystemPrompt(cbrRate: number): string {
    return `Ты — профессиональный инвестиционный советник на российском рынке (Московская биржа).
Дата анализа: сентябрь 2026.

ТВОЯ ЗАДАЧА:
Проанализировать целевые доли портфеля (указанные в Excel-листе «Цели») с учётом текущей макроэкономической ситуации и новостного фона, дать рекомендации по изменению долей и предложить стратегию выхода в прибыль.

=== МАКРОЭКОНОМИЧЕСКИЙ КОНТЕКСТ (учти при анализе) ===
- Ключевая ставка ЦБ РФ: ${cbrRate}% (высокая), ожидается стабилизация или постепенное снижение
- Инфляция: выше целевого уровня ЦБ (4%), давление на потребительские цены
- Курс рубля: волатильный, зависит от цен на нефть, санкций, геополитики
- Геополитика: санкционное давление, ограничения на торговлю, отток/приток капитала
- Рынок акций ММВБ: высокая волатильность, сегменты — дивидендные голубые фишки vs рост vs защитные
- Рынок облигаций: высокая доходность, ОФЗ и флоатеры привлекательны при высокой ставке, корпоративные — спред-доходность
- Новостной фон: решения ЦБ по ставке, дивидендные отсечки, отчётные сезоны, регуляторные изменения

=== ЧТО НУЖНО ПРОАНАЛИЗИРОВАТЬ ===

1. ОЦЕНКА ЦЕЛЕВЫХ ДОЛЕЙ ПО ГРУППАМ
   - Целевая доля акций vs облигаций: соответствует ли текущей макроэкономической обстановке?
   - При ставке ~20%+: облигации (флоатеры, короткие ОФЗ) дают надёжную высокую доходность — стоит ли увеличить их долю?
   - Акции при высокой ставке: дисконтирование будущих денежных потоков удорожает капитал — акции переоценены или недооценены?
   - Предложи новую сбалансированную структуру (например, Акции X%, Облигации Y%, Кэш Z%) с аргументацией.

2. ОЦЕНКА КАЖДОГО ИНСТРУМЕНТА ПО ОТДЕЛЬНОСТИ
   - По каждой акции: стоит ли держать текущую целевую долю, увеличить, уменьшить или заменить?
     Учитывай: сектор, дивидендную доходность, волатильность, динамику цены, конкурентные позиции.
   - По каждой облигации: стоит ли держать, увеличить или уменьшить?
     Учитывай: купон (фикс/флоат), срок погашения, кредитный рейтинг эмитента, НКД, ликвидность.
   - Укажи для каждого инструмента конкретную рекомендацию: «Увеличить до X%», «Оставить», «Уменьшить до Y%», «Заменить на Z».

3. КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ ПО РЕБАЛАНСИРОВКЕ
   - Какие целевые доли изменить и на сколько процентов (с цифрами)
   - Почему именно так — с привязкой к макроэкономике и новостному фону
   - Приоритет действий: что купить/продать в первую очередь
   - Как использовать свободный кэш для достижения целевой структуры

4. ПУТЬ К «ЗЕЛЁНОЙ ЗОНЕ» (ВЫХОД В ПЛЮС)
   - Текущий инвест-результат: минус ~13% (в рублях и процентах)
   - Предложи пошаговую стратегию выхода в прибыль:
     a) Краткосрочно (1-3 месяца): что сделать с портфелем для стабилизации
     b) Среднесрочно (3-12 месяцев): ребалансировка, дивидендный/купонный поток
     c) Долгосрочно (1-3 года): структурные изменения, новые цели
   - Рассмотри сценарии: если ставка ЦБ начнёт снижаться / если останется высокой / если начнётся рецессия
   - Укажи целевой уровень прибыли в рублях и процентах

=== ТРЕБОВАНИЯ К ОТВЕТУ ===
- Отвечай ИСКЛЮЧИТЕЛЬНО на русском языке
- Используй структуру, указанную ниже
- Будь конкретным, приводи цифры, проценты, рубли
- Аргументируй каждую рекомендацию макроэкономическими фактами
- Не используй общие фразы — давай actionable advice
- Если целевая доля по инструменту адекватна — напиши «Оставить без изменений» с пояснением
`;
  }

  private buildUserPrompt(context: string, cbrRate: number): string {
    return `Вот данные портфеля. Проанализируй их и дай развёрнутые рекомендации.

КОНКРЕТНЫЕ ВОПРОСЫ ДЛЯ ОТВЕТА:

1. Соответствует ли текущая целевая структура (Акции ${context.includes('Целевая доля') ? 'X%' : 'указана в данных'} / Облигации Y%) макроэкономической обстановке сентября 2026 года? Почему?

2. По каждой акции из списка: стоит ли увеличить, уменьшить или оставить целевую долю? Почему? Укажи конкретный процент.

3. По каждой облигации из списка: стоит ли увеличить, уменьшить или оставить целевую долю? Почему? Укажи конкретный процент.

4. Какие конкретные изменения целевых долей ты предлагаешь (с цифрами в процентах и рублях)?

5. Каков пошаговый план выхода из минусовой зоны (~13% убытка) в плюс? Включи краткосрочные, среднесрочные и долгосрочные шаги.

6. Какую новую сбалансированную структуру портфеля ты предлагаешь с учётом текущей ключевой ставки ${cbrRate}% и новостного фона?

ФОРМАТ ОТВЕТА СТРОГО ПО СЕКЦИЯМ:

## 📊 Макроэкономическая оценка и новостной фон
[анализ ключевой ставки, инфляции, рубля, геополитики, рынка акций и облигаций ММВБ]

## 🎯 Оценка целевых долей по группам
[Акции: текущая vs целевая, адекватность структуре]
[Облигации: текущая vs целевая, адекватность структуре]
[Предложение новой структуры с аргументацией]

## 🔍 Оценка каждого инструмента
[По каждой акции: рекомендация + конкретный % + обоснование]
[По каждой облигации: рекомендация + конкретный % + обоснование]

## 💡 Рекомендации по ребалансировке
[Конкретные шаги: что купить/продать, в каком порядке, сколько рублей]
[Как использовать свободный кэш]

## 📈 Путь к «зелёной зоне»
[Краткосрочно: стабилизация]
[Среднесрочно: дивидендный/купонный поток + ребалансировка]
[Долгосрочно: структурные изменения]
[Сценарии: ставка снижается / остаётся высокой / рецессия]
`;
  }

  public async generateDynamicReport(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
    cbrRate: number,
  ): Promise<string> {
    try {
      const context = this.buildPortfolioContext(analysis, inc, validation, orders);
      const systemPrompt = this.buildSystemPrompt(cbrRate);
      const userPrompt = this.buildUserPrompt(context, cbrRate);

      console.log('[AI] Запрос к GigaChat API...');

      // Получаем токен
      const tokenResponse = await axios.post(
        'https://ngw.mds.yandex.net/oauth2/yandex',
        { grant_type: 'PASEPORT', api_key: this.apiKey },
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const token = tokenResponse.data.access_token;

      // Запрос к GigaChat
      const chatResponse = await axios.post(
        'https://gigachat.models.ai.yandex.net/v1/chats/completions',
        {
          model: 'GigaChat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 4000,
          temperature: 0.7,
        },
        {
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        },
      );

      const aiText = chatResponse.data.choices[0].message.content;
      console.log('[AI] Ответ получен (' + aiText.length + ' символов)');

      // Конвертируем \n в <br> для HTML
      return aiText.replace(/\n/g, '<br>');
    } catch (error: any) {
      console.error('[AI] Ошибка запроса:', error.message);
      return '';
    }
  }
}
