import { IGlobalAllocation, IRebalanceDelta, IAssetAnalysis } from '../portfolio-math/portfolio-math';

// 1. ИНТЕРФЕЙС ДЛЯ СБОРНОГО ПАКЕТА ДАННЫХ ИЗ НАШИХ ПРЕДЫДУЩИХ МОДУЛЕЙ
export interface IAdvisorInput {
  globalAllocation: IGlobalAllocation;
  rebalanceDelta: IRebalanceDelta;
  assetsAnalysis: IAssetAnalysis[];
}

// 2. ФУНКЦИЯ ГЕНЕРАЦИИ ЖЕСТКОГО СИСТЕМНОГО ПРОМПТА ДЛЯ ЛОКАЛЬНОГО ИИ
export function generateAiPrompt(input: IAdvisorInput): string {
  const { globalAllocation, rebalanceDelta, assetsAnalysis } = input;

  // Формируем текстовый блок текущего состояния классов активов
  const currentStocksPct = (globalAllocation.stockValue / globalAllocation.totalValue) * 100;
  const currentBondsPct = (globalAllocation.bondValue / globalAllocation.totalValue) * 100;

  // Формируем текстовый список дельт и статусов по каждой конкретной бумаге
  const assetsStatusText = assetsAnalysis
    .map((asset) => {
      const sharePct = asset.currentShare * 100;
      let actionText = 'Держать позицию.';

      if (asset.status === 'BLOCK') {
        actionText = '🛑 КРИТИЧЕСКИЙ ПЕРЕБОР! Покупки полностью заблокированы.';
      } else if (asset.status === 'BUY' && asset.suggestedQuantityToBuy > 0) {
        actionText = `🎯 СИГНАЛ НА ПОКУПКУ: Целесообразно докупить около ${asset.suggestedQuantityToBuy} шт. строго на ИИС.`;
      }

      return `- ${asset.instrument}: доля ${sharePct.toFixed(1)}% от портфеля. Статус: ${actionText}`;
    })
    .join('\n');

  // Собираем финальный промпт в единый текстовый блок
  return `Ты — профессиональный ИИ-ассистент инвестора Радика Нурисламовича. Твоя задача — проанализировать текущее математическое состояние его портфеля ценных бумаг и составить тактический план ребалансировки.

ЖЕСТКИЕ ПРАВИЛА ЕГО СТРАТЕГИИ:
1. Глобальный сплит: Акции строго 52%, Облигации строго 48%.
2. Лимит по компании "Полюс" (PLZL): Строго чуть меньше 20% от всего капитала. При превышении — полная блокировка покупок.
3. Лимиты по компаниям "Сбербанк", "Татифт Зао" (Татнефть), "ИнтерРАОао", "КЦ ИКС 5" (X5 Group): Плавное целевое доведение до 15% на каждого при пополнении.
4. Защитный блок: Облигации "ѕГТЛК2P-14" (ГТЛК). Активное наращивание до целевой планки 10% от портфеля. На покупку ГТЛК в первую очередь направляются купоны от "Брус 2P04" и "Селигдар 10".

ТЕКУЩЕЕ МАТЕМАТИЧЕСКОЕ СОСТОЯНИЕ ПОРТФЕЛЯ:
- Общая рыночная стоимость ценных бумаг: ${globalAllocation.totalValue.toLocaleString('ru-RU')} руб.
- Текущий баланс классов: Акции занимают ${currentStocksPct.toFixed(1)}%, Облигации занимают ${currentBondsPct.toFixed(1)}%.
- Отклонение от целевого сплита 52/48 в рублях:
  * В акции требуется докинуть: ${rebalanceDelta.actions.stockDelta.toLocaleString('ru-RU')} руб. (если число отрицательное — в акциях перебор).
  * В облигации требуется докинуть: ${rebalanceDelta.actions.bondDelta.toLocaleString('ru-RU')} руб.

СТАТУСЫ И ДЕЛЬТЫ ЭМИТЕНТОВ НА ОСНОВЕ ФОРМУЛ:
${assetsStatusText}

ЗАДАНИЕ ДЛЯ ИИ-АССИСТЕНТА:
1. Оцени макроэкономический контекст и новостной фон для российского рынка ценных бумаг.
2. Составь пошаговый текстовый план действий на русском языке. Напиши, в какие именно защитные облигации или акции из списка разрешенных (статус СИГНАЛ НА ПОКУПКУ) нужно направить новые пополнения и приходящие купоны от "Брусники" и "Селигдара", чтобы максимально эффективно выровнять баланс портфеля до 52/48.
3. Если по какой-то бумаге (например, по Полюсу) стоит статус КРИТИЧЕСКИЙ ПЕРЕБОР, отдельно подтверди, что её покупать сейчас нельзя.
4. Пиши коротко, профессионально, уважительно и строго по делу — без лишней "воды" и общих фраз.`;
}

// 3. БАЗОВЫЙ ИНИЦИАЛИЗАТОР МОДУЛЯ AI-ADVISOR
export const aiAdvisor = (): void => {
  console.log('🤖 Модуль ai-advisor (TS) успешно инициализирован');
};
