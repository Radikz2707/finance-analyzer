/**
 * Санитайзер свободного текста (narrative) AI-советника.
 *
 * Задача: убрать из текста раздел «Рекомендации по каждому активу»
 * (markdown-таблицу «Актив | Действие | Доля % | Целевая % | …»).
 *
 * Причина: эти данные уже отображаются структурированными карточками,
 * которые рендерятся из валидированного JSON (PortfolioMath + направление).
 * Пересказ чисел в свободной форме:
 *   1) раздувает отчёт;
 *   2) создаёт поверхность для галлюцинаций (числа в тексте никто не валидирует
 *      поформатно);
 *   3) порождает расхождения между таблицей и карточками.
 *
 * Модуль не зависит от DOM/Node API — чистые строковые операции.
 */

/** Максимальная длина строки, которую считаем заголовком секции. */
const MAX_HEADING_LENGTH = 160;

/**
 * Нормализует строку для распознавания заголовков и шапок таблиц:
 * убирает markdown-разметку, нумерацию и лишние пробелы.
 */
function normalizeLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '') // markdown-заголовки
    .replace(/^\*{1,3}\s*/, '') // **жирный**
    .replace(/\*{1,3}\s*$/, '')
    .replace(/^_{1,3}\s*/, '') // __жирный__
    .replace(/_{1,3}\s*$/, '')
    .replace(/^[-–—•]\s*/, '') // маркеры списка
    .replace(/^\d{1,2}[.)]\s*/, '') // 1. / 1)
    .replace(/^[IVX]{1,4}[.)]\s*/i, '') // I. / IV)
    .replace(/^[:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Является ли строка заголовком секции рекомендаций по активам.
 * Поддерживает варианты:
 *   «## 2. Рекомендации по каждому активу»
 *   «**2. Рекомендации по активам**»
 *   «2) Рекомендации по каждому инструменту»
 *   «### Рекомендации по активам»
 */
export function isRecommendationsSectionHeading(line: string): boolean {
  const raw = line.trim();
  if (raw.length === 0 || raw.length > MAX_HEADING_LENGTH) {
    return false;
  }

  const normalized = normalizeLine(raw);
  if (normalized.length === 0) {
    return false;
  }

  // Строка должна быть похожа на заголовок, а не на абзац с упоминанием.
  // Точка/восклицательный/вопросительный знак в нормализованной строке
  // означают обычное предложение (номер секции уже отброшен).
  if (/[.!?]/.test(normalized)) {
    return false;
  }

  const hasRecommendationWord = /рекомендаци/.test(normalized);
  const hasAssetWord = /(актив|инструмент|бумаг|позици)/.test(normalized);
  if (hasRecommendationWord && hasAssetWord) {
    return true;
  }

  // Заголовок вида «2. Рекомендации» — только с явной нумерацией 2,
  // чтобы не вырезать, например, «1. Общие рекомендации».
  const startsWithSectionTwo =
    /^\s*(?:#{1,6}\s*)?(?:\*{1,3}\s*)?2\s*[.)]\s*рекомендаци/i.test(raw);
  return startsWithSectionTwo && normalized === 'рекомендации';
}

/**
 * Ключевые слова заголовков секций отчёта. Нужны, чтобы отличить
 * заголовок «3. План ребалансировки» от элемента нумерованного списка
 * «3. SBER — покупать».
 */
const SECTION_KEYWORDS =
  /(макро|ребаланс|стратег|выход|мониторинг|инструмент|резюме|итог)/i;

/**
 * Является ли строка заголовком любой следующей секции.
 * Используется, чтобы понять, где заканчивается вырезаемый блок.
 */
function isAnySectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Markdown-заголовок — всегда граница секции.
  if (/^#{1,6}\s+\S/.test(trimmed)) {
    return true;
  }
  // Жирный заголовок «**3. План …**» — тоже граница.
  if (/^(\*\*|__)\s*\d{1,2}[.)]\s+/.test(trimmed)) {
    return true;
  }
  // Нумерованный заголовок секции — только если он похож на заголовок
  // (короткий и содержит ключевое слово раздела), а не на пункт списка.
  if (/^\d{1,2}[.)]\s+\S/.test(trimmed)) {
    return trimmed.length <= 80 && SECTION_KEYWORDS.test(trimmed);
  }
  if (/^[IVX]{1,4}[.)]\s+\S/i.test(trimmed)) {
    return trimmed.length <= 80 && SECTION_KEYWORDS.test(trimmed);
  }
  return false;
}

/** Разбить markdown-строку таблицы на ячейки (без внешних `|`). */
function parseTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split('|').map((cell) => cell.trim());
}

/** Строка-разделитель markdown-таблицы (| :--- | ---: |). */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) {
    return false;
  }
  return /^\|?[\s:|-]+\|?\s*$/.test(trimmed);
}

/** Строка является началом markdown-таблицы. */
function isTableStart(line: string): boolean {
  return line.trimStart().startsWith('|');
}

