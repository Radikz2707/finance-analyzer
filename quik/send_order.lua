--[[
╔══════════════════════════════════════════════════════════════════════════╗
║  send_order.lua — QLua-скрипт ОТПРАВКИ подтверждённой заявки в QUIK       ║
║                                                                            ║
║  Финансовый анализатор: https://github.com/your/repo/finance-analyzer     ║
║  Подготовка заявки на TS: src/js/modules/quik-gateway/transaction-builder ║
╚════════════════════════════════════════════════════════════════════════════╝

  ▶ НАЗНАЧЕНИЕ:
    Скрипт читает файл-заявку data/quik/order_request.json (сформированный
    ТОЛЬКО после подтверждения пользователем через transaction-builder.ts),
    вызывает QLua sendTransaction() и пишет результат в
    data/quik/order_result.json.

  ▶ УСТАНОВКА В QUIK (один раз):
    1. В терминале QUIK откройте меню: «Сервис → Lua-скрипты».
    2. Нажмите «Добавить» и выберите этот файл (send_order.lua).
    3. Для одноразового запуска: нажмите кнопку «Запустить» (или
       добавьте скрипт на панель кнопок QUIK через «Создать кнопку» →
       тип «Lua-скрипт» → этот файл). Скрипт выполнится один раз и
       завершится — НИКАКИХ таймеров и авто-отправок нет.

  ▶ НАСТРОЙКА:
    1. Пропишите АБСОЛЮТНЫЙ путь к папке данных проекта в константе
       QUIK_DATA_DIR ниже (в QUIK нет .env — путь задаётся здесь).
       Пример: 'D:/dev/finance-analyzer_2/data/quik'
    2. Убедитесь, что папка существует.
    3. CLASS_CODE по умолчанию 'TQBR' (акции Мосбиржи). Если в файле
       order_request.json есть поле classCode — используется оно.

  ▶ ФОРМАТ ФАЙЛА order_request.json (пишет transaction-builder.ts):
      {
        "classCode": "TQBR",        // опционально
        "secCode": "SBER",
        "operation": "B",           // 'B' = покупка, 'S' = продажа
        "qty": 10,
        "price": 250.5,             // опционально (без цены — рыночная)
        "account": "403GPBT",       // опционально (счёт)
        "comment": "ребалансировка"
      }

  ▶ РЕЗУЛЬТАТ (файл order_result.json):
      { "ok": true,  "orderNum": "123456789", "time": "2026-09-26 18:00:00" }
      { "ok": false, "error": "текст ошибки",  "time": "2026-09-26 18:00:00" }

  ⚠️ БЕЗОПАСНОСТЬ:
    - Скрипт НЕ запускается автоматически: транзакция отправляется ТОЛЬКО
      когда пользователь вручную запускает скрипт из QUIK.
    - Перед отправкой проверяются все поля заявки; при невалидных данных
      транзакция НЕ формируется.
    - Автоматическая отправка из pipeline СТРОГО запрещена (guardrails:
      PENDING → APPROVED → ручной запуск этого скрипта).
--]]

-- ══════════════════════════════════════════════════════════════
-- КОНФИГУРАЦИЯ (пропишите свой путь!)
-- ══════════════════════════════════════════════════════════════

-- Папка данных QUIK: файлы order_request.json / order_result.json
-- ⚠️ ЗАМЕНИТЕ на свой абсолютный путь (без конечного слеша).
QUIK_DATA_DIR = 'D:/dev/finance-analyzer_2/data/quik'

-- Класс инструмента по умолчанию (если не указан в файле заявки)
DEFAULT_CLASS_CODE = 'TQBR'

-- Файл лога ошибок (append).
LOG_FILE = QUIK_DATA_DIR .. '/send_order.log'

-- ══════════════════════════════════════════════════════════════
-- СЛУЖЕБНЫЕ ФУНКЦИИ
-- ══════════════════════════════════════════════════════════════

