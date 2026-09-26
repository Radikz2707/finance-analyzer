import Database from 'better-sqlite3';

const db = new Database('./data/finance.db');

// Список всех таблиц
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
console.log('Tables:', tables);

// Если есть positions — покажем количество
try {
  const count = db.prepare('SELECT COUNT(*) as total FROM positions').get();
  console.log('positions count:', count);
} catch (e) {
  console.log('positions table does not exist');
}

db.close();
