--[[
╔══════════════════════════════════════════════════════════════════════════╗
║  export_news.lua — QLua-скрипт экспорта новостей QUIK (OnNews) в JSON    ║
║                                                                          ║
║  Финансовый анализатор: https://github.com/your/repo/finance-analyzer   ║
║  Модуль чтения на TS: src/js/modules/quik-gateway/quik-news-reader.ts   ║
╚══════════════════════════════════════════════════════════════════════════╝

  ▶ УСТАНОВКА В QUIK (один раз):
    1. В терминале QUIK откройте меню: «Сервис → Lua-скрипты».
    2. Нажмите «Добавить» и выберите этот файл (export_news.lua).
    3. В списке скриптов отметьте его галочкой — скрипт запустится.
    4. Убедитесь, что окно новостей QUIK открыто (меню «Окна → Новости»),
       иначе событие OnNews может не доставляться в скрипт.

  ▶ НАСТРОЙКА:
    1. Пропишите АБСОЛЮТНЫЙ путь к папке данных проекта в константе
       NEWS_FILE_BASE ниже (в QUIK нет .env — путь задаётся здесь).
       Пример: 'D:/dev/finance-analyzer_2/data/quik/news_'
    2. Убедитесь, что папка data/quik существует (QUIK сам её не создаёт).

  ▶ РЕЗУЛЬТАТ:
    - Каждое сообщение из встроенного окна новостей QUIK дописывается
      в файл news_ГГГГММДД.json (JSON-массив записей с append).
    - Структура записи:
        { "id": "код_новости", "className": "класс_новости",
          "time": "ГГГГ-ММ-ДДTЧЧ:ММ:СС", "text": "текст" }
    - Ошибки логируются в файл export_news.log (рядом с новостями).

  ⚠️ ВАЖНО: скрипт только ЗАПИСЫВАЕТ данные. Отправка транзакций в QUIK
     из этого скрипта запрещена и не реализована.
--]]

-- ══════════════════════════════════════════════════════════════
-- КОНФИГУРАЦИЯ (пропишите свои пути!)
-- ══════════════════════════════════════════════════════════════

-- Базовый путь к файлам новостей. Имя файла: news_ГГГГММДД.json
-- ⚠️ ЗАМЕНИТЕ на свой абсолютный путь (без конечного слеша).
NEWS_FILE_BASE = 'D:/dev/finance-analyzer_2/data/quik/news_'

-- Файл лога ошибок (append). QUIK не создаёт папки сам.
LOG_FILE = 'D:/dev/finance-analyzer_2/data/quik/export_news.log'

-- ══════════════════════════════════════════════════════════════
-- СЛУЖЕБНЫЕ ФУНКЦИИ
-- ══════════════════════════════════════════════════════════════

-- Логирование в файл (никогда не бросает исключений)
local function log(msg)
    local ok, err = pcall(function()
        local f = io.open(LOG_FILE, 'a')
        if not f then return end
        f:write(os.date('%Y-%m-%d %H:%M:%S') .. ' [export_news] ' .. tostring(msg) .. '\n')
        f:close()
    end)
    if not ok then
        -- Если лог тоже не пишется — молча игнорируем (не роняем QUIK)
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

-- Проверка существования файла
local function fileExists(path)
    local f = io.open(path, 'r')
    if f then
        f:close()
        return true
    end
    return false
end

-- ══════════════════════════════════════════════════════════════
-- APPEND НОВОСТИ В JSON-МАССИВ
-- ══════════════════════════════════════════════════════════════

-- Дописывает запись в файл новостей (JSON-массив, безопасный append).
-- Возвращает true при успехе, false при ошибке.
local function appendNewsRecord(filePath, record)
    local ok, err = pcall(function()
        local encoded = jsonEncodeValue(record)

        if not fileExists(filePath) then
            -- Новый файл: создаём массив с одной записью
            local f = io.open(filePath, 'w')
            if not f then error('не удалось создать файл: ' .. filePath) end
            f:write('[' .. encoded .. ']\n')
            f:close()
            return
        end

        -- Существующий файл: читаем хвост и вставляем запись перед ']'
        local f = io.open(filePath, 'r+')
        if not f then error('не удалось открыть файл: ' .. filePath) end
        local content = f:read('*a')
        f:close()

        local trimmed = content:gsub('%s+$', '')
        if trimmed:sub(-1) ~= ']' then
            -- Файл повреждён (обрыв записи) — пересоздаём массив с этой записью
            log('файл повреждён, пересоздаю: ' .. filePath)
            f = io.open(filePath, 'w')
            if not f then error('не удалось пересоздать файл: ' .. filePath) end
            f:write('[' .. encoded .. ']\n')
            f:close()
            return
        end

        -- Вставляем ',запись' перед закрывающей ']'
        local newContent = trimmed:sub(1, -2) .. ',' .. encoded .. ']\n'
        f = io.open(filePath, 'w')
        if not f then error('не удалось записать файл: ' .. filePath) end
        f:write(newContent)
        f:close()
    end)
    if not ok then
        log('appendNewsRecord ошибка: ' .. tostring(err))
        return false
    end
    return true
end

-- ══════════════════════════════════════════════════════════════
-- ОБРАБОТЧИК СОБЫТИЯ OnNews
-- ══════════════════════════════════════════════════════════════

-- QLua: вызывается при получении нового сообщения в окне новостей.
--   class — класс новости (строка)
--   news  — таблица: { code = "строка", time = "ЧЧ:ММ:СС", msg = "текст" }
function OnNews(class, news)
    -- Защищаемся от любых ошибок — скрипт не должен ронять QUIK
    local ok, err = pcall(function()
        if type(news) ~= 'table' then
            log('OnNews: news = nil (пропуск)')
            return
        end

        local text = tostring(news.msg or ''):gsub('%s+$', '')
        if text == '' then
            log('OnNews: пустой текст (пропуск)')
            return
        end

        -- Код новости (уникален в пределах источника). Если пуст —
        -- генерируем собственный id из времени + счётчика.
        local id = tostring(news.code or '')
        if id == '' then
            id = 'n_' .. tostring(os.time()) .. '_' .. tostring(math.random(1000, 9999))
        end

        -- Время: QLua отдаёт "ЧЧ:ММ:СС" без даты — добавляем сегодняшнюю дату
        local rawTime = tostring(news.time or '00:00:00')
        local timeIso = os.date('%Y-%m-%d') .. 'T' .. rawTime

        local record = {
            id = id,
            className = tostring(class or ''),
            time = timeIso,
            text = text,
        }

        -- Файл на текущий день: news_ГГГГММДД.json
        local fileName = 'news_' .. os.date('%Y%m%d') .. '.json'
        local filePath = NEWS_FILE_BASE .. fileName

        local written = appendNewsRecord(filePath, record)
        if written then
            log('записано: ' .. id .. ' | ' .. timeIso)
        end
    end)
    if not ok then
        log('OnNews критическая ошибка: ' .. tostring(err))
    end
end

-- ══════════════════════════════════════════════════════════════
-- ТОЧКА ВХОДА
-- ══════════════════════════════════════════════════════════════

-- main() обязательна для QLua-скриптов. Скрипт работает в событийном
-- режиме (OnNews), поэтому main просто логирует старт и завершается.
function main()
    log('скрипт запущен. Выходной каталог: ' .. NEWS_FILE_BASE)
end

log('загружен (модуль)')