-- Логирование в файл (никогда не бросает исключений)
local function log(msg)
    local ok = pcall(function()
        local f = io.open(LOG_FILE, 'a')
        if not f then return end
        f:write(os.date('%Y-%m-%d %H:%M:%S') .. ' [send_order] ' .. tostring(msg) .. '\n')
        f:close()
    end)
    if not ok then
        -- молча игнорируем (не роняем QUIK)
    end
end

-- Экранирование строки для JSON
local function jsonEscape(s)
    s = tostring(s or '')
    s = s:gsub('\\', '\\\\')
    s = s:gsub('"', '\\"')
    s = s:gsub('\n', '\\n')
    s = s:gsub('\r', '\\r')
    s = s:gsub('\t', '\\t')
    return s
end

-- Минимальный JSON-сериализатор (числа, строки, булевы, таблицы)
local function jsonEncodeValue(v)
    if v == nil then return 'null' end
    local t = type(v)
    if t == 'number' then
        if v ~= v then return 'null' end -- NaN
        return string.format('%.10g', v)
    elseif t == 'boolean' then
        return tostring(v)
    elseif t == 'string' then
        return '"' .. jsonEscape(v) .. '"'
    elseif t == 'table' then
        local parts = {}
        for k, val in pairs(v) do
            table.insert(parts, '"' .. jsonEscape(k) .. '":' .. jsonEncodeValue(val))
        end
        return '{' .. table.concat(parts, ',') .. '}'
    else
        return 'null'
    end
end

-- Запись результата в order_result.json (не бросает исключений)
local function writeResult(result)
    local ok = pcall(function()
        local filePath = QUIK_DATA_DIR .. '/order_result.json'
        local f = io.open(filePath, 'w')
        if not f then error('не удалось создать файл: ' .. filePath) end
        f:write(jsonEncodeValue(result) .. '\n')
        f:close()
        log('результат записан: ' .. filePath)
    end)
    if not ok then
        log('writeResult ошибка: ' .. tostring(ok))
    end
end

-- Чтение и парсинг order_request.json (возвращает таблицу или nil)
local function readOrderRequest()
    local filePath = QUIK_DATA_DIR .. '/order_request.json'
    local f = io.open(filePath, 'r')
    if not f then
        log('файл заявки не найден: ' .. filePath)
        return nil
    end
    local raw = f:read('*a')
    f:close()

    -- Выполняем загруженный JSON (безопасно: поля проверяются ниже).
    local ok, parsed = pcall(loadstring or load, 'return ' .. raw)
    if not ok or type(parsed) ~= 'table' then
        log('невалидный JSON в ' .. filePath)
        return nil
    end
    return parsed
end

-- Число из произвольного значения (или 0)
local function toNum(v)
    local n = tonumber(v)
    if n and n > 0 then return n end
    return 0
end

-- ══════════════════════════════════════════════════════════════
-- ОТПРАВКА ЗАЯВКИ
-- ══════════════════════════════════════════════════════════════

