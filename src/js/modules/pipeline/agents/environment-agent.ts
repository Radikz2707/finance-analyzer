/**
 * EnvironmentAgent - agent for understanding the environment.
 */

import * as os from 'os';
import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fsNode from 'fs';
import * as https from 'https';
import * as path from 'path';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';

/** Элемент ответа PowerShell Get-CimInstance Win32_LogicalDisk (байты) */
interface LogicalDisk {
  Size?: number;
  FreeSpace?: number;
}

export interface EnvironmentAgentInput {
  action:
    | 'scan-system'
    | 'monitor-resources'
    | 'detect-changes'
    | 'check-connectivity';
  options?: {
    watchedPaths?: string[];
    networkUrls?: string[];
  };
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  totalMemoryGb: number;
  freeMemoryGb: number;
  cpuModel: string;
  cpuCount: number;
  uptimeDays: number;
}

export interface ResourceUsage {
  cpuPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  memoryPercent: number;
  diskTotalGb: number;
  diskUsedGb: number;
  diskFreeGb: number;
  diskPercent: number;
  loadAvg: number[];
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  timestamp: string;
  size?: number;
}

export interface NetworkCheck {
  url: string;
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}

export interface EnvironmentScanResult {
  system: SystemInfo;
  resources: ResourceUsage;
  changes: FileChange[];
  connectivity: NetworkCheck[];
  timestamp: string;
}

export interface EnvironmentAgentOptions {
  watchedPaths?: string[];
  defaultNetworkUrls?: string[];
  snapshotDir?: string;
}

const DEFAULT_OPTIONS: EnvironmentAgentOptions = {
  watchedPaths: ['./data', './src'],
  defaultNetworkUrls: ['http://registry.npmjs.org', 'https://api.github.com'],
  snapshotDir: './data/.env-snapshots',
};

export class EnvironmentAgent extends AgentBase {
  private options: EnvironmentAgentOptions;
  private previousSnapshots: Map<string, string>;

