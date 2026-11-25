/**
 * Коллектор диагностических логов.
 *
 * Назначение: собирать строки из консольного вывода [CBR_FETCH],
 * [BOND_COUPON_LTM], [BOND_COUPON_LTM_SUMMARY], [CONFIDENCE_CLAMP]
 * и доставлять их в Markdown-отчёт (секция «Технические логи»).
 *
 * Модули-источники вызывают `DiagnosticLogCollector.append(tag, msg)`
 * вместо или вместе с `console.log`. NotificationAgent читает
 * `DiagnosticLogCollector.flush()` и вставляет строки в отчёт.
 */

/** Строка диагностического лога. */
export interface DiagnosticLogEntry {
  /** Метка: CBR_FETCH | BOND_COUPON_LTM | BOND_COUPON_LTM_SUMMARY | CONFIDENCE_CLAMP | DIVIDENDS_LTM */
  tag: string;
  /** Текст строки (без префикса тега). */
  message: string;
  /** Время добавления (ISO). */
  timestamp: string;
}

const entries: DiagnosticLogEntry[] = [];

/**
 * Добавить строку в коллектор.
 *
 * Одновременно пишет в console.log для отладки в терминале.
 */
export function append(tag: string, message: string): void {
  const entry: DiagnosticLogEntry = {
    tag,
    message,
    timestamp: new Date().toISOString(),
  };
  entries.push(entry);
  console.log(`[${tag}] ${message}`);
}

/**
 * Считать и очистить коллектор.
 *
 * Вызывается один раз в NotificationAgent при сборке отчёта.
 * Возвращает все накопленные строки в формате Markdown.
 */
export function flush(): string {
  if (entries.length === 0) {
    return '';
  }

  const lines: string[] = [
    '---',
    '',
    '## 🔧 Технические логи (диагностика конвейера)',
    '',
    '> Ниже — фактические строки из диагностического конвейера. ',
    '> Сверяйте с консолью запуска.',
    '',
    '| Метка | Сообщение |',
    '|-------|-----------|',
  ];

  for (const entry of entries) {
    // Экранируем | и < > в сообщении для Markdown-таблицы
    const safe = entry.message
      .replace(/\|/g, '\\|')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    lines.push(`| \`${entry.tag}\` | ${safe} |`);
  }

  lines.push('');
  lines.push(`Всего записей: ${entries.length}`);
  lines.push('');

  // Очищаем после чтения
  entries.length = 0;

  return lines.join('\n');
}
