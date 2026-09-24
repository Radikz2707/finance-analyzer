/**
 * Dashboard Module — визуализация портфеля, метрик и графиков
 * Работает с Chart.js для рендеринга и db-manager для загрузки данных
 */

import { positionsRepo, pricesRepo, macroRepo, newsRepo } from '../db-manager/db-manager';
import type { PortfolioPosition, NewsRecord } from '../db-manager/types';
import { getStats, operationalMemory, strategicMemory, cleanup, exportMemory } from '../pipeline/ai-memory/index.js';
import type { AIMemoryStats } from '../pipeline/ai-memory/types.js';

// ──────────────────────────────────────────────
// Типы данных для dashboard
// ──────────────────────────────────────────────

interface DashboardData {
  kpi: {
    totalBalance: number;
    totalGain: number;
    assetsCount: number;
    qualityScore: number;
  };
  portfolioDistribution: {
    labels: string[];
    values: number[];
    colors: string[];
  };
  returnsHistory: {
    dates: string[];
    values: number[];
  };
  portfolioPositions: PortfolioPosition[];
  alerts: NewsRecord[];
  backtesting: {
    accuracy: number;
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
  };
  optimization: {
    sharpeOpt: number;
    sharpeEq: number;
    sortino: number;
    improvement: number;
    frontier: {
      labels: string[];
      risk: number[];
      return: number[];
    };
    weights: {
      labels: string[];
      values: number[];
    };
  };
  quality: {
    score: number;
    good: number;
    fair: number;
    poor: number;
    details: {
      ticker: string;
      score: number;
      errors: number;
      warnings: number;
    }[];
  };
}

// ──────────────────────────────────────────────
// Типы данных для AI Memory
// ──────────────────────────────────────────────

interface MemoryKpiTrend {
  dates: string[];
  values: number[];
}

interface DashboardMemoryData {
  stats: AIMemoryStats;
  kpiTrend: MemoryKpiTrend;
  operationalEntries: Array<{
    id: string;
    type: string;
    priority: string;
    keywords: string[];
    createdAt: string;
    content: string;
  }>;
  strategicEntries: Array<{
    id: string;
    date: string;
    raw: {
      totalValue: number;
      returnPercent: number;
      sharpeRatio: number;
      maxDrawdown: number;
    };
  }>;
  anomalies: Array<{
    type: string;
    severity: number;
    description: string;
    date: string;
  }>;
}

// ──────────────────────────────────────────────
// Цвета для графиков
// ──────────────────────────────────────────────

const CHART_COLORS = [
  '#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed',
  '#0891b2', '#c026d3', '#ea580c', '#4f46e5', '#15803d',
  '#d97706', '#dc2626', '#0d9488', '#9333ea', '#db2777',
];

// ──────────────────────────────────────────────
// Загрузка данных из БД
// ──────────────────────────────────────────────

