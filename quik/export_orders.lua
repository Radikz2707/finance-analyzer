--[[
╔══════════════════════════════════════════════════════════════════════════╗
║  export_orders.lua — QLua-скрипт выгрузки активных заявок QUIK в JSON     ║
║                                                                          ║
║  Финансовый анализатор: https://github.com/your/repo/finance-analyzer   ║
║  Модуль чтения на TS: src/js/modules/quik-gateway/quik-orders-reader.ts ║
╚══════════════════════════════════════════════════════════════════════════╝

  ▶ УСТАНОВКА В QUIK (один раз):
    1. В терминале QUIK откройте меню: «Сервис → Lua-скрипты».
    2. Нажмите «Добавить» и выберите этот файл (export_orders.lua).
    3. Отметьте скрипт галочкой — он запустится, экспортирует заявки
       сразу при старте, а затем по таймеру (интервал задаётся ниже).
    4. Для ручного экспорта: остановите скрипт (снять галочку)
       и запустите снова — либо дождитесь следующего тика таймера.

  ▶ НАСТРОЙКА:
    1. Пропишите АБСОЛЮТНЫЙ путь к папке данных проекта в константе
       ORDERS_FILE_BASE ниже (в QUIK нет .env — путь задаётся здесь).
       Пример: 'D:/dev/finance-analyzer_2/data/quik/orders_'
    2. Убедитесь, что папка data/quik существует.
    3. При необходимости измените EXPORT_INTERVAL_SEC (по умолчанию 60).

  ▶ РЕЗУЛЬТАТ:
    - Файл orders_ГГГГММДД.json — JSON-массив заявок (перезаписывается
      целиком на каждый тик, т.к. это снимок текущих заявок).
    - Структура записи совместима с интерфейсом QuikOrder:
        { "number": "123456", "ticker": "SBER", "operation": "BUY"|"SELL",
          "qty": 10, "price": 250.5, "pricePercent": 250.5,
          "isBond": false, "sum": 2505,
          "status": "АКТИВНА"|"ИСПОЛНЕНА"|"СНЯТА", "account": "403GPBT",
          "statusCode": 0 }
      statusCode — исходный числовой статус QLua (0=активна, 1=исполнена).
    - Ошибки логируются в файл export_orders.log.

  ⚠️ ВАЖНО: скрипт только ЧИТАЕТ заявки (getOrders) и ЗАПИСЫВАЕТ их в файл.
     Отправка транзакций в QUIK из этого скрипта запрещена и не реализована.
--]]

-- ══════════════════════════════════════════════════════════════
-- КОНФИГУРАЦИЯ (пропишите свои пути!)
-- ══════════════════════════════════════════════════════════════

-- Базовый путь к файлам заявок. Имя файла: orders_ГГГГММДД.json
-- ⚠️ ЗАМЕНИТЕ на свой абсолютный путь (без конечного слеша).
ORDERS_FILE_BASE = 'D:/dev/finance-analyzer_2/data/quik/orders_'

-- Файл лога ошибок (append).
LOG_FILE = 'D:/dev/finance-analyzer_2/data/quik/export_orders.log'

-- Интервал автоэкспорта в секундах (по умолчанию 60)
EXPORT_INTERVAL_SEC = 60

-- ══════════════════════════════════════════════════════════════
-- СЛУЖЕБНЫЕ ФУНКЦИИ
-- ══════════════════════════════════════════════════════════════

-- Логирование в файл (никогда не бросает исключений)
local function log(msg)
    local ok = pcall(function()
        local f = io.open(LOG_FILE, 'a')
        if not f then return end
        f:write(os.date('%Y-%m-%d %H:%M:%S') .. ' [export_orders] ' .. tostring(msg) .. '\n')
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

-- ══════════════════════════════════════════════════════════════
-- МАППИНГ СТАТУСОВ И ОПЕРАЦИЙ QLua
-- ══════════════════════════════════════════════════════════════

-- Числовой статус заявки QLua → человекочитаемый (как в QuikOrder)
local STATUS_MAP = {
    [0] = 'АКТИВНА',
    [1] = 'ИСПОЛНЕНА',
    [2] = 'СНЯТА',
    [3] = 'СНЯТА', -- отклонена/не принята — трактуем как снятую
}

-- ══════════════════════════════════════════════════════════════
-- ЭКСПОРТ ЗАЯВОК
-- ══════════════════════════════════════════════════════════════

-- Собирает активные заявки через getOrders() и пишет JSON-массив.
local function exportOrders()
    local ok, err = pcall(function()
        local orders = getOrders()
        if not orders then
            log('getOrders() вернул nil (нет соединения с сервером?)')
            return
        end

        local records = {}

        -- QLua getOrders() возвращает таблицу, индексированную номерами
        -- заявок: { [order_num] = { ...поля... }, ... }
        for _, order in pairs(orders) do
            if type(order) == 'table' then
                local statusCode = tonumber(order.status) or -1
                local statusText = STATUS_MAP[statusCode] or 'СНЯТА'

                -- Пишем только активные и исполненные заявки
                -- (снятые/отклонённые пропускаем, как в xlsx-парсере)
                if statusText ~= 'СНЯТА' then
                    local ticker = tostring(order.sec_code or ''):gsub('%s+$', '')
                    if ticker ~= '' then
                        local operation = (tostring(order.operation or ''):upper() == 'S')
                                and 'SELL' or 'BUY'
                        local qty = tonumber(order.qty) or 0
                        local price = tonumber(order.price) or 0

                        -- Облигации торгуются в классе TQOB — цену показывают
                        -- в % от номинала, что уже соответствует pricePercent
                        local classCode = tostring(order.class_code or '')
                        local isBond = classCode:find('TQOB') ~= nil

                        table.insert(records, {
                            number = tostring(order.order_num or ''),
                            ticker = ticker,
                            operation = operation,
                            qty = qty,
                            price = price,
                            pricePercent = price,
                            isBond = isBond,
                            sum = math.floor((qty * price) * 100 + 0.5) / 100,
                            status = statusText,
                            account = tostring(order.account or 'НЕИЗВЕСТЕН'),
                            statusCode = statusCode,
                        })
                    end
                end
            end
        end

        -- Перезаписываем файл текущего дня целиком (снимок)
        local filePath = ORDERS_FILE_BASE .. os.date('%Y%m%d') .. '.json'
        local f = io.open(filePath, 'w')
        if not f then error('не удалось создать файл: ' .. filePath) end
        f:write(jsonEncodeValue(records) .. '\n')
        f:close()

        log('экспортировано заявок: ' .. #records .. ' → ' .. filePath)
    end)
    if not ok then
        log('exportOrders ошибка: ' .. tostring(err))
    end
end

-- ══════════════════════════════════════════════════════════════
-- ТОЧКА ВХОДА
-- ══════════════════════════════════════════════════════════════

-- main() — точка входа QLua-скрипта. Экспорт при старте + цикл по таймеру.
-- Цикл с sleep() выполняется в отдельном потоке QLua и не блокирует
-- обработку других событий терминала.
function main()
    log('скрипт запущен. Интервал экспорта: ' .. EXPORT_INTERVAL_SEC .. 'с')

    -- Экспорт сразу при старте
    exportOrders()

    -- Периодический экспорт по таймеру
    while true do
        sleep(EXPORT_INTERVAL_SEC * 1000)
        exportOrders()
    end
end

log('загружен (модуль)')
