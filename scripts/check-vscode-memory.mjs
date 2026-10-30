/**
 * Проверка потребления памяти VSCode.
 * Выводит текущие настройки и рекомендации по оптимизации.
 */

const os = await import('os');
const { execSync } = await import('child_process');

const totalMemoryMB = os.totalmem() / (1024 * 1024);
const freeMemoryMB = os.freemem() / (1024 * 1024);
const usedMemoryPercent = ((totalMemoryMB - freeMemoryMB) / totalMemoryMB * 100).toFixed(1);

console.log('\n📊 Проверка памяти VSCode\n');
console.log(`💻 ОС: ${os.platform()} ${os.release()}`);
console.log(`🧠 Общая память: ${(totalMemoryMB / 1024).toFixed(1)} GB`);
console.log(`📦 Свободно: ${(freeMemoryMB / 1024).toFixed(1)} GB`);
console.log(`📈 Загрузка: ${usedMemoryPercent}%\n`);

// Рекомендуемые настройки для VSCode
const recommendations = [];

if (totalMemoryMB < 16 * 1024) {
  recommendations.push('⚠️ У вас меньше 16 GB RAM. Закройте лишние вкладки в VSCode.');
} else if (totalMemoryMB < 32 * 1024) {
  recommendations.push('ℹ️ 16-32 GB RAM — оптимально для работы с проектом.');
} else {
  recommendations.push('✅ Более 32 GB RAM — достаточно для комфортной работы.');
}

if (usedMemoryPercent > 85) {
  recommendations.push('🔴 Высокая загрузка памяти. Закройте тяжелые процессы.');
} else if (usedMemoryPercent > 70) {
  recommendations.push('🟡 Средняя загрузка памяти. Можно оптимизировать.');
}

console.log('💡 Рекомендации:');
recommendations.forEach(r => console.log(`  ${r}`));

console.log('\n⚙️ Рекомендуемые настройки VSCode (settings.json):\n');
console.log('  "workbench.memory.priority": "high",');
console.log('  "extensions.autoUpdate": false,');
console.log('  "files.maxMemoryInGB": 4\n');

console.log('✅ Проверка завершена.\n');