function loadDashboardData(): DashboardData {
  const positions = positionsRepo.getAllActive();
  const summary = positionsRepo.getPortfolioSummary();
  const latestNews = newsRepo.getUnprocessed(10);
  macroRepo.getLatest(); // макроэкономические данные (загружаются для будущей интеграции)

  // KPI
  const kpi = {
    totalBalance: summary.totalMarketValue,
    totalGain: summary.totalGain,
    assetsCount: summary.activeCount,
    qualityScore: 85, // TODO: расчёт на основе quality validation
  };

  // Распределение портфеля
  const portfolioDistribution = {
    labels: positions.map(p => p.ticker),
    values: positions.map(p => p.currentMarketValue || 0),
    colors: CHART_COLORS.slice(0, positions.length),
  };

  // Динамика доходности (загружаем из price_snapshots)
  const returnsHistory = {
    dates: [] as string[],
    values: [] as number[],
  };

  // Заполняем демо-данными если нет реальных
  if (positions.length > 0) {
    const ticker = positions[0].ticker;
    const snapshots = pricesRepo.getLast(ticker, 30);
    returnsHistory.dates = snapshots.map(s => s.date);
    returnsHistory.values = snapshots.map(s => s.close);
  }

  // Backtesting метрики (демо-данные, потом из backtesting модуля)
  const backtesting = {
    accuracy: 72,
    sharpe: 1.45,
    maxDrawdown: 12.3,
    winRate: 65,
  };

  // Оптимизация (демо-данные)
  const optimization = {
    sharpeOpt: 1.82,
    sharpeEq: 1.15,
    sortino: 2.34,
    improvement: 28,
    frontier: {
      labels: ['Низкий риск', 'Средний риск', 'Высокий риск'],
      risk: [5, 15, 25],
      return: [8, 12, 18],
    },
    weights: {
      labels: positions.map(p => p.ticker),
      values: positions.map(p => {
        const total = summary.totalMarketValue || 1;
        return ((p.currentMarketValue || 0) / total) * 100;
      }),
    },
  };

  // Quality metrics
  const quality = {
    score: kpi.qualityScore,
    good: Math.floor(positions.length * 0.6),
    fair: Math.floor(positions.length * 0.3),
    poor: Math.max(0, positions.length - Math.floor(positions.length * 0.9)),
    details: positions.map(p => ({
      ticker: p.ticker,
      score: Math.floor(70 + Math.random() * 30),
      errors: Math.floor(Math.random() * 3),
      warnings: Math.floor(Math.random() * 5),
    })),
  };

  return { kpi, portfolioDistribution, returnsHistory, portfolioPositions: positions, alerts: latestNews, backtesting, optimization, quality };
}

// ──────────────────────────────────────────────
// Переключение табов
// ──────────────────────────────────────────────

function initTabs(): void {
  const navItems = document.querySelectorAll('.dashboard__nav-item');
  const tabs = document.querySelectorAll('.dashboard__tab');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = (item as HTMLElement).dataset.tab;

      // Убираем активный класс у всех
      navItems.forEach(n => n.classList.remove('dashboard__nav-item--active'));
      tabs.forEach(t => t.classList.remove('dashboard__tab--active'));

      // Добавляем активный класс нужному
      if (item instanceof HTMLElement) {
        item.classList.add('dashboard__nav-item--active');
      }

      const targetTab = document.getElementById(`tab-${tabName}`);
      if (targetTab) {
        targetTab.classList.add('dashboard__tab--active');
      }

      // Обновляем заголовок
      const pageTitle = document.getElementById('pageTitle');
      if (pageTitle && item instanceof HTMLElement) {
        pageTitle.textContent = item.textContent?.trim().replace(/[📈💼🧪⚡✅]/gu, '').trim() || 'Обзор';
      }
    });
  });
}

// ──────────────────────────────────────────────
// Рендеринг KPI
// ──────────────────────────────────────────────

function renderKPI(data: DashboardData): void {
  const kpiTotalBalance = document.getElementById('kpiTotalBalance');
  const kpiTotalGain = document.getElementById('kpiTotalGain');
  const kpiAssets = document.getElementById('kpiAssets');
  const kpiQuality = document.getElementById('kpiQuality');

  if (kpiTotalBalance) {
    kpiTotalBalance.textContent = `${data.kpi.totalBalance.toLocaleString('ru-RU')} ₽`;
  }
  if (kpiTotalGain) {
    const sign = data.kpi.totalGain >= 0 ? '+' : '';
    const color = data.kpi.totalGain >= 0 ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #dc2626)';
    kpiTotalGain.textContent = `${sign}${data.kpi.totalGain.toLocaleString('ru-RU')} ₽`;
    kpiTotalGain.style.color = color;
  }
  if (kpiAssets) {
    kpiAssets.textContent = data.kpi.assetsCount.toString();
  }
  if (kpiQuality) {
    kpiQuality.textContent = `${data.kpi.qualityScore}%`;
  }
}

// ──────────────────────────────────────────────
// Рендеринг графиков Chart.js
// ──────────────────────────────────────────────

let charts: Record<string, unknown> = {};

