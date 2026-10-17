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
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Утилиты ──────────────────────────────────────────────

/** Получить список процессов VS Code с памятью */
function getVsCodeProcesses() {
  try {
    // Используем PowerShell с proper escaping
    const psScript = `
      $processes = Get-Process Code -ErrorAction SilentlyContinue
      if ($processes.Count -eq 0) {
        Write-Output "NONE"
      } else {
        $processes | ForEach-Object {
          $id = $_.Id
          $privMB = [math]::Round($_.PrivateMemorySize64/1MB, 1)
          $workMB = [math]::Round($_.WorkingSet64/1MB, 1)
          $cpu = $_.CPU
          Write-Output "$id|$privMB|$workMB|$cpu"
        }
      }
    `;

    // Записываем скрипт во временный файл и выполняем
    const tmpFile = path.join(os.tmpdir(), 'vscode-check.ps1');
    fs.writeFileSync(tmpFile, psScript, 'utf-8');

    const output = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { encoding: 'utf-8' },
    );

    // Удаляем временный файл
    fs.unlinkSync(tmpFile);

    const trimmed = output.trim();
    if (trimmed === 'NONE' || !trimmed) {
      return [];
    }

    const lines = trimmed.split('\n').filter((l) => l.trim());
    const processes = [];

    for (const line of lines) {
      // Формат: PID|PrivateMB|WorkingMB|CPU
      const parts = line.split('|');
      if (parts.length >= 4) {
        processes.push({
          pid: parseInt(parts[0], 10),
          privateMB: parseFloat(parts[1]),
          workingMB: parseFloat(parts[2]),
          cpu: parseFloat(parts[3]),
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
  return `${mb.toFixed(1)} МБ`;
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
  processes.sort((a, b) => b.privateMB - a.privateMB);

  console.log(`\n📋 Найдено процессов VS Code: ${processes.length}`);
  console.log('-'.repeat(70));

  let totalPrivateMemory = 0;
  let totalWorkingMemory = 0;
  const warnings = [];

  for (let i = 0; i < processes.length; i++) {
    const proc = processes[i];
    totalPrivateMemory += proc.privateMB;
    totalWorkingMemory += proc.workingMB;

    const percent = ((proc.privateMB / sys.totalMB) * 100).toFixed(1);

    // Иконка статуса
    let icon = '🟢';
    if (proc.privateMB > 1000) {
      icon = '🔴';
      warnings.push({
        pid: proc.pid,
        memoryMB: proc.privateMB,
        message: `PID ${proc.pid}: ${formatSize(proc.privateMB)} — очень много!`,
      });
    } else if (proc.privateMB > 500) {
      icon = '🟡';
      warnings.push({
        pid: proc.pid,
        memoryMB: proc.privateMB,
        message: `PID ${proc.pid}: ${formatSize(proc.privateMB)} — много`,
      });
    } else if (proc.privateMB > 200) {
      icon = '🔵';
    }

    console.log(
      `${icon} [${i + 1}] PID: ${proc.pid.toString().padStart(6)} | ` +
        `Private: ${formatSize(proc.privateMB).padStart(8)} | ` +
        `Working: ${formatSize(proc.workingMB).padStart(8)} | ` +
        `CPU: ${proc.cpu.toFixed(1)}с (${percent}%)`,
    );
  }

  // 3. Суммарная статистика
  console.log('-'.repeat(70));
  console.log(
    `📊 Итого: Private ${formatSize(totalPrivateMemory).padStart(8)} | ` +
      `Working ${formatSize(totalWorkingMemory).padStart(8)} | ` +
      `${((totalPrivateMemory / sys.totalMB) * 100).toFixed(1)}% от всей RAM`,
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
