/**
 * Preload — мост между renderer и main через contextBridge.
 *
 * Безопасная конфигурация: contextIsolation: true, nodeIntegration: false.
 * Renderer получает только типизированное API FinanceDesktopApi.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type {
  AskResult,
  DirectorAuditEvent,
  FinanceDesktopApi,
} from './api-types.js';

const api: FinanceDesktopApi = {
  ask: (question) => ipcRenderer.invoke('director:ask', question),
  getStatus: () => ipcRenderer.invoke('director:status'),
  getLog: (count) => ipcRenderer.invoke('director:log', count),
  getPanel: () => ipcRenderer.invoke('director:panel'),
  loadPortfolio: () => ipcRenderer.invoke('portfolio:status'),
  getHarnessPayload: () => ipcRenderer.invoke('harness:payload'),
  runHarnessAnalysis: () => ipcRenderer.invoke('harness:run'),
  exportDashboard: () => ipcRenderer.invoke('harness:export-report'),
  exportDashboardPdf: () => ipcRenderer.invoke('harness:export-pdf'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  pickExcelFile: () => ipcRenderer.invoke('settings:pick-excel'),
  restartApp: () => ipcRenderer.invoke('settings:restart'),
  getOllamaModels: () => ipcRenderer.invoke('settings:get-models'),
  setOllamaModel: (model) =>
    ipcRenderer.invoke('settings:set-ollama-model', model),

  onDirectorEvent: (callback) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: DirectorAuditEvent,
    ): void => {
      callback(payload);
    };
    ipcRenderer.on('director:event', listener);
    return () => {
      ipcRenderer.removeListener('director:event', listener);
    };
  },

  onDirectorReply: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: AskResult): void => {
      callback(payload);
    };
    ipcRenderer.on('director:reply', listener);
    return () => {
      ipcRenderer.removeListener('director:reply', listener);
    };
  },
};

contextBridge.exposeInMainWorld('financeApp', api);
