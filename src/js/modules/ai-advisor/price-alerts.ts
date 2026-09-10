import { AssetAnalysis } from '../../modules/portfolio-math/portfolio-math.js';
import { PriceAlertConfig, PriceAlert } from './types.js';

/**
 * Модуль динамического мониторинга критических уровней котировок
 * Проверяет пробитие уровней вверх/вниз и генерирует уведомления
 */
export class PriceAlertsModule {
  private defaultConfigs: Record<string, PriceAlertConfig> = {
    Полюс: {
      upperLimit: 1850,   // Критический уровень роста
      lowerLimit: 1450,   // Критический уровень падения
      upperMessage: '🔺 ВНИМАНИЕ: Котировки Полюса преодолели критический уровень роста! Рекомендуется рассмотреть возможность фиксации части прибыли или пересмотра целевой доли.',
      lowerMessage: '🔻 ВНИМАНИЕ: Котировки Полюса опустились ниже критического уровня! Рекомендуется оценить риски и рассмотреть возможность хеджирования позиции.',
    },
    Сбербанк: {
      upperLimit: 320,
      lowerLimit: 260,
      upperMessage: '🔺 ВНИМАНИЕ: Котировки Сбербанка преодолели критический уровень роста! Рекомендуется рассмотреть возможность фиксации части прибыли.',
      lowerMessage: '🔻 ВНИМАНИЕ: Котировки Сбербанка опустились ниже критического уровня! Рекомендуется оценить риски.',
    },
  };

  /**
   * Проверяет все активы портфеля на пробитие критических уровней
   */
  public checkPriceAlerts(
    assets: AssetAnalysis[],
    customConfigs?: Record<string, PriceAlertConfig>,
  ): PriceAlert[] {
    const configs = { ...this.defaultConfigs, ...customConfigs };
    const alerts: PriceAlert[] = [];

    assets.forEach((asset) => {
      const config = configs[asset.name];
      if (!config) {
        return;
      }

      const currentPrice = asset.currentPrice;
      if (currentPrice <= 0) {
        return;
      }

      let alert: PriceAlert | null = null;

      // Проверяем пробитие вверх
      if (currentPrice >= config.upperLimit) {
        alert = {
          ticker: asset.ticker,
          name: asset.name,
          currentPrice,
          upperLimit: config.upperLimit,
          lowerLimit: config.lowerLimit,
          direction: 'upper',
          message: config.upperMessage,
        };
      }
      // Проверяем пробитие вниз
      else if (currentPrice <= config.lowerLimit) {
        alert = {
          ticker: asset.ticker,
          name: asset.name,
          currentPrice,
          upperLimit: config.upperLimit,
          lowerLimit: config.lowerLimit,
          direction: 'lower',
          message: config.lowerMessage,
        };
      }

      if (alert) {
        // Добавляем информацию о динамике
        const percentFromLimit =
          alert.direction === 'upper'
            ? (((currentPrice - config.upperLimit) / config.upperLimit) * 100).toFixed(1)
            : (((config.lowerLimit - currentPrice) / config.lowerLimit) * 100).toFixed(1);

        alert.message +=
          '\n📊 Текущая цена: ' +
          currentPrice.toLocaleString('ru-RU') +
          ' ₽ | Уровень: ' +
          (alert.direction === 'upper' ? config.upperLimit : config.lowerLimit).toLocaleString('ru-RU') +
          ' ₽ | Превышение: ' +
          percentFromLimit +
          '%';
      }

      if (alert) {
        alerts.push(alert);
      }
    });

    return alerts;
  }

  /**
   * Форматирует alerts в HTML для отображения в дашборде
   */
  public formatAlertsHtml(alerts: PriceAlert[]): string {
    if (alerts.length === 0) {
      return '';
    }

    let html =
      '<div class="price-alerts-section" style="margin-bottom: 15px;">' +
      '<h4 style="margin-top: 0; color: #f25157; margin-bottom: 10px;">⚡ Динамический мониторинг котировок</h4>';

    alerts.forEach((alert) => {
      const bgColor =
        alert.direction === 'upper'
          ? 'rgba(35, 134, 54, 0.1)'
          : 'rgba(242, 81, 87, 0.1)';
      const borderColor =
        alert.direction === 'upper' ? '#238636' : '#f25157';
      const icon = alert.direction === 'upper' ? '🟢' : '🔴';

      html +=
        '<div style="padding: 12px; background: ' +
        bgColor +
        '; border: 1px solid ' +
        borderColor +
        '; border-radius: 6px; margin-bottom: 8px; line-height: 1.5; font-size: 13px;">' +
        icon +
        '<strong>' +
        alert.name +
        ' (' +
        alert.ticker +
        ')</strong><br>' +
        alert.message.replace(/\n/g, '<br>') +
        '</div>';
    });

    html += '</div>';
    return html;
  }

  /**
   * Форматирует alerts в Markdown для AI-контекста
   */
  public formatAlertsMarkdown(alerts: PriceAlert[]): string {
    if (alerts.length === 0) {
      return '';
    }

    let md = '\n=== ДИНАМИЧЕСКИЙ МОНИТОРИНГ КОТИРОВОК (PRICE ALERTS) ===\n';

    alerts.forEach((alert) => {
      md +=
        '\n⚠️ ALERT: ' +
        alert.name +
        ' (' +
        alert.ticker +
        ')\n' +
        '- Текущая цена: ' +
        alert.currentPrice.toLocaleString('ru-RU') +
        ' ₽\n' +
        '- Направление: ' +
        (alert.direction === 'upper' ? 'РОСТ выше уровня' : 'ПАДЕНИЕ ниже уровня') +
        '\n' +
        '- Критический уровень: ' +
        (alert.direction === 'upper'
          ? alert.upperLimit.toLocaleString('ru-RU')
          : alert.lowerLimit.toLocaleString('ru-RU')) +
        ' ₽\n' +
        '- Рекомендация: ' +
        alert.message.replace(/\n/g, ' ') +
        '\n';
    });

    return md;
  }
}