function renderCharts(data: DashboardData): void {
  // Уничтожаем старые графики
  Object.values(charts).forEach(chart => {
    if (chart && typeof chart === 'object' && 'destroy' in chart) {
      (chart as { destroy: () => void }).destroy();
    }
  });
  charts = {};

  // 1. Распределение портфеля (Pie)
  const portfolioCanvas = document.getElementById('chartPortfolio') as HTMLCanvasElement | null;
  if (portfolioCanvas && data.portfolioDistribution.values.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    charts.portfolio = new (window as any).Chart(portfolioCanvas, {
      type: 'doughnut',
      data: {
        labels: data.portfolioDistribution.labels,
        datasets: [{
          data: data.portfolioDistribution.values,
          backgroundColor: data.portfolioDistribution.colors,
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
        },
      },
    });
  }

  // 2. Динамика доходности (Line)
  const returnsCanvas = document.getElementById('chartReturns') as HTMLCanvasElement | null;
  if (returnsCanvas && data.returnsHistory.dates.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    charts.returns = new (window as any).Chart(returnsCanvas, {
      type: 'line',
      data: {
        labels: data.returnsHistory.dates,
        datasets: [{
          label: 'Доходность',
          data: data.returnsHistory.values,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          fill: true,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: { beginAtZero: false },
        },
      },
    });
  }

  // 3. Точность рекомендаций (Bar)
  const accuracyCanvas = document.getElementById('chartAccuracy') as HTMLCanvasElement | null;
  if (accuracyCanvas) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    charts.accuracy = new (window as any).Chart(accuracyCanvas, {
      type: 'bar',
      data: {
        labels: ['Точность', 'Sharpe', 'Win Rate'],
        datasets: [{
          label: 'Метрики',
          data: [data.backtesting.accuracy, data.backtesting.sharpe * 50, data.backtesting.winRate],
          backgroundColor: ['#2563eb', '#16a34a', '#f59e0b'],
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  // 4. ROI по активам (Bar horizontal)
  const roiCanvas = document.getElementById('chartROI') as HTMLCanvasElement | null;
  if (roiCanvas && data.portfolioDistribution.labels.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    charts.roi = new (window as any).Chart(roiCanvas, {
      type: 'bar',
      data: {
        labels: data.portfolioDistribution.labels.slice(0, 10),
        datasets: [{
          label: 'ROI %',
          data: data.portfolioDistribution.values.slice(0, 10).map(() => Math.floor(Math.random() * 30 - 5)),
          backgroundColor: '#7c3aed',
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: { display: false },
        },
      },
    });
  }

  // 5. Efficient Frontier (Scatter)
  const frontierCanvas = document.getElementById('chartFrontier') as HTMLCanvasElement | null;
  if (frontierCanvas) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    charts.frontier = new (window as any).Chart(frontierCanvas, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'Efficient Frontier',
          data: data.optimization.frontier.risk.map((risk, i) => ({
            x: risk,
            y: data.optimization.frontier.return[i],
          })),
          backgroundColor: '#2563eb',
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: { title: { display: true, text: 'Риск (%)' } },
          y: { title: { display: true, text: 'Доходность (%)' } },
        },
      },
    });
  }

  // 6. Оптимальные веса (Pie)
  const weightsCanvas = document.getElementById('chartWeights') as HTMLCanvasElement | null;
  if (weightsCanvas && data.optimization.weights.values.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    charts.weights = new (window as any).Chart(weightsCanvas, {
      type: 'pie',
      data: {
        labels: data.optimization.weights.labels,
        datasets: [{
          data: data.optimization.weights.values,
          backgroundColor: CHART_COLORS.slice(0, data.optimization.weights.labels.length),
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
        },
      },
    });
  }
}

// ──────────────────────────────────────────────
// Рендеринг таблиц
// ──────────────────────────────────────────────

function renderPortfolioTable(data: DashboardData): void {
  const tbody = document.getElementById('portfolioBody');
  if (!tbody) return;

  if (data.portfolioPositions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Нет данных</td></tr>';
    return;
  }

  tbody.innerHTML = data.portfolioPositions.map(pos => {
    const pnl = pos.currentMarketValue ? pos.currentMarketValue - pos.totalCost : 0;
    const pnlPct = pos.totalCost > 0 ? ((pnl / pos.totalCost) * 100).toFixed(2) : '0.00';
    const pnlColor = pnl >= 0 ? '#16a34a' : '#dc2626';

    return `
      <tr>
        <td><strong>${pos.ticker}</strong></td>
        <td>${pos.name}</td>
        <td>${pos.assetType}</td>
        <td>${pos.quantity.toLocaleString('ru-RU')}</td>
        <td>${pos.avgPrice.toFixed(2)} ₽</td>
        <td>${(pos.currentPrice || 0).toFixed(2)} ₽</td>
        <td style="color: ${pnlColor}; font-weight: 600;">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ₽</td>
        <td style="color: ${pnlColor}; font-weight: 600;">${pnlPct}%</td>
      </tr>
    `;
  }).join('');
}

function renderQualityTable(data: DashboardData): void {
  const tbody = document.getElementById('qualityBody');
  if (!tbody) return;

  if (data.quality.details.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="table-empty">Нет данных</td></tr>';
    return;
  }

  tbody.innerHTML = data.quality.details
    .map((item) => {
      const scoreColor =
        item.score >= 80 ? '#16a34a' : item.score >= 60 ? '#f59e0b' : '#dc2626';

      return `
      <tr>
        <td><strong>${item.ticker}</strong></td>
        <td style="color: ${scoreColor}; font-weight: 600;">${item.score}</td>
        <td>${item.errors}</td>
        <td>${item.warnings}</td>
      </tr>
    `;
    })
    .join('');
}

// ──────────────────────────────────────────────
// Рендеринг метрик
// ──────────────────────────────────────────────

function renderMetrics(data: DashboardData): void {
  // Backtesting metrics
  const btAccuracy = document.getElementById('btAccuracy');
  const btSharpe = document.getElementById('btSharpe');
  const btDrawdown = document.getElementById('btDrawdown');
  const btWinRate = document.getElementById('btWinRate');

  if (btAccuracy) btAccuracy.textContent = `${data.backtesting.accuracy}%`;
  if (btSharpe) btSharpe.textContent = data.backtesting.sharpe.toFixed(2);
  if (btDrawdown) btDrawdown.textContent = `${data.backtesting.maxDrawdown}%`;
  if (btWinRate) btWinRate.textContent = `${data.backtesting.winRate}%`;

  // Optimization metrics
  const optSharpe = document.getElementById('optSharpe');
  const optSharpeEq = document.getElementById('optSharpeEq');
  const optSortino = document.getElementById('optSortino');
  const optImprovement = document.getElementById('optImprovement');

  if (optSharpe) optSharpe.textContent = data.optimization.sharpeOpt.toFixed(2);
  if (optSharpeEq)
    optSharpeEq.textContent = data.optimization.sharpeEq.toFixed(2);
  if (optSortino) optSortino.textContent = data.optimization.sortino.toFixed(2);
  if (optImprovement)
    optImprovement.textContent = `+${data.optimization.improvement}%`;

  // Quality metrics
  const qualityScore = document.getElementById('qualityScore');
  const qualityGood = document.getElementById('qualityGood');
  const qualityFair = document.getElementById('qualityFair');
  const qualityPoor = document.getElementById('qualityPoor');

  if (qualityScore) qualityScore.textContent = `${data.quality.score}%`;
  if (qualityGood) qualityGood.textContent = data.quality.good.toString();
  if (qualityFair) qualityFair.textContent = data.quality.fair.toString();
  if (qualityPoor) qualityPoor.textContent = data.quality.poor.toString();

  // Alerts
  const alertsList = document.getElementById('alertsList');
  if (alertsList) {
    if (data.alerts.length === 0) {
      alertsList.innerHTML = '<p class="alerts-list__empty">Нет алертов</p>';
    } else {
      alertsList.innerHTML = data.alerts
        .map((alert) => {
          const sentimentColor =
            alert.sentiment === 'POSITIVE'
              ? '#16a34a'
              : alert.sentiment === 'NEGATIVE'
                ? '#dc2626'
                : '#f59e0b';
          return `
          <div class="alert-item" style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <strong style="font-size: 14px;">${alert.title}</strong>
              <span style="color: ${sentimentColor}; font-size: 12px; font-weight: 600;">${alert.sentiment}</span>
            </div>
            <div style="font-size: 12px; color: #64748b;">${alert.source} · ${alert.date}</div>
          </div>
        `;
        })
        .join('');
    }
  }
}

// ──────────────────────────────────────────────
// Загрузка данных AI Memory
// ──────────────────────────────────────────────

/** Получить все аномалии из стратегической памяти */
function loadAnomalies(): Array<{
  type: string;
  severity: number;
  description: string;
  date: string;
}> {
  const allStrategic = strategicMemory.getAll(500);
  const anomalies: Array<{
    type: string;
    severity: number;
    description: string;
    date: string;
  }> = [];

  for (const entry of allStrategic) {
    // Аномалии могут быть в поле anomalies записи
    if (entry.anomalies && Array.isArray(entry.anomalies)) {
      for (const anomaly of entry.anomalies) {
        anomalies.push({
          type: anomaly.type,
          severity: anomaly.severity,
          description: anomaly.description,
          date: entry.date,
        });
      }
    }
    // Также проверяем запись типа 'anomaly'
    if (entry.type === 'anomaly' && entry.compressedData) {
      try {
        const parsed = JSON.parse(entry.compressedData);
        if (parsed.type && parsed.severity !== undefined) {
          anomalies.push({
            type: parsed.type,
            severity: parsed.severity,
            description: parsed.description || '',
            date: entry.date,
          });
        }
      } catch {
        // Ignoring parse errors
      }
    }
  }

  // Сортируем по серьёзности (убывание)
  anomalies.sort((a, b) => b.severity - a.severity);
  return anomalies;
}

function loadMemoryData(): DashboardMemoryData {
  const stats = getStats();

  // KPI тренд
  const strategicEntries = strategicMemory.getAll(20);
  const kpiTrend: MemoryKpiTrend = {
    dates: [],
    values: [],
  };

  for (const entry of strategicEntries) {
    if (entry.raw) {
      kpiTrend.dates.push(entry.date);
      kpiTrend.values.push(entry.raw.totalValue);
    }
  }

  // Оперативные записи (последние 20)
  const operationalEntries = operationalMemory.getRecent(20);
  const operationalData = operationalEntries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    priority: entry.priority,
    keywords: entry.keywords,
    createdAt: entry.createdAt,
    content: entry.content,
  }));

  // Стратегические записи
  const strategicData = strategicEntries.map((entry) => ({
    id: entry.id,
    date: entry.date,
    raw: entry.raw
      ? {
          totalValue: entry.raw.totalValue,
          returnPercent: entry.raw.returnPercent,
          sharpeRatio: entry.raw.sharpeRatio,
          maxDrawdown: entry.raw.maxDrawdown,
        }
      : null,
  })).filter((item): item is NonNullable<typeof item> & { raw: NonNullable<typeof item.raw> } => item.raw !== null);

  const anomalies = loadAnomalies();

  return { stats, kpiTrend, operationalEntries: operationalData, strategicEntries: strategicData, anomalies };
}

// ──────────────────────────────────────────────
// Рендеринг AI Memory
// ──────────────────────────────────────────────

/** Получить цвет индикатора серьёзности аномалии */
function getSeverityColor(severity: number): string {
  if (severity >= 0.8) return '#dc2626'; // critical — red
  if (severity >= 0.5) return '#f59e0b'; // high — orange
  if (severity >= 0.3) return '#2563eb'; // medium — blue
  return '#64748b'; // low — gray
}

/** Получить текстовое обозначение серьёзности */
function getSeverityLabel(severity: number): string {
  if (severity >= 0.8) return 'Критическая';
  if (severity >= 0.5) return 'Высокая';
  if (severity >= 0.3) return 'Средняя';
  return 'Низкая';
}

function renderMemory(data: DashboardMemoryData): void {
  // KPI карточки памяти
  const memOperationalCount = document.getElementById('memOperationalCount');
  const memStrategicCount = document.getElementById('memStrategicCount');
  const memOperationalSize = document.getElementById('memOperationalSize');
  const memAnomalies = document.getElementById('memAnomalies');

  if (memOperationalCount) memOperationalCount.textContent = data.stats.operationalCount.toString();
  if (memStrategicCount) memStrategicCount.textContent = data.stats.strategicCount.toString();
  if (memOperationalSize) memOperationalSize.textContent = `${(data.stats.operationalSizeBytes / 1024).toFixed(0)} КБ`;
  if (memAnomalies) memAnomalies.textContent = data.stats.recentAnomalies.toString();

  // KPI Trend Chart
  const kpiTrendCanvas = document.getElementById('chartKpiTrend') as HTMLCanvasElement | null;
  if (kpiTrendCanvas && data.kpiTrend.values.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).Chart && charts.kpiTrend) {
      (charts.kpiTrend as { destroy: () => void }).destroy();
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    charts.kpiTrend = new (window as any).Chart(kpiTrendCanvas, {
      type: 'line',
      data: {
        labels: data.kpiTrend.dates,
        datasets: [{
          label: 'Стоимость портфеля',
          data: data.kpiTrend.values,
          borderColor: '#7c3aed',
          backgroundColor: 'rgba(124, 58, 237, 0.1)',
          fill: true,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
        },
        scales: {
          y: { beginAtZero: false },
        },
      },
    });
  }

  // Оперативная память таблица
  const opBody = document.getElementById('memoryOperationalBody');
  if (opBody) {
    if (data.operationalEntries.length === 0) {
      opBody.innerHTML = '<tr><td colspan="5" class="table-empty">Нет данных</td></tr>';
    } else {
      opBody.innerHTML = data.operationalEntries
        .map((entry) => {
          const priorityColor =
            entry.priority === 'critical' ? '#dc2626' :
            entry.priority === 'high' ? '#f59e0b' :
            entry.priority === 'medium' ? '#2563eb' : '#64748b';

          return `
            <tr>
              <td>${entry.type}</td>
              <td style="color: ${priorityColor}; font-weight: 600;">${entry.priority}</td>
              <td>${entry.keywords.join(', ')}</td>
              <td>${new Date(entry.createdAt).toLocaleString('ru-RU')}</td>
              <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${entry.content}">${entry.content.substring(0, 100)}...</td>
            </tr>
          `;
        })
        .join('');
    }
  }

  // Стратегическая память таблица
  const stBody = document.getElementById('memoryStrategicBody');
  if (stBody) {
    if (data.strategicEntries.length === 0) {
      stBody.innerHTML = '<tr><td colspan="5" class="table-empty">Нет данных</td></tr>';
    } else {
      stBody.innerHTML = data.strategicEntries
        .map((entry) => {
          const returnColor = entry.raw.returnPercent >= 0 ? '#16a34a' : '#dc2626';
          return `
            <tr>
              <td>${new Date(entry.date).toLocaleDateString('ru-RU')}</td>
              <td>${entry.raw.totalValue.toLocaleString('ru-RU')} ₽</td>
              <td style="color: ${returnColor}; font-weight: 600;">${entry.raw.returnPercent >= 0 ? '+' : ''}${entry.raw.returnPercent}%</td>
              <td>${entry.raw.sharpeRatio.toFixed(2)}</td>
              <td>${entry.raw.maxDrawdown}%</td>
            </tr>
          `;
        })
        .join('');
    }
  }

  // Аномалии таблица
  renderAnomalies(data.anomalies);
}

// ──────────────────────────────────────────────
// Рендеринг аномалий
// ──────────────────────────────────────────────

function renderAnomalies(anomalies: Array<{
  type: string;
  severity: number;
  description: string;
  date: string;
}>): void {
  const tbody = document.getElementById('memoryAnomaliesBody');
  if (!tbody) return;

  if (anomalies.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Аномалий не обнаружено</td></tr>';
    return;
  }

  tbody.innerHTML = anomalies
    .map((anomaly) => {
      const severityColor = getSeverityColor(anomaly.severity);
      const severityLabel = getSeverityLabel(anomaly.severity);

      return `
        <tr>
          <td><strong>${anomaly.type}</strong></td>
          <td>
            <span style="display: inline-flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${severityColor};"></span>
              <span style="color: ${severityColor}; font-weight: 600;">${severityLabel} (${(anomaly.severity * 100).toFixed(0)}%)</span>
            </span>
          </td>
          <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${anomaly.description}">${anomaly.description.substring(0, 120)}${anomaly.description.length > 120 ? '...' : ''}</td>
          <td>${new Date(anomaly.date).toLocaleDateString('ru-RU')}</td>
        </tr>
      `;
    })
    .join('');
}

// ──────────────────────────────────────────────
// Действия AI Memory
// ──────────────────────────────────────────────

function initMemoryActions(): void {
  // Очистка старых записей
  const btnCleanup = document.getElementById('btnCleanupMemory');
  if (btnCleanup) {
    btnCleanup.addEventListener('click', async () => {
      if (!confirm('Очистить старые записи из памяти?')) return;
      btnCleanup.textContent = '⏳ Очистка...';
      (btnCleanup as HTMLButtonElement).disabled = true;
      try {
        await cleanup();
        btnCleanup.textContent = '✅ Очищено!';
        setTimeout(() => {
          btnCleanup.textContent = '🧹 Очистить старые записи';
          (btnCleanup as HTMLButtonElement).disabled = false;
        }, 2000);
        // Обновляем данные
        const data = loadMemoryData();
        renderMemory(data);
      } catch (err) {
        console.error('[Dashboard] Ошибка очистки памяти:', err);
        btnCleanup.textContent = '❌ Ошибка';
        setTimeout(() => {
          btnCleanup.textContent = '🧹 Очистить старые записи';
          (btnCleanup as HTMLButtonElement).disabled = false;
        }, 2000);
      }
    });
  }

  // Экспорт в JSON
  const btnExportJson = document.getElementById('btnExportMemoryJson');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', async () => {
      try {
        const json = await exportMemory('json');
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-memory-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('[Dashboard] Ошибка экспорта JSON:', err);
      }
    });
  }

  // Экспорт в Markdown
  const btnExportMd = document.getElementById('btnExportMemoryMd');
  if (btnExportMd) {
    btnExportMd.addEventListener('click', async () => {
      try {
        const md = await exportMemory('markdown');
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-memory-${new Date().toISOString().split('T')[0]}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('[Dashboard] Ошибка экспорта Markdown:', err);
      }
    });
  }
}