  constructor(config: AgentConfig, options?: EnvironmentAgentOptions) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 30000 });
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.previousSnapshots = new Map();
    this.loadPreviousSnapshots();
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const params = input as EnvironmentAgentInput;
    switch (params.action) {
      case 'scan-system':
        return this.scanSystem();
      case 'monitor-resources':
        return this.monitorResources();
      case 'detect-changes':
        return await this.detectChanges(params.options?.watchedPaths);
      case 'check-connectivity':
        return await this.checkConnectivity(params.options?.networkUrls);
      default:
        throw new Error('Unknown action: ' + params.action);
    }
  }

  private scanSystem(): SystemInfo {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const uptimeSec = os.uptime();
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      totalMemoryGb: Math.round((totalMem / 1024 ** 3) * 100) / 100,
      freeMemoryGb: Math.round((freeMem / 1024 ** 3) * 100) / 100,
      cpuModel: os.cpus()[0]?.model ?? 'Unknown',
      cpuCount: os.cpus().length,
      uptimeDays: Math.floor(uptimeSec / 86400),
    };
  }

  private monitorResources(): ResourceUsage {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent =
      Math.round(((totalMem - freeMem) / totalMem) * 10000) / 100;
    const loadAvg = os.loadavg();
    let diskTotal = 0,
      diskFree = 0;
    try {
      const output = childProcess.execSync(
        'powershell -Command "Get-CimInstance Win32_LogicalDisk | Where-Object DriveType -eq 3 | Select-Object Size,FreeSpace | ConvertTo-Json"',
        { encoding: 'utf8', timeout: 5000 },
      );
      const disks = JSON.parse(output) as LogicalDisk[];
      if (Array.isArray(disks)) {
        disks.forEach((d: LogicalDisk) => {
          diskTotal += d.Size ?? 0;
          diskFree += d.FreeSpace ?? 0;
        });
      }
    } catch {
      diskTotal = 500 * 1024 ** 3;
      diskFree = 200 * 1024 ** 3;
    }
    const diskUsed = diskTotal - diskFree;
    const diskPercent =
      diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 10000) / 100 : 0;
    return {
      cpuPercent: Math.round(((loadAvg[0] ?? 0) / os.cpus().length) * 100),
      memoryUsedGb: Math.round(((totalMem - freeMem) / 1024 ** 3) * 100) / 100,
      memoryTotalGb: Math.round((totalMem / 1024 ** 3) * 100) / 100,
      memoryPercent: memPercent,
      diskTotalGb: Math.round((diskTotal / 1024 ** 3) * 100) / 100,
      diskUsedGb: Math.round((diskUsed / 1024 ** 3) * 100) / 100,
      diskFreeGb: Math.round((diskFree / 1024 ** 3) * 100) / 100,
      diskPercent,
      loadAvg,
    };
  }

  private loadPreviousSnapshots(): void {
    try {
      const dir = this.options.snapshotDir ?? DEFAULT_OPTIONS.snapshotDir!;
      if (fsNode.existsSync(dir)) {
        const files = fsNode.readdirSync(dir);
        files.forEach((file) => {
          if (file.endsWith('.json')) {
            const content = fsNode.readFileSync(path.join(dir, file), 'utf8');
            this.previousSnapshots.set(file.replace('.json', ''), content);
          }
        });
      }
    } catch {
      /* ignore */
    }
  }

  private saveCurrentSnapshot(watchedPaths: string[]): void {
    try {
      const dir = this.options.snapshotDir ?? DEFAULT_OPTIONS.snapshotDir!;
      if (!fsNode.existsSync(dir)) fsNode.mkdirSync(dir, { recursive: true });
      watchedPaths.forEach((watchPath) => {
        const hash = this.hashPath(watchPath);
        const snapshot = this.createPathSnapshot(watchPath);
        fsNode.writeFileSync(
          String(path.join(dir, hash + '.json')),
          snapshot,
          'utf8',
        );
        this.previousSnapshots.set(hash, snapshot);
      });
    } catch {
      /* ignore */
    }
  }

  private hashPath(p: string): string {
    return crypto.createHash('md5').update(p).digest('hex').slice(0, 12);
  }

  private createPathSnapshot(rootPath: string): string {
    const result: Map<string, { mtime: string; size: number }> = new Map();
    const walk = (dir: string): void => {
      try {
        const entries = fsNode.readdirSync(dir, { withFileTypes: true });
        entries.forEach((entry) => {
          const fullPath = String(path.join(dir, entry.name));
          if (entry.isDirectory()) walk(fullPath);
          else if (entry.isFile()) {
            const stats = fsNode.statSync(fullPath);
            result.set(fullPath, {
              mtime: stats.mtime.toISOString(),
              size: stats.size,
            });
          }
        });
      } catch {
        /* skip */
      }
    };
    walk(rootPath);
    return JSON.stringify(Array.from(result.entries()));
  }

  private async detectChanges(watchedPaths?: string[]): Promise<FileChange[]> {
    const paths: string[] = (watchedPaths ??
      this.options.watchedPaths ??
      DEFAULT_OPTIONS.watchedPaths) as string[];
    const changes: FileChange[] = [];
    const now = new Date().toISOString();
    paths.forEach((watchPath) => {
      const currentSnapshot = this.createPathSnapshot(watchPath);
      const hash = this.hashPath(watchPath);
      const previous = this.previousSnapshots.get(hash);
      if (!previous) {
        this.saveCurrentSnapshot(paths);
        return;
      }
      const prevMap = new Map(JSON.parse(previous) as [string, unknown][]);
      const currMap = new Map(
        JSON.parse(currentSnapshot) as [string, unknown][],
      );
      prevMap.forEach((_val, key) => {
        if (!currMap.has(key))
          changes.push({ path: key, type: 'deleted', timestamp: now });
      });
      currMap.forEach((val: unknown, key: string) => {
        const prev = prevMap.get(key) as
          { mtime?: string; size?: number } | undefined;
        if (!prev) {
          changes.push({
            path: key,
            type: 'created',
            timestamp: now,
            size: (val as { size?: number }).size,
          });
        } else if (
          prev.mtime !== (val as { mtime?: string }).mtime ||
          prev.size !== (val as { size?: number }).size
        ) {
          changes.push({
            path: key,
            type: 'modified',
            timestamp: now,
            size: (val as { size?: number }).size,
          });
        }
      });
    });
    this.saveCurrentSnapshot(paths);
    return changes;
  }

  private async checkConnectivity(urls?: string[]): Promise<NetworkCheck[]> {
    const targetUrls: string[] = (urls ??
      this.options.defaultNetworkUrls ??
      DEFAULT_OPTIONS.defaultNetworkUrls) as string[];
    const results: NetworkCheck[] = [];
    await Promise.all(
      targetUrls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const start = Date.now();
            const pushError = (error: string): void => {
              results.push({
                url,
                reachable: false,
                latencyMs: Date.now() - start,
                error,
              });
              resolve();
            };
            try {
              const req = https.get(url, { timeout: 5000 }, (res) => {
                res.resume();
                res.on('end', () => {
                  const status = res.statusCode ?? 0;
                  results.push({
                    url,
                    reachable: status >= 200 && status < 400,
                    latencyMs: Date.now() - start,
                  });
                  resolve();
                });
              });
              req.on('error', (err: Error) => {
                pushError(err.message);
              });
              req.on('timeout', () => {
                req.destroy();
                pushError('timeout');
              });
            } catch (err) {
              pushError(err instanceof Error ? err.message : String(err));
            }
          }),
      ),
    );
    return results;
  }

  async fullScan(): Promise<EnvironmentScanResult> {
    return {
      system: this.scanSystem(),
      resources: this.monitorResources(),
      changes: await this.detectChanges(),
      connectivity: await this.checkConnectivity(),
      timestamp: new Date().toISOString(),
    };
  }
}
