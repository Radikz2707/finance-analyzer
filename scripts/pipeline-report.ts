/**
 * Pipeline Report — разовый полный прогон конвейера с генерацией отчётов.
 *
 * Запуск:
 *   npm run pipeline
 *
 * Что делает (один прогон PipelineCoordinator.run):
 * 1. DataAgent — парсинг Excel/QUIK, котировки (MOEX/ЦБ), новости;
 * 2. ResearchAgent — исследование активов (фундаментал, конфликты);
 * 3. AnalysisAgent — математика портфеля (доли, отклонения, P&L);
 * 4. AiAgent — AI-анализ портфеля (Ollama / провайдеры из .env);
 * 5. Review / Scenario / Strategist — контроль качества, сценарии, риски;
 * 6. NotificationAgent — пишет report.html и report.md в корень проекта
 *    и открывает отчёт в браузере.
 *
 * Итог: report.html (оформленный отчёт с котировками, топ-5 активов и
 * AI-анализом) + report.md (текстовая версия) рядом с проектом.
 *
 * Это репозиторийная замена локального pipeline.ts: тот же PipelineCoordinator,
 * что используется гибридным диспетчером в desktop-приложении.
 */

// dotenv загружается здесь, чтобы .env был виден всем модулям конвейера.
import 'dotenv/config';
import { PipelineCoordinator } from '../src/js/modules/pipeline/pipeline-coordinator.js';
import { assertEnvValid } from '../src/js/config/index.js';
import type { NotificationAgentOutput } from '../src/js/modules/pipeline/agents/notification-agent.js';

async function main(): Promise<void> {
  console.log('🚀 Разовый прогон конвейера (npm run pipeline)\n');

  // Ранняя проверка .env: предупреждаем, но не роняем запуск — часть
  // источников (новости, FINAM, Telegram) опциональны.
  try {
    assertEnvValid();
  } catch (err) {
    console.warn(
      '⚠️ Проверка .env не прошла (продолжаю с доступными настройками): ' +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const coordinator = new PipelineCoordinator();
  coordinator.onStageComplete((stage, durationMs) => {
    console.log(
      `✅ Стадия «${stage}» завершена за ${(durationMs / 1000).toFixed(1)} с`,
    );
  });

  try {
    const result = await coordinator.run();
    const elapsedSec = (result.totalDurationMs / 1000).toFixed(1);

    if (result.success) {
      console.log(`\n🏁 Конвейер завершён успешно за ${elapsedSec} с`);
    } else {
      console.warn(`\n⚠️ Конвейер завершён с замечаниями за ${elapsedSec} с`);
      if (result.error) {
        console.warn(`   Ошибка: ${result.error.message}`);
      }
    }

    // Пути к отчётам (NotificationAgent пишет report.html/report.md)
    const notification = result.stages.notification?.result.data as
      NotificationAgentOutput | undefined;
    if (notification?.htmlPath) {
      console.log(`📄 HTML-отчёт: ${notification.htmlPath}`);
    }
    if (notification?.mdPath) {
      console.log(`📝 Markdown-отчёт: ${notification.mdPath}`);
    }

    const orders = result.interactiveOrders ?? [];
    if (orders.length > 0) {
      console.log(
        `📋 Интерактивных ордеров: ${orders.length} ` +
          `(${orders.map((o) => `${o.ticker}:${o.action}`).join(', ')})`,
      );
    }

    process.exitCode = result.success ? 0 : 1;
  } catch (err) {
    console.error(
      '❌ Конвейер упал: ' +
        `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exitCode = 1;
  }
}

void main();
