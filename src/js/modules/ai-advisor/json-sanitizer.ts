/**
 * json-sanitizer — очистка AI-текста от raw structured JSON.
 *
 * Raw JSON (```json { ... } ```, ``` { ... } ```, {"ticker": ... } inline)
 * используется только для построения StructuredAIAssetRecommendation
 * и НИКОГДА не должен попадать в отображаемый HTML/PDF/Markdown.
 *
 * Модуль вынесен из ai-advisor.ts, чтобы его можно было использовать
 * и в новом pipeline (ai-agent → notification-agent), не создавая
 * циклических зависимостей на legacy-оркестратор.
 */

/**
 * Удаляет JSON-блок из AI-ответа перед вставкой в HTML/PDF.
 * Raw JSON никогда не должен попадать в HTML — он используется только
 * для построения StructuredAIAssetRecommendation через aiResult.structuredJson.
 *
 * Покрывает ВСЕ форматы:
 *  1. ```json { ... } ```  (fenced с маркером)
 *  2. ``` { ... } ```      (fenced без маркера)
 *  3. {"ticker": ... }     (сырой JSON-объект без маркеров, inline)
 *  4. <environment_details>...</environment_details>
 *  5. Многострочный JSON с вложенными объектами и массивами
 */
export function stripJsonBlockFromAiText(text: string): string {
  let result = text;

  // 1. Удаляем ```json ... ``` блок (fenced с маркером, тройные бэктики)
  result = result.replace(/```json\s*[\s\S]*?```/g, '');
  // 1b. Удаляем `json ... ` блок (fenced с маркером, одинарные бэктики)
  result = result.replace(/`json\s*[\s\S]*?`/g, '');
  // 2. Удаляем ``` ... ``` блок (fenced без маркера, тройные бэктики)
  result = result.replace(/```\s*[\s\S]*?```/g, '');
  // 2b. Удаляем ` { ... } ` блок (fenced без маркера, одинарные бэктики, начинается с {)
  result = result.replace(/`\s*\{[\s\S]*?\}\s*`/g, '');

  // 3. Удаляем сырой JSON-объект {"ticker": ... } без маркеров (inline)
  //    Используем brace-counting для корректного удаления вложенных объектов
  result = removeInlineJsonObject(result);

  // 4. Удаляем <environment_details>...</environment_details>
  result = result.replace(
    /<environment_details>[\s\S]*?<\/environment_details>/g,
    '',
  );

  // 5. Пост-очистка: удаляем оставшиеся одиночные { "ticker" ... } без закрывающей }
  //    (на случай если LLM оборвал JSON)
  result = result.replace(/\{\s*"ticker"\s*:[^}]*$/gm, '');

  // 6. Финальная проверка: удаляем любые оставшиеся structured JSON patterns
  //    на случай если что-то проскочило
  result = result.replace(/"recommendedTargetPercent"\s*:/g, '');
  result = result.replace(/"recommendedAction"\s*:/g, '');
  result = result.replace(/"agreementWithPortfolioMath"\s*:/g, '');

  return result.trim();
}

/**
 * Удаляет inline JSON-объект {"ticker": ...} с корректной обработкой
 * вложенных объектов и массивов через подсчёт скобок.
 */
function removeInlineJsonObject(text: string): string {
  const pattern = /\{\s*"ticker"\s*:/;
  let result = '';
  let lastIndex = 0;
  let match;
  let foundAny = false;

  while ((match = pattern.exec(text)) !== null) {
    foundAny = true;
    const startIdx = match.index;

    // Защита от бесконечного цикла: если паттерн совпал в той же позиции
    if (startIdx <= lastIndex) {
      break;
    }

    // Находим закрывающую } с учётом вложенности
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let endIdx = -1;

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === '\\') {
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (ch === '{' || ch === '[') {
        braceCount++;
      } else if (ch === '}' || ch === ']') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx > startIdx) {
      result += text.slice(lastIndex, startIdx);
      result += '[JSON_BLOCK_REMOVED]';
      lastIndex = endIdx;
    } else {
      result += text.slice(lastIndex);
    }
  }

  // Если паттерн не найден — возвращаем исходный текст без изменений
  if (!foundAny) {
    return text;
  }

  // Добавляем оставшийся текст после последнего совпадения
  result += text.slice(lastIndex);

  return result;
}
