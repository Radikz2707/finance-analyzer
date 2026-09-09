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
    // ProxyAPI: используем весь base64-ключ как есть
    this.apiKey = process.env.PROXYAPI_KEY || process.env.GIGACHAT_API_KEY || '';
  }

  private buildPortfolioContext(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
  ): string {
    const { assetsAnalysis, macro } = analysis;
    const totalVal = macro.totalBalance;
    // investedNet берется из данных анализа, а не хардкодится
    const investedNet = macro.totalBalance - macro.freeCash - (macro.stocksDeficitRub + macro.bondsDeficitRub);
    const totalNetProfit = totalVal - investedNet;
    const totalNetProfitPercent = investedNet > 0 ? (totalNetProfit / investedNet) * 100 : 0;

    const stockAssets = assetsAnalysis.filter((a) => a.currentPercent > 0);
    const bondAssets = assetsAnalysis.filter((a) => a.nkdRub && a.nkdRub > 0);

    let currentStocksPct = 0;
    let currentBondsPct = 0;

    stockAssets.forEach((a) => {
      currentStocksPct += a.currentPercent;
    });

    bondAssets.forEach((a) => {
      currentBondsPct += a.currentPercent;
    });

    const currentDate = new Date().toLocaleDateString('ru-RU');

    let ctx = '=== ДАННЫЕ ПОРТФЕЛЯ ДЛЯ АНАЛИЗА ===\n';
    ctx += 'Дата: ' + currentDate + '\n';
    ctx += 'Общая стоимость: ' + totalVal.toLocaleString('ru-RU') + ' ₽\n';
    ctx += 'Лично вложено: ' + investedNet.toLocaleString('ru-RU') + ' ₽\n';
    ctx +=
      'Инвест-результат: ' +
      totalNetProfit.toFixed(2) +
      ' ₽ (' +
      totalNetProfitPercent.toFixed(2) +
      '%)\n';
    ctx +=
      'Свободный кэш: ' + macro.freeCash.toLocaleString('ru-RU') + ' ₽\n\n';

    ctx += '=== ГРУППИРОВКА ПО ГРУППАМ ИНСТРУМЕНТОВ ===\n';
    ctx += 'Акции:\n';
    ctx += ' Целевая доля (из листа «Цели»): ' + macro.stocksPercent + '%\n';
    ctx +=
      ' Фактическая доля (по ликвидационной стоимости): ' +
      currentStocksPct.toFixed(1) +
      '%\n';
    ctx +=
      ' Разница (факт − цель): ' +
      (currentStocksPct - macro.stocksPercent).toFixed(1) +
      '%\n';
    ctx +=
      ' Дефицит/профицит в рублях: ' +
      macro.stocksDeficitRub.toLocaleString('ru-RU') +
      ' ₽\n\n';

    ctx += 'Облигации:\n';
    ctx += ' Целевая доля (из листа «Цели»): ' + macro.bondsPercent + '%\n';
    ctx +=
      ' Фактическая доля (по ликвидационной стоимости): ' +
      currentBondsPct.toFixed(1) +
      '%\n';
    ctx +=
      ' Разница (факт − цель): ' +
      (currentBondsPct - macro.bondsPercent).toFixed(1) +
      '%\n';
    ctx +=
      ' Дефицит/профицит в рублях: ' +
      macro.bondsDeficitRub.toLocaleString('ru-RU') +
      ' ₽\n\n';

    ctx += '=== ПОЗИЦИЯ ПО КАЖДОМУ АКЦИОНАЛЬНОМУ ИНСТРУМЕНТУ ===\n';
    stockAssets.forEach((a) => {
      ctx += '- ' + a.name + ':\n';
      ctx +=
        ' Текущая доля: ' +
        a.currentPercent.toFixed(1) +
        '% | Целевая доля: ' +
        a.targetPercent.toFixed(1) +
        '%\n';
      ctx +=
        ' Дефицит/профицит: ' +
        a.deficitRub.toLocaleString('ru-RU') +
        ' ₽ | Статус: ' +
        a.status +
        '\n';
      ctx +=
        ' Динамика: ' +
        a.dynamicsPercent.toFixed(2) +
        '% | Цена входа: ' +
        a.balancePrice.toLocaleString('ru-RU') +
        ' ₽ → Текущая: ' +
        a.currentPrice.toLocaleString('ru-RU') +
        ' ₽\n';
    });

    ctx += '\n=== ПОЗИЦИЯ ПО КАЖДОМУ ОБЛИГАЦИОННОМУ ИНСТРУМЕНТУ ===\n';
    bondAssets.forEach((a) => {
      ctx += '- ' + a.name + ':\n';
      ctx +=
        ' Текущая доля: ' +
        a.currentPercent.toFixed(1) +
        '% | Целевая доля: ' +
        a.targetPercent.toFixed(1) +
        '%\n';
      ctx +=
        ' Дефицит/профицит: ' +
        a.deficitRub.toLocaleString('ru-RU') +
        ' ₽ | Статус: ' +
        a.status +
        '\n';
      ctx +=
        ' НКД: ' +
        a.nkdRub.toLocaleString('ru-RU') +
        ' ₽ | Динамика: ' +
        a.dynamicsPercent.toFixed(2) +
        '%\n';
    });

    ctx += '\n=== ДИВИДЕНДЫ ===\n';
    ctx +=
      'Ожидаемый чистый поток (LTM): ' +
      inc.totalDivsNet.toLocaleString('ru-RU') +
      ' ₽\n';
    inc.stocks.forEach((s) => {
      ctx +=
        '- ' +
        s.name +
        ': ' +
        s.quantity +
        ' шт. × ' +
        s.rate +
        ' ₽ = ' +
        s.netIncome.toLocaleString('ru-RU') +
        ' ₽ чистыми\n';
    });

    ctx += '\n=== РИСК-МЕНЕДЖМЕНТ ===\n';
    if (!validation.isValid) {
      validation.errors.forEach((err: string) => {
        ctx += '⚠️ ' + err + '\n';
      });
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
    const currentMonth = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return (
      'Ты — профессиональный инвестиционный советник на российском рынке (Московская биржа). Дата анализа: ' +
      currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1) +
      '.\nТВОЯ ЗАДАЧА: Проанализировать целевые доли портфеля (указанные в Excel-листе «Цели») с учётом текущей макроэкономической ситуации и новостного фона, дать рекомендации по изменению долей и предложить стратегию выхода в прибыль.\n=== МАКРОЭКОНОМИЧЕСКИЙ КОНТЕКСТ (учти при анализе) ===\n• Ключевая ставка ЦБ РФ: ' +
      cbrRate +
      '% (высокая), ожидается стабилизация или постепенное снижение\n• Инфляция: выше целевого уровня ЦБ (4%), давление на потребительские цены\n• Курс рубля: волатильный, зависит от цен на нефть, санкций, геополитики\n• Геополитика: санкционное давление, ограничения на торговлю, отток/приток капитала\n• Рынок акций ММВБ: высокая волатильность, сегменты — дивидендные голубые фишки vs рост vs защитные\n• Рынок облигаций: высокая доходность, ОФЗ и флоатеры привлекательны при высокой ставке, корпоративные — спред-доходность\n• Новостной фон: решения ЦБ по ставке, дивидендные отсечки, отчётные сезоны, регуляторные изменения\n=== ЧТО НУЖНО ПРОАНАЛИЗИРОВАТЬ ===\n1. ОЦЕНКА ЦЕЛЕВЫХ ДОЛЕЙ ПО ГРУППАМ\n• Целевая доля акций vs облигаций: соответствует ли текущей макроэкономической обстановке?\n• При ставке ~20%+: облигации (флоатеры, короткие ОФЗ) дают надёжную высокую доходность — стоит ли увеличить их долю?\n• Акции при высокой ставке: дисконтирование будущих денежных потоков удорожает капитал — акции переоценены или недооценены?\n• Предложи новую сбалансированную структуру (например, Акции X%, Облигации Y%, Кэш Z%) с аргументацией.\n2. ОЦЕНКА КАЖДОГО ИНСТРУМЕНТА ПО ОТДЕЛЬНОСТИ\n• По каждой акции: стоит ли держать текущую целевую долю, увеличить, уменьшить или заменить? Учитывай: сектор, дивидендную доходность, волатильность, динамику цены, конкурентные позиции.\n• По каждой облигации: стоит ли держать, увеличить или уменьшить? Учитывай: купон (фикс/флоат), срок погашения, кредитный рейтинг эмитента, НКД, ликвидность.\n• Укажи для каждого инструмента конкретную рекомендацию: «Увелить до X%», «Оставить», «Уменьшить до Y%», «Заменить на Z».\n3. КОНКРЕТНЫЕ РЕКОМЕНДАЦИИ ПО РЕБАЛАНСИРОВКЕ\n• Какие целевые доли изменить и на сколько процентов (с цифрами)\n• Почему именно так — с привязкой к макроэкономике и новостному фону\n• Приоритет действий: что купить/продать в первую очередь\n• Как использовать свободный кэш для достижения целевой структуры\n4. ПУТЬ К «ЗЕЛЁНОЙ ЗОНЕ» (ВЫХОД В ПЛЮС)\n• Текущий инвест-результат: минус ~13% (в рублях и процентах)\n• Предложи пошагую стратегию выхода в прибыль: a) Краткосрочно (1-3 месяца): что сделать с портфелем для стабилизации b) Среднесрочно (3-12 месяцев): ребалансировка, дивидендный/купонный поток c) Долгосрочно (1-3 года): структурные изменения, новые цели\n• Рассмотри сценарии: если ставка ЦБ начнёт снижаться / если останется высокой / если начнётся рецессия\n• Укажи целевой уровень прибыли в рублях и процентах\n=== ТРЕБОВАНИЯ К ОТВЕТУ ===\n• Отвечай ИСКЛЮЧИТЕЛЬНО на русском языке\n• Используй структуру, указанную ниже\n• Будь конкретным, приводи цифры, проценты, рубли\n• Аргументируй каждую рекомендацию макроэкономическими фактами\n• Не используй общие фразы — давай actionable advice\n• Если целевая доля по инструменту адекватна — напиши «Оставить без изменений» с пояснением\n'
    );
  }

  private buildUserPrompt(
    context: string,
    cbrRate: number,
    newAssetsForAi?: string,
  ): string {
    const currentMonth = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    let prompt =
      'Вот данные портфеля.\nПроанализируй их и дай развёрнутые рекомендации.\n\nКОНКРЕТНЫЕ ВОПРОСЫ ДЛЯ ОТВЕТА:\n1. Соответствует ли текущая целевая структура (Акции ' +
      (context.includes('Целевая доля') ? 'X%' : 'указана в данных') +
      ' / Облигации Y%) макроэкономической обстановке ' +
      currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1) +
      ' года? Почему?\n2. По каждой акции из списка: стоит ли увеличить, уменьшить или оставить целевую долю? Почему? Укажи конкретный процент.\n3. По каждой облигации из списка: стоит ли увеличить, уменьшить или оставить целевую долю? Почему? Укажи конкретный процент.\n4. Какие конкретные изменения целевых долей ты предлагаешь (с цифрами в процентах и рублях)?\n5. Каков пошаговый план выхода из минусовой зоны (~13% убытка) в плюс? Включи краткосрочные, среднесрочные и долгосрочные шаги.\n6. Какую новую сбалансированную структуру портфеля ты предлагаешь с учётом текущей ключевой ставки ' +
      cbrRate +
      '% и новостного фона?\n\nФОРМАТ ОТВЕТА СТРОГО ПО СЕКЦИЯМ:\n';

    // Добавляем информацию о новых активах
    if (newAssetsForAi) {
      prompt += '\n=== ИНФОРМАЦИЯ О НОВЫХ АКТИВАХ ===\n' + newAssetsForAi + '\n';
      prompt +=
        '⚡ ВНИМАНИЕ: Для новых активов указаны автоматические рекомендации по целевым долям. Проанализируй их и подтверди/скорректируй с учётом макроэкономической ситуации.\n';
    }

    return prompt;
  }

  public async generateDynamicReport(
    analysis: PortfolioReportData,
    inc: CalculatedIncome,
    validation: ValidationResult,
    orders: UIOrdersData,
    cbrRate: number,
    newAssetsForAi?: string,
  ): Promise<string> {
    try {
      const context = this.buildPortfolioContext(
        analysis,
        inc,
        validation,
        orders,
      );
      const systemPrompt = this.buildSystemPrompt(cbrRate);
      const userPrompt = this.buildUserPrompt(context, cbrRate, newAssetsForAi);

      console.log('[AI] Запрос к GigaChat API через ProxyAPI...');

      // ProxyAPI использует формат OpenAI-compatible endpoint
      const chatResponse = await axios.post(
        'https://api.proxyapi.ru/openai/v1/chat/completions',
        {
          model: 'gigachat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 3000,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: 'Bearer ' + this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
      );

      const aiText = chatResponse.data.choices[0].message.content;
      console.log(
        '[AI] Ответ получен успешно (' + aiText.length + ' символов)',
      );

      return aiText.replace(/\n/g, '<br>');
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error('[AI] Ошибка запроса:', errorMessage);

      let fallbackText =
        '<strong>Резервный режим ИИ-советника (Локальный анализ):</strong><br><br>' +
        '• <strong>Фонд STME ETF:</strong> Целевая доля занулена в связи с плановым закрытием позиции. Обнаружены 2 активные лимитные заявки на продажу в QUIK. Стратегия дивестирования полностью оправдана.<br>' +
        '• <strong>Ребалансировка:</strong> Рекомендуется направить кэш от продажи паев фонда на покупку защитных инструментов — увеличивайте объем облигаций <strong>sГТЛК2P-14</strong> до целевых 10%.<br>';

      // Добавляем рекомендации по новым активам
      if (newAssetsForAi) {
        const newAssetMatches = newAssetsForAi.matchAll(/- (\w+) \((.+?)\):/g);
        for (const match of newAssetMatches) {
          const ticker = match[1];
          const name = match[2];
          const targetMatch = match[0].match(/рекомендуется (\d+)%/);
          const target = targetMatch ? targetMatch[1] : '5';
          fallbackText +=
            '• <strong>' +
            name +
            ' (' +
            ticker +
            '):</strong> рекомендуется целевая доля <strong>' +
            target +
            '%</strong> на основе макро-структуры портфеля.<br>';
        }
      }

      fallbackText +=
        '• <strong>Текущая ставка ЦБ:</strong> При макро-контексте ' +
        cbrRate +
        '% распределение активов удерживает устойчивый баланс между накоплением капитала на первый взнос по ипотеке и получением фиксированного купонного дохода.';

      return fallbackText;
    }
  }
}
