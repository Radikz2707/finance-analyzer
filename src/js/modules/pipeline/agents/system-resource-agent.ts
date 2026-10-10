/**
 * SystemResourceAgent — мониторинг системных ресурсов (CPU/RAM).
 *
 * Тонкая обёртка над существующим [`ResourceMonitor`](../../resource-monitor/):
 * снимок загрузки CPU (по дельтам os.cpus()), занятость оперативной памяти,
 * признак занятости системы (пороги 70% CPU / 85% RAM).
 *
 * Назначение: роль `system` в Директоре — ответы на вопросы пользователя
 * «какая загрузка CPU», «сколько памяти», «состояние системы» из чата.
 * Операция только для чтения: security-gate не требуется.
 */

import * as os from 'os';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import { ResourceMonitor } from '../../resource-monitor/resource-monitor.js';

/** Вход SystemResourceAgent */
export interface SystemResourceInput {
  /** Пока единственное действие — снимок состояния системы */
  action: 'status';
}

/** Выход SystemResourceAgent */
export interface SystemResourceOutput {
  /** Загрузка CPU, % (0..100; первый замер — 0, baseline) */
  cpuUsagePct: number;
  /** Используемая память, МБ */
  memoryUsedMb: number;
  /** Общая память, МБ */
  memoryTotalMb: number;
  /** Занятость памяти, % */
  memoryUsagePct: number;
  /** Система сильно загружена (CPU или RAM выше порога) */
  isBusy: boolean;
  /** Число логических ядер */
  cores: number;
  /** Платформа (тип + версия ОС) */
  platform: string;
  /** Аптайм системы, сек */
  uptimeSec: number;
  /** Человекочитаемая сводка */
  message: string;
}

export class SystemResourceAgent extends AgentBase {
  private readonly monitor: ResourceMonitor;

  constructor(config?: AgentConfig) {
    super(config ?? { name: 'SystemResourceAgent' });
    this.monitor = new ResourceMonitor();
  }

  protected async executeInternal(
    input: unknown,
  ): Promise<SystemResourceOutput> {
    const action = (input as { action?: unknown } | null | undefined)?.action;
    if (action !== 'status') {
      throw new Error(
        `SystemResourceAgent: неизвестное действие: ${String(action)} (ожидается 'status')`,
      );
    }
    const snapshot = this.monitor.sample();
    const cores = os.cpus().length;
    const gb = (mb: number): string => `${(mb / 1024).toFixed(1)} ГБ`;
    const cpuPct = Math.round(snapshot.cpuUsagePct * 10) / 10;
    return {
      cpuUsagePct: cpuPct,
      memoryUsedMb: snapshot.memoryUsedMb,
      memoryTotalMb: snapshot.memoryTotalMb,
      memoryUsagePct: snapshot.memoryUsagePct,
      isBusy: snapshot.isBusy,
      cores,
      platform: `${os.type()} ${os.release()}`,
      uptimeSec: Math.round(os.uptime()),
      message:
        `Система: CPU ${cpuPct}% (${cores} ядер), память ` +
        `${gb(snapshot.memoryUsedMb)} из ${gb(snapshot.memoryTotalMb)} ` +
        `(${snapshot.memoryUsagePct}%)` +
        (snapshot.isBusy ? ' — система сильно загружена' : ''),
    };
  }
}
