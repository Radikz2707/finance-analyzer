import { PortfolioReportData } from '../portfolio-math/portfolio-math.js';
import { ValidationResult } from '../portfolio-math/portfolio-validator.js';
import { CalculatedIncome } from './income-calculator.js';
import axios from 'axios';
import { buildSystemPrompt } from './prompt-templates.js';
import { buildFallbackReport } from './fallback-report-builder.js';
import { UIOrdersData } from './types.js';

export class AiClient {
  private apiKey: string;

  constructor() {
    // ProxyAPI: используем весь base64-ключ как есть
    this.apiKey =
      process.env.PROXYAPI_KEY || process.env.GIGACHAT_API_KEY || '';
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
    const investedNet =
      macro.totalBalance -
      macro.freeCash -
      (macro.stocksDeficitRub + macro.bondsDeficitRub);
    const totalNetProfit = totalVal - investedNet;
    const totalNetProfitPercent =
      investedNet > 0 ? (totalNetProfit / investedNet) * 100 : 0;

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

  private buildUserPrompt(
    context: string,
    cbrRate: number,
    newAssetsForAi?: string,
  ): string {
    const currentMonth = new Date().toLocaleDateString('ru-RU', {
      month: 'long',
      year: 'numeric',
    });
    let prompt =
      'Вот данные портфеля.\nПроанализируй их и дай развёрнутые рекомендации.\n\nКОНКРЕТНЫЕ ВОПРОСЫ ДЛЯ ОТВЕТА:\n1. Соответствует ли текущая целевая структура (Акции ' +
      (context.includes('Целевая доля') ? 'X%' : 'указана в данных') +
      ' / Облигации Y%) макроэкономической обстановке ' +
      currentMonth.charAt(0).toUpperCase() +
      currentMonth.slice(1) +
      ' года? Почему?\n2. По каждой акции из списка: стоит ли увеличить, уменьшить или оставить целевую долю? Почему? Укажи конкретный процент.\n3. По каждой облигации из списка: стоит ли увеличить, уменьшить или оставить целевую долю? Почему? Укажи конкретный процент.\n4. Какие конкретные изменения целевых долей ты предлагаешь (с цифрами в процентах и рублях)?\n5. Каков пошаговый план выхода из минусовой зоны (~13% убытка) в плюс? Включи краткосрочные, среднесрочные и долгосрочные шаги.\n6. Какую новую сбалансированную структуру портфеля ты предлагаешь с учётом текущей ключевой ставки ' +
      cbrRate +
      '% и новостного фона?\n\nФОРМАТ ОТВЕТА СТРОГО ПО СЕКЦИЯМ:\n';

    // Добавляем информацию о новых активах
    if (newAssetsForAi) {
      prompt +=
        '\n=== ИНФОРМАЦИЯ О НОВЫХ АКТИВАХ ===\n' + newAssetsForAi + '\n';
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
      const systemPrompt = buildSystemPrompt(cbrRate);
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
      console.error(
        '[AI] Ошибка запроса:',
        error instanceof Error ? error.message : String(error),
      );
      return buildFallbackReport(
        analysis,
        inc,
        validation,
        orders,
        cbrRate,
        newAssetsForAi,
      );
    }
  }
}
