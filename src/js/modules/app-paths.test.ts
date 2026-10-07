/// <reference types="vitest/globals" />
/**
 * Тесты общих путей приложения: детект упакованного Electron (app.asar),
 * каталог данных и каталог отчётов (dev vs packaged).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  isPackagedApp,
  resolveAppDataDir,
  resolveReportsDir,
} from './app-paths.js';

describe('isPackagedApp', () => {
  it('рядом с exe лежит resources/app.asar → упакованное приложение', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-paths-test-'));
    try {
      fs.mkdirSync(path.join(tmp, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'resources', 'app.asar'), '');
      const exe = path.join(tmp, 'Finance Analyzer.exe');
      expect(isPackagedApp(exe, '38.8.6')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('без app.asar или без Electron — dev/Node режим', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-paths-dev-'));
    try {
      const exe = path.join(tmp, 'node.exe');
      expect(isPackagedApp(exe, undefined)).toBe(false);
      expect(isPackagedApp(exe, '38.8.6')).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('resolveReportsDir', () => {
  it('dev/CLI: отчёты рядом с cwd (прежнее поведение)', () => {
    expect(resolveReportsDir(false, 'C:\\project')).toBe('C:\\project');
  });

  it('упакованное приложение: %APPDATA%/finance-analyzer/reports', () => {
    const prev = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
    try {
      expect(
        resolveReportsDir(true, 'C:\\Program Files\\Finance Analyzer'),
      ).toBe('C:\\Users\\Test\\AppData\\Roaming\\finance-analyzer\\reports');
    } finally {
      if (prev === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prev;
    }
  });
});

describe('resolveAppDataDir', () => {
  it('в обычном Node возвращает <cwd>/data', () => {
    expect(resolveAppDataDir()).toBe(path.join(process.cwd(), 'data'));
  });

  it('упакованное приложение: %APPDATA%/finance-analyzer', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-paths-appdata-'));
    const prev = process.env.APPDATA;
    process.env.APPDATA = 'C:\\Users\\Test\\AppData\\Roaming';
    try {
      // Для детекта packaged рядом с exe должен лежать реальный resources/app.asar
      fs.mkdirSync(path.join(tmp, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'resources', 'app.asar'), '');
      const exe = path.join(tmp, 'Finance Analyzer.exe');
      expect(
        resolveAppDataDir({ execPath: exe, electronVersion: '38.8.6' }),
      ).toBe('C:\\Users\\Test\\AppData\\Roaming\\finance-analyzer');
    } finally {
      if (prev === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
