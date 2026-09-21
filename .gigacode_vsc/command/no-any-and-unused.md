# Правило: Запрет типа `any` и неиспользуемых переменных

## Обязательное требование

### 1. Запрет типа `any`
Запрещено использовать тип `any` в TypeScript-коде. Все переменные и параметры функций должны иметь явный тип.

#### ✅ Правильно
```typescript
function process(data: string): string {
  return data.toUpperCase();
}

const items: number[] = [1, 2, 3];
let value: string | null = null;
```

#### ❌ Неправильно
```typescript
function process(data: any): any {
  return data.toUpperCase();
}

const items = [1, 2, 3]; // Выведется any, если нет контекста
let value: any = null;
```

### 2. Запрет неиспользуемых переменных
Запрещено создавать переменные, которые никогда не используются в коде.

#### ✅ Правильно
```typescript
const name = 'test';
console.log(name); // name используется

function process(data: string) {
  return data.toUpperCase();
}
```

#### ❌ Неправильно
```typescript
const unused = 'never used'; // Никогда не используется

function process(data: string) {
  const unused = 'also never used';
  return data.toUpperCase();
}
```

#### Исключение: переменные с префиксом `_`
Переменные, начинающиеся с `_`, игнорируются (например, `_unused`, `_`).

```typescript
const _unused = 'this is allowed';
function callback(_arg1: string, _arg2: number) {
  // параметры с _ игнорируются
}
```

## Автоматическая проверка

Правила настроены в `eslint.config.js`:

```javascript
// Профиль 1: Основная кодовая база (JS, TS)
'@typescript-eslint/no-unused-vars': [
  'error',
  {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
  },
],
'@typescript-eslint/no-explicit-any': 'error',

// Профиль 2: Инфраструктура сборщика
'no-unused-vars': [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
],
```

## Применение

Правило применяется ко **всем** файлам проекта:
- `src/js/**/*.ts`
- `src/js/**/*.js`
- Конфигурационные файлы в корне проекта

При генерации или изменении кода всегда используй явные типы и удаляй неиспользуемые переменные.