/**
 * Похожа ли шапка таблицы на таблицу рекомендаций по активам.
 *
 * Удаляем только таблицы, которые действительно дублируют карточки:
 *   • «Актив | Действие | Доля % | Целевая % | Дефицит/Профицит | Обоснование»
 *   • «Тикер | Тип | Статус»
 *   • «Актив | Рекомендация | Целевая доля»
 *
 * Обычные таблицы («Метрика | Значение», «Сценарий | Доходность») не трогаем.
 */
export function isAssetRecommendationsTableHeader(headerLine: string): boolean {
  const cells = parseTableRow(headerLine).map((cell) =>
    normalizeLine(cell.replace(/\*{1,3}/g, '')),
  );
  if (cells.length === 0) {
    return false;
  }

  const hasAssetColumn = cells.some(
    (cell) =>
      cell === 'актив' ||
      cell === 'активы' ||
      cell === 'тикер' ||
      cell === 'тикеры' ||
      cell === 'инструмент' ||
      cell === 'бумага' ||
      cell === 'позиция' ||
      cell.startsWith('актив ') ||
      cell.startsWith('тикер '),
  );
  if (!hasAssetColumn) {
    return false;
  }

  const hasActionOrShareColumn = cells.some(
    (cell) =>
      cell.includes('действие') ||
      cell.includes('статус') ||
      cell.includes('рекомендац') ||
      cell.includes('решение') ||
      cell.includes('целев') ||
      cell.includes('доля') ||
      cell.includes('дефицит') ||
      cell.includes('профицит') ||
      cell.includes('обоснован'),
  );

  return hasActionOrShareColumn;
}

/**
 * Удаляет блоки markdown-таблиц, которые дублируют карточки рекомендаций.
 * Работает независимо от наличия заголовка секции.
 */
function removeRecommendationTables(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!isTableStart(line)) {
      result.push(line);
      i++;
      continue;
    }

    // Ищем строку-разделитель в пределах разумного окна (заголовок может
    // быть разорван на несколько строк).
    let separatorIndex = -1;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (isTableSeparator(lines[j]!)) {
        separatorIndex = j;
        break;
      }
    }

    if (separatorIndex === -1) {
      result.push(line);
      i++;
      continue;
    }

    const headerLine = lines
      .slice(i, separatorIndex)
      .map((part) => part.trim())
      .join(' ');

    if (!isAssetRecommendationsTableHeader(headerLine)) {
      // Не наша таблица — оставляем как есть.
      result.push(line);
      i++;
      continue;
    }

    // Пропускаем шапку, разделитель и тело таблицы.
    i = separatorIndex + 1;
    while (i < lines.length) {
      const bodyLine = lines[i]!;
      if (!isTableStart(bodyLine) || bodyLine.trim() === '') {
        break;
      }
      i++;
    }

    // Убираем накопившиеся пустые строки перед удалённой таблицей,
    // чтобы не оставался «дырявый» отступ.
    while (result.length > 0 && result[result.length - 1]!.trim() === '') {
      result.pop();
    }
    // Оставляем один разделитель между соседними абзацами.
    if (result.length > 0) {
      result.push('');
    }
  }

  return result;
}

/**
 * Удаляет секцию «Рекомендации по каждому активу» целиком:
 * заголовок, таблицу и сопутствующий текст до следующего заголовка
 * (или до `---`, или до конца документа).
 */
function removeRecommendationsSections(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!isRecommendationsSectionHeading(line)) {
      result.push(line);
      i++;
      continue;
    }

    // Нашли заголовок секции — вырезаем до следующего заголовка/разделителя.
    i++;
    while (i < lines.length) {
      const current = lines[i]!;
      const trimmed = current.trim();

      if (trimmed === '---') {
        // Разделитель остаётся в тексте как граница секций.
        break;
      }
      if (isAnySectionHeading(current)) {
        break;
      }
      i++;
    }

    while (result.length > 0 && result[result.length - 1]!.trim() === '') {
      result.pop();
    }
    if (result.length > 0) {
      result.push('');
    }
  }

  return result;
}

/** Схлопывает 3+ подряд пустые строки до одной пустой строки. */
function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (line.trim() === '') {
      blankCount++;
      if (blankCount > 1) {
        continue;
      }
    } else {
      blankCount = 0;
    }
    result.push(line);
  }

  return result;
}

/**
 * Удаляет из свободного текста AI-советника раздел с рекомендациями
 * по каждому активу (таблицу, дублирующую структурированные карточки).
 *
 * Функция идемпотентна: повторный вызов не меняет уже очищенный текст.
 */
export function stripRecommendationsTableFromNarrative(text: string): string {
  if (!text) {
    return text;
  }

  const normalized = text.replace(/\r\n?/g, '\n');
  const originalLines = normalized.split('\n');

  let lines = removeRecommendationsSections(originalLines);
  lines = removeRecommendationTables(lines);
  lines = collapseBlankLines(lines);

  const cleaned = lines.join('\n').trim();

  // Если после очистки не осталось содержательного текста — возвращаем
  // пустую строку, а не исходный narrative с дублирующей таблицей.
  return cleaned;
}