--[[
  Отправить заявку из файла order_request.json.

  Аргументы (все опциональны — для ручного вызова из консоли QLua):
    CLASS_CODE  — класс инструмента (по умолчанию из файла/DEFAULT_CLASS_CODE)
    SEC_CODE    — код инструмента (по умолчанию из файла)
    OPERATION   — 'B'/'S' (по умолчанию из файла)
    QTY         — количество (по умолчанию из файла)
    PRICE       — цена (по умолчанию из файла)

  Возвращает таблицу-результат { ok = ..., orderNum = ..., error = ... }.
  ВАЖНО: функция выполняет ТОЛЬКО чтение файла + sendTransaction.
  Она не вызывается автоматически — только пользователем из QUIK.
--]]
function sendOrderFromFile(CLASS_CODE, SEC_CODE, OPERATION, QTY, PRICE)
    local request = readOrderRequest()

    -- Параметры из аргументов имеют приоритет над файлом
    local classCode = CLASS_CODE
        or (request and tostring(request.classCode or ''):upper())
        or DEFAULT_CLASS_CODE
    local secCode = SEC_CODE
        or (request and tostring(request.secCode or ''):upper())
        or ''
    local operation = OPERATION
        or (request and tostring(request.operation or ''):upper())
        or ''
    local qty = toNum(QTY or (request and request.qty))
    local price = toNum(PRICE or (request and request.price))
    local account = (request and tostring(request.account or '')) or ''
    local comment = (request and tostring(request.comment or '')) or ''

    -- ── ВАЛИДАЦИЯ (при ошибке транзакция НЕ формируется) ──
    local errorMsg = nil
    if secCode == '' then
        errorMsg = 'пустой SEC_CODE (secCode)'
    elseif operation ~= 'B' and operation ~= 'S' then
        errorMsg = "неверная операция (ожидается 'B' или 'S'), получено: '" .. operation .. "'"
    elseif qty <= 0 then
        errorMsg = 'количество должно быть положительным (qty)'
    elseif price < 0 then
        errorMsg = 'цена не может быть отрицательной (price)'
    end

    if errorMsg then
        local result = { ok = false, error = errorMsg, time = os.date('%Y-%m-%d %H:%M:%S') }
        writeResult(result)
        log('заявка отклонена: ' .. errorMsg)
        return result
    end

    -- ── ФОРМИРОВАНИЕ ТРАНЗАКЦИИ QUIK ──
    local transaction = {
        CLASSCODE = classCode,
        SECCODE = secCode,
        ACTION = 'NEW_ORDER',
        OPERATION = operation,
        QUANTITY = tostring(qty),
        TYPE = 'L', -- лимитная заявка
    }
    if price > 0 then
        transaction.PRICE = string.format('%.2f', price)
    else
        -- Цена не указана → рыночная заявка
        transaction.TYPE = 'M'
    end
    if account ~= '' then
        transaction.ACCOUNT = account
    end
    if comment ~= '' then
        transaction.COMMENT = comment
    end

    -- ── ОТПРАВКА В ОБЁРТКЕ pcall (никогда не роняем QUIK) ──
    local ok, res = pcall(sendTransaction, transaction)
    if not ok then
        local result = {
            ok = false,
            error = 'sendTransaction упал: ' .. tostring(res),
            time = os.date('%Y-%m-%d %H:%M:%S'),
        }
        writeResult(result)
        log('sendTransaction ошибка: ' .. tostring(res))
        return result
    end

    -- sendTransaction возвращает 0 при успешном приёме заявки
    if tonumber(res) ~= 0 then
        local result = {
            ok = false,
            error = 'QUIK отклонил заявку, код: ' .. tostring(res),
            time = os.date('%Y-%m-%d %H:%M:%S'),
        }
        writeResult(result)
        log('QUIK отклонил заявку, код: ' .. tostring(res))
        return result
    end

    -- Попытка достать номер заявки (может быть недоступен сразу)
    local orderNum = ''
    local replyOk, reply = pcall(getTransactionReply)
    if replyOk and type(reply) == 'table' then
        orderNum = tostring(reply.order_number or reply['order_number'] or '')
    end

    local result = {
        ok = true,
        orderNum = orderNum ~= '' and orderNum or nil,
        time = os.date('%Y-%m-%d %H:%M:%S'),
    }
    writeResult(result)
    log(string.format(
        'заявка отправлена: %s %s %d шт. по %s (класс %s)',
        operation, secCode, qty, tostring(price), classCode
    ))
    return result
end

-- ══════════════════════════════════════════════════════════════
-- ТОЧКА ВХОДА
-- ══════════════════════════════════════════════════════════════

-- main() — одноразовый запуск из QUIK (кнопка/«Запустить»).
-- Читает order_request.json и отправляет заявку. После выполнения
-- скрипт завершается (таймеров и циклов НЕТ).
function main()
    log('скрипт запущен пользователем')
    sendOrderFromFile()
    log('скрипт завершён')
end

log('загружен (модуль)')
