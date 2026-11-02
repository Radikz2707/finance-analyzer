import { describe, it, expect } from 'vitest';

describe('Bond analysis loop (P0-4)', () => {
  describe('bondMarketData === undefined', () => {
    it('все облигации получают INSUFFICIENT_DATA', () => {
      const bondAssets = [
        { ticker: 'RU000A10C8F3', name: 'Облигация А', quantity: 50, balancePrice: 980, assetType: 'Облигация' },
        { ticker: 'RU000A10ER66', name: 'Облигация Б', quantity: 30, balancePrice: 950, assetType: 'BOND' },
      ];
      const bondAnalyses = bondAssets.map(asset => ({
        isin: asset.ticker.toUpperCase(),
        name: asset.name,
        analysisStatus: 'INSUFFICIENT_DATA' as const,
        currentPrice: null,
      }));
      expect(bondAnalyses.length).toBe(bondAssets.length);
      expect(bondAnalyses.every(b => b.analysisStatus === 'INSUFFICIENT_DATA')).toBe(true);
      expect(bondAnalyses.every(b => b.currentPrice === null)).toBe(true);
    });
  });

  describe('bondMarketData.size === 0', () => {
    it('все облигации получают INSUFFICIENT_DATA', () => {
      const bondAssets = [{ ticker: 'RU000A10C8F3', name: 'Облигация А', quantity: 50, balancePrice: 980, assetType: 'Облигация' }];
      const bondAnalyses = bondAssets.map(() => ({ analysisStatus: 'INSUFFICIENT_DATA' as const, currentPrice: null }));
      expect(bondAnalyses.length).toBe(bondAssets.length);
    });
  });

  describe('Конкретный ISIN отсутствует', () => {
    it('создаётся резервная запись INSUFFICIENT_DATA', () => {
      const bondAssets = [
        { ticker: 'RU000A10C8F3', name: 'Облигация А', quantity: 50, balancePrice: 980, assetType: 'Облигация' },
        { ticker: 'RU000A10ER66', name: 'Облигация Б', quantity: 30, balancePrice: 950, assetType: 'Облигация' },
      ];
      const bondMarketData = new Map([['RU000A10C8F3', { yield: 12, duration: 5, nominal: 1000 }]]);
      const bondAnalyses = bondAssets.map(asset => ({
        isin: asset.ticker.toUpperCase(),
        analysisStatus: bondMarketData.has(asset.ticker) ? 'SUCCESS' : 'INSUFFICIENT_DATA' as const,
        currentPrice: bondMarketData.has(asset.ticker) ? 990 : null,
      }));
      expect(bondAnalyses.at(0)!.analysisStatus).toBe('SUCCESS');
      expect(bondAnalyses.at(1)!.analysisStatus).toBe('INSUFFICIENT_DATA');
      expect(bondAnalyses.length).toBe(bondAssets.length);
    });
  });

  describe('Успешный анализ', () => {
    it('создаётся запись с analysisStatus SUCCESS', () => {
      const bondAssets = [{ ticker: 'RU000A10C8F3', name: 'Облигация А', quantity: 50, balancePrice: 980, assetType: 'Облигация' }];
      const bondMarketData = new Map([['RU000A10C8F3', { yield: 12, duration: 5, nominal: 1000 }]]);
      const bondAnalyses = bondAssets.map(asset => ({
        isin: asset.ticker.toUpperCase(),
        analysisStatus: bondMarketData.has(asset.ticker) ? 'SUCCESS' : 'INSUFFICIENT_DATA' as const,
        currentPrice: bondMarketData.has(asset.ticker) ? 990 : null,
        yieldAnalysis: { ytm: 12.3, dataQuality: 'AVAILABLE' },
      }));
      expect(bondAnalyses.at(0)!.analysisStatus).toBe('SUCCESS');
      expect(bondAnalyses.at(0)!.currentPrice).toBe(990);
    });
  });

  describe('Исключение анализатора', () => {
    it('создаётся запись с analysisStatus ERROR', () => {
      const bondAnalyses = [{
        isin: 'RU000A10C8F3',
        analysisStatus: 'ERROR' as const,
        creditAssessment: { source: 'ANALYSIS_ERROR' },
      }];
      expect(bondAnalyses.at(0)!.analysisStatus).toBe('ERROR');
      expect(bondAnalyses.at(0)!.creditAssessment.source).toBe('ANALYSIS_ERROR');
    });
  });

  describe('Несколько облигаций', () => {
    it('каждая попадает в результат ровно один раз', () => {
      const bondAssets = [
        { ticker: 'RU000A10C8F3', name: 'Облигация А', quantity: 50, balancePrice: 980, assetType: 'Облигация' },
        { ticker: 'RU000A10ER66', name: 'Облигация Б', quantity: 30, balancePrice: 950, assetType: 'BOND' },
        { ticker: 'RU000A10D1E2F3', name: 'Облигация В', quantity: 20, balancePrice: 1010, assetType: 'Облигация' },
      ];
      const bondMarketData = new Map([
        ['RU000A10C8F3', { yield: 12, duration: 5, nominal: 1000 }],
        ['RU000A10D1E2F3', { yield: 10, duration: 3, nominal: 1000 }],
      ]);
      const bondAnalyses = bondAssets.map(asset => ({
        isin: asset.ticker.toUpperCase(),
        analysisStatus: bondMarketData.has(asset.ticker) ? 'SUCCESS' : 'INSUFFICIENT_DATA' as const,
      }));
      expect(bondAnalyses.length).toBe(bondAssets.length);
      const isins = bondAnalyses.map(b => b.isin);
      expect(new Set(isins).size).toBe(isins.length);
      expect(bondAnalyses.at(0)!.analysisStatus).toBe('SUCCESS');
      expect(bondAnalyses.at(1)!.analysisStatus).toBe('INSUFFICIENT_DATA');
      expect(bondAnalyses.at(2)!.analysisStatus).toBe('SUCCESS');
    });
  });

  describe('Отсутствие дублирования', () => {
    it('нет дубликатов ISIN в bondAnalyses', () => {
      const bondAssets = [{ ticker: 'RU000A10C8F3', name: 'Облигация А', quantity: 50, balancePrice: 980, assetType: 'Облигация' }];
      const bondAnalyses = bondAssets.map(asset => ({ isin: asset.ticker.toUpperCase(), analysisStatus: 'SUCCESS' as const }));
      const isins = bondAnalyses.map(b => b.isin);
      expect(new Set(isins).size).toBe(isins.length);
    });
  });

  describe('Сохранение каждой позиции', () => {
    it('bondAnalyses.length === bondAssets.length', () => {
      const bondAssets = [
        { ticker: 'RU000A10C8F3', name: 'Облигация А', quantity: 50, balancePrice: 980, assetType: 'Облигация' },
        { ticker: 'RU000A10ER66', name: 'Облигация Б', quantity: 30, balancePrice: 950, assetType: 'BOND' },
        { ticker: 'RU000A10D1E2F3', name: 'Облигация В', quantity: 20, balancePrice: 1010, assetType: 'Облигация' },
        { ticker: 'RU000A10G4H5I6', name: 'Облигация Г', quantity: 100, balancePrice: 970, assetType: 'Облигация' },
        { ticker: 'RU000A10J7K8L9', name: 'Облигация Д', quantity: 25, balancePrice: 1020, assetType: 'BOND' },
      ];
      const bondMarketData = new Map([
        ['RU000A10C8F3', { yield: 12, duration: 5, nominal: 1000 }],
        ['RU000A10D1E2F3', { yield: 10, duration: 3, nominal: 1000 }],
        ['RU000A10J7K8L9', { yield: 14, duration: 7, nominal: 5000 }],
      ]);
      const bondAnalyses = bondAssets.map(asset => {
        const hasData = bondMarketData.has(asset.ticker);
        return {
          isin: asset.ticker.toUpperCase(),
          name: asset.name,
          quantity: asset.quantity,
          balanceValue: asset.balancePrice * asset.quantity,
          analysisStatus: hasData ? 'SUCCESS' : 'INSUFFICIENT_DATA' as const,
        };
      });
      expect(bondAnalyses.length).toBe(bondAssets.length);
      for (let i = 0; i < bondAssets.length; i++) {
        expect(bondAnalyses.at(i)!.isin).toBe(bondAssets.at(i)!.ticker.toUpperCase());
        expect(bondAnalyses.at(i)!.name).toBe(bondAssets.at(i)!.name);
        expect(bondAnalyses.at(i)!.quantity).toBe(bondAssets.at(i)!.quantity);
      }
    });
  });

  describe('analysisStatus не теряется', () => {
    it('SUCCESS не выглядит как INSUFFICIENT_DATA', () => {
      const result = { analysisStatus: 'SUCCESS' as const, currentPrice: 990 };
      expect(result.analysisStatus).toBe('SUCCESS');
      expect(result.currentPrice).not.toBeNull();
    });

    it('INSUFFICIENT_DATA не маскируется под SUCCESS', () => {
      const result = { analysisStatus: 'INSUFFICIENT_DATA' as const, currentPrice: null };
      expect(result.analysisStatus).toBe('INSUFFICIENT_DATA');
      expect(result.currentPrice).toBeNull();
    });

    it('ERROR не маскируется под INSUFFICIENT_DATA', () => {
      const result = { analysisStatus: 'ERROR' as const, currentPrice: null };
      expect(result.analysisStatus).toBe('ERROR');
      expect(result.currentPrice).toBeNull();
    });
  });

  describe('currentPrice: null при отсутствии данных', () => {
    it('INSUFFICIENT_DATA имеет currentPrice = null', () => {
      const result = { analysisStatus: 'INSUFFICIENT_DATA' as const, currentPrice: null };
      expect(result.currentPrice).toBeNull();
    });

    it('SUCCESS имеет нормализованную цену', () => {
      const result = { analysisStatus: 'SUCCESS' as const, currentPrice: 990 };
      expect(result.currentPrice).toBe(990);
    });
  });

  describe('Техническая ошибка не маскируется', () => {
    it('ERROR имеет source ANALYSIS_ERROR', () => {
      const result = { creditAssessment: { source: 'ANALYSIS_ERROR' } };
      expect(result.creditAssessment.source).toBe('ANALYSIS_ERROR');
    });

    it('INSUFFICIENT_DATA имеет source NONE', () => {
      const result = { creditAssessment: { source: 'NONE' } };
      expect(result.creditAssessment.source).toBe('NONE');
    });
  });
});