// ──────────────────────────────────────────────
// Кнопки действий
// ──────────────────────────────────────────────

function initActions(): void {
  const btnRunPipeline = document.getElementById('btnRunPipeline');
  const btnRefresh = document.getElementById('btnRefresh');

  if (btnRunPipeline) {
    btnRunPipeline.addEventListener('click', () => {
      btnRunPipeline.textContent = '⏳ Запуск...';
      (btnRunPipeline as HTMLButtonElement).disabled = true;

      // Имитация запуска pipeline
      setTimeout(() => {
        btnRunPipeline.textContent = '✅ Готово!';
        setTimeout(() => {
          btnRunPipeline.textContent = '🚀 Запустить анализ';
          (btnRunPipeline as HTMLButtonElement).disabled = false;
        }, 2000);
      }, 3000);
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      init();
    });
  }
}

// ──────────────────────────────────────────────
// Главная функция инициализации
// ──────────────────────────────────────────────

export function init(): void {
  console.log('📊 Dashboard: инициализация...');

  // Инициализируем tab-переключатели
  initTabs();

  // Инициализируем кнопки действий
  initActions();

  // Инициализируем кнопки AI Memory
  initMemoryActions();

  // Загружаем данные и рендерим
  const data = loadDashboardData();

  renderKPI(data);
  renderCharts(data);
  renderPortfolioTable(data);
  renderQualityTable(data);
  renderMetrics(data);

  // Рендерим AI Memory
  const memoryData = loadMemoryData();
  renderMemory(memoryData);

  console.log('📊 Dashboard: успешно инициализирован');
}

// Автоматическая инициализация при DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
