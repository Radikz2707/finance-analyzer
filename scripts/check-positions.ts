import Database from 'better-sqlite3';

const db = new Database('./data/finance.db');

// Проверка позиций
const count = db.prepare('SELECT COUNT(*) as total FROM positions').get();
console.log('positions count:', count);

if (count.total > 0) {
  const positions = db.prepare('SELECT ticker, quantity, avg_price, total_cost, current_price, current_market_value FROM positions').all();
  console.log('\nПозиции:');
  for (const p of positions) {
    console.log(`  ${p.ticker}: qty=${p.quantity}, price=${p.avg_price}, cost=${p.total_cost}, market=${p.current_market_value}`);
  }
} else {
  console.log('\n❌ Позиций нет!');
  console.log('\nПроверим, какие таблицы есть:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables);
}

db.close();
