/**
 * VS Code Memory Checker — проверка процессов VS Code и их потребления памяти.
 *
 * Запуск:
 *   node scripts/check-vscode-memory.mjs
 *
 * Что проверяет:
 * 1. Все процессы Code.exe (главный + расширения + TypeScript)
 * 2. Суммарное потребление памяти
 * 3. Предупреждения о "прожорливых" процессах
 * 4. Рекомендации по оптимизации
 */

import { execSync } from 'node:child_process';
import * as os from 'node:os';

// ─── Утилиты ──────────────────────────────────────────────

/** Получить список процессов VS Code с памятью */
function getVsCodeProcesses() {
  try {
    // Windows: tasklist /FI "IMAGENAME eq Code.exe" /FO CSV /NH
    // Столбцы: Image Name, PID, Session Name, Session#, Mem Usage, etc.
    const output = execSync(
      'tasklist /FI "IMAGENAME eq Code.exe" /FO CSV /NH',
      { encoding: 'utf-8' },
    );

    const lines = output.trim().split('\n').filter((l) => l.trim());
    const processes = [];

    for (const line of lines) {
      // Формат CSV: "Code.exe","12345","Console","1","123,456 KB","0:00:00"
      const match = line.match(
        /"([^"]+)","(\d+)","([^"]+)","(\d+)","([\d,]+) KB","([^"]+)"/,
      );
      if (match) {
        processes.push({
          name: match[1],
          pid: parseInt(match[2], 10),
          session: match[3],
          sessionNum: match[4],
          memoryKB: parseInt(match[5].replace(/,/g, ''), 10),
          cpuTime: match[6],
        });
      }
    }

    return processes;
  } catch (err) {
    console.error('❌ Не удалось получить список процессов:', err.message);
    return [];
  }
}

/** Получить информацию о системе */
function getSystemInfo() {
  const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMB = Math.round(os.freemem() / (1024 * 1024));
  const usedMemMB = totalMemMB - freeMemMB;
  const usedPercent = Math.round((usedMemMB / totalMemMB) * 100);

  return {
    totalMB: totalMemMB,
    usedMB: usedMemMB,
    freeMB: freeMemMB,
    usedPercent,
    cpuCores: os.cpus().length,
    platform: os.platform(),
  };
}

/** Отформатировать размер */
function formatSize(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} ГБ`;
  return `${mb} МБ`;
}

// ─── Основная логика ──────────────────────────────────────

function main() {
  console.log('\n' + '='.repeat(70));
  console.log('🔍 VS Code Memory Checker');
  console.log('='.repeat(70));

  // 1. Информация о системе
  const sys = getSystemInfo();
  console.log('\n📊 Система:');
  console.log(`   Платформа:    ${sys.platform}`);
  console.log(`   Процессор:    ${sys.cpuCores} ядер`);
  console.log(`   Всего RAM:    ${formatSize(sys.totalMB)}`);
  console.log(`   Свободно:     ${formatSize(sys.freeMB)} (${100 - sys.usedPercent}%)`);
  console.log(`   Использовано: ${formatSize(sys.usedMB)} (${sys.usedPercent}%)`);

  // 2. Процессы VS Code
  const processes = getVsCodeProcesses();

  if (processes.length === 0) {
    console.log('\n⚠️  Процессы VS Code не найдены.');
    console.log('   VS Code сейчас не запущен.\n');
    return;
  }

  // Сортировка по памяти (по убыванию)
  processes.sort((a, b) => b.memoryKB - a.memoryKB);

  console.log(`\n📋 Найдено процессов VS Code: ${processes.length}`);
  console.log('-'.repeat(70));

  let totalVsCodeMemory = 0;
  const warnings = [];

    for (let i = 0; i < processes.length; i++) {
    const proc = processes[i];
    totalVsCodeMemory += proc.memoryKB;

    const memoryMB = Math.round(proc.memoryKB / 1024);
    const percent = ((proc.memoryKB / sys.totalMem) * 100).toFixed(1);

    // Иконка статуса
    let icon = '🟢';
    if (memoryMB > 1000) {
      icon = '🔴';
      warnings.push({
        pid: proc.pid,
        memoryMB,
        message: `PID ${proc.pid}: ${formatSize(memoryMB)} — очень много!`,
      });
    } else if (memoryMB > 500) {
      icon = '🟡';
      warnings.push({
        pid: proc.pid,
        memoryMB,
        message: `PID ${proc.pid}: ${formatSize(memoryMB)} — много`,
      });
    } else if (memoryMB > 200) {
      icon = '🔵';
    }

    console.log(
      `${icon} [${i + 1}] PID: ${proc.pid.toString().padStart(6)} | ` +
        `Память: ${formatSize(memoryMB).padStart(8)} (${percent}%) | ` +
        `Сессия: ${proc.session}#${proc.sessionNum} | ` +
        `CPU: ${proc.cpuTime}`,
    );
  }

  // 3. Суммарная статистика
  console.log('-'.repeat(70));
  console.log(
    `📊 Итого VS Code: ${formatSize(Math.round(totalVsCodeMemory / 1024))} | ` +
      `${((totalVsCodeMemory / sys.totalMem) * 100).toFixed(1)}% от всей RAM`,
  );

  // 4. Рекомендации
  console.log('\n' + '='.repeat(70));
  console.log('💡 Рекомендации:');
  console.log('='.repeat(70));

  if (warnings.length === 0) {
    console.log('   ✅ Все процессы в норме — память используется эффективно.');
  } else {
    console.log('   ⚠️  Обнаружены "прожорливые" процессы:\n');
    for (const w of warnings) {
      console.log(`   • ${w.message}`);
    }

    console.log('\n   📝 Возможные причины высокого потребления:\n');
    console.log('   1. Расширения (GitLens, Copilot, Docker и т.д.)');
    console.log('   2. TypeScript Language Service (tsserver)');
    console.log('   3. Фоновые задачи (lint, format, build)');
    console.log('   4. Несколько окон VS Code\n');

    console.log('   🔧 Что можно сделать:\n');
    console.log('   • Откройте Command Palette (Ctrl+Shift+P)');
    console.log('   • Введите: "Developer: Show Running Extensions"');
    console.log('   • Отсортируйте по столбцу Memory');
    console.log('   • Отключите ненужные расширения\n');
  }

  // 5. Общие рекомендации
  console.log('   🎯 Общие рекомендации по оптимизации:\n');
  console.log('   1. Отключите Live Server — у вас уже есть Gulp dev-сервер');
  console.log('   2. Отключите Prettier/ESLint — у вас есть lint в package.json');
  console.log('   3. Отключите GitLens — заменён встроенным Git');
  console.log('   4. Отключите AI-ассистенты (Copilot) — у вас GigaCode');
  console.log('   5. Закройте лишние окна и вкладки\n');

  // 6. Предупреждение о памяти системы
  if (sys.usedPercent > 85) {
    console.log(
      '   🚨 ВНИМАНИЕ: Система использует ' +
        `${sys.usedPercent}% RAM!\n`,
    );
    console.log('   🔴 Срочно освободите память:\n');
    console.log('   • Закройте браузер (Chrome жрёт 1-4 ГБ)');
    console.log('   • Закройте другие IDE (WebStorm, PyCharm)');
    console.log('   • Перезапустите VS Code');
    console.log('   • Проверьте Ollama (модель может занимать 20 ГБ)\n');
  }

  console.log('='.repeat(70) + '\n');
}

// Запуск
main();
