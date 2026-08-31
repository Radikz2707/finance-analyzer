/* cspell:disable */
import { config } from '../../gulp.config.js';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Вспомогательный хелпер для безопасного импорта CLI-интерфейса ввода
 */
function getPromptEngine() {
  try {
    return require('readline-sync');
  } catch {
    try {
      return require('prompt-sync')();
    } catch {
      console.error(
        '❌ [CLI ERROR]: Для создания постов установите readline-sync или prompt-sync.',
      );
      return null;
    }
  }
}

/**
 * Функция транслитерации заголовков постов в ЧПУ-slug
 */
function slugify(text) {
  const map = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };
  return text
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[а-яё]/g, (char) => (map[char] !== undefined ? map[char] : char))
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Главная CLI задача автоматического создания новой статьи/поста
 */
export default function createPost(done) {
  const prompt = getPromptEngine();
  if (!prompt) return done();

  const contentRoot = path.join(config.srcFolder, 'content');
  if (!fs.existsSync(contentRoot)) {
    console.error('❌ [CLI ERROR]: Корневая папка контента не найдена.');
    return done();
  }

  const categories = fs.readdirSync(contentRoot).filter((f) => {
    return fs.statSync(path.join(contentRoot, f)).isDirectory() && f !== 'blog';
  });

  if (categories.length === 0) {
    console.warn(
      '⚠️ [CLI WARNING]: Нет доступных категорий для создания публикации.',
    );
    return done();
  }

  console.log('\n📂 Доступные категории для новой статьи:');
  categories.forEach((cat, index) => console.log(`  [${index + 1}] ${cat}`));

  // 🎯 ИСПРАВЛЕНО: Прямое присвоение константы без no-useless-assignment
  const selectedIndex =
    typeof prompt.keyInSelect === 'function'
      ? prompt.keyInSelect(categories, 'Выберите категорию для статьи')
      : parseInt(prompt('Введите номер категории: '), 10) - 1;

  if (selectedIndex === -1 || !categories[selectedIndex]) {
    console.log('🛑 Создание статьи отменено.');
    return done();
  }

  const targetCategory = categories[selectedIndex];

  // 🎯 ИСПРАВЛЕНО: Чистая инициализация заголовка на месте
  const rawTitle =
    typeof prompt.question === 'function'
      ? prompt.question('Введите заголовок статьи: ')
      : prompt('Введите заголовок статьи: ');

  const title = rawTitle ? rawTitle.trim() : '';

  if (!title) {
    console.error('❌ [CLI ERROR]: Заголовок не может быть пустым.');
    return done();
  }

  const slug = slugify(title);
  const targetFilePath = path.join(contentRoot, targetCategory, `${slug}.md`);

  if (fs.existsSync(targetFilePath)) {
    console.error(
      `❌ [CLI ERROR]: Статья с таким именем уже существует: ${targetFilePath}`,
    );
    return done();
  }

  const initialContent = [
    '---',
    `title: '${title}'`,
    `date: '${new Date().toISOString().split('T')[0]}'`,
    `category: '${targetCategory}'`,
    '---',
    '',
    'Начните писать контент вашей статьи здесь...',
    '',
  ].join('\n');

  try {
    fs.writeFileSync(targetFilePath, initialContent, 'utf-8');
    console.log('\n🎉 [SUCCESS]: Статья успешно создана!');
    console.log(`📍 Путь: ${targetFilePath}\n`);
  } catch {
    console.error('❌ [CLI ERROR]: Не удалось записать файл на диск.');
  }

  done();
}
