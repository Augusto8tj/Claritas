// src/features/trading/hooks/use-backtest-runner.ts
'use client';

import { useState, useRef, useCallback } from 'react';
import type { CandleData } from '@/lib/types';
import { backtestCandlesAsync, mergeStats, type RuleReport } from '../services/backtest';
import { groupOf } from '../services/report-builders';
import { runLeadLagBacktest as runLLLogic } from '../services/leadlag-backtest';

export function useBacktestRunner(getHistoricalData: any) {
    const [backtest, setBacktest] = useState<{
        running: boolean;
        progress: string;
        ts: number | null;
        payoutPct: number;
        merged: Record<string, { recent: RuleReport[] | null, older: RuleReport[] | null }>;
        perAsset: Record<string, { recent: RuleReport[], older?: RuleReport[] }>;
        assetCounts: Record<string, number>;
        assetMeta: Record<string, { n: number, from: string, to: string, mid?: string }>;
        leadLagReport?: any;
    }>({ 
        running: false, progress: '', ts: null, payoutPct: 85, 
        merged: {}, perAsset: {}, assetCounts: {}, assetMeta: {} 
    });

    const runningRef = useRef(false);

    const fetchCandlesPaged = async (sym: string, target: number, onProgress: (msg: string) => void): Promise<CandleData[]> => {
        let all: CandleData[] = [];
        let endEpoch: number | undefined = undefined;
        
        for (let pageIdx = 0; pageIdx < 40; pageIdx++) {
            const count = Math.min(5000, target - all.length);
            if (count <= 0) break;
            
            const page = await getHistoricalData(sym, 'candles', count, '1m', endEpoch);
            const valid = page.filter((h: any) => h.open !== undefined && h.high !== undefined && h.low !== undefined && h.close !== undefined) as CandleData[];
            
            if (valid.length === 0) break;
            
            const minEpoch = valid.reduce((min, v) => v.epoch < min ? v.epoch : min, valid[0].epoch);
            const existingMin = all.length > 0 ? all[0].epoch : Infinity;
            
            if (minEpoch >= existingMin && all.length > 0) break;

            all = [...valid, ...all].sort((a,b) => a.epoch - b.epoch);
            const uniqueMap = new Map<number, CandleData>();
            all.forEach(c => uniqueMap.set(c.epoch, c));
            all = Array.from(uniqueMap.values());
            
            endEpoch = minEpoch - 1;
            onProgress(`Baixando ${sym}: ${all.length}/${target}`);
            
            if (all.length >= target) break;
            await new Promise(r => setTimeout(r, 150));
        }
        return all;
    };

    const runBacktest = async (symbols: string[], payoutPct = 85, targetCount = 40000) => {
        if (runningRef.current) return;
        runningRef.current = true;
        setBacktest(prev => ({ 
            ...prev, running: true, progress: 'Iniciando...', 
            payoutPct, merged: {}, perAsset: {}, assetCounts: {}, assetMeta: {} 
        }));

        const perAsset: Record<string, { recent: RuleReport[], older?: RuleReport[] }> = {};
        const assetCounts: Record<string, number> = {};
        const assetMeta: Record<string, { n: number, from: string, to: string, mid?: string }> = {};

        try {
            for (const sym of symbols) {
                if (!sym) continue;
                const candles = await fetchCandlesPaged(sym, targetCount, (msg) => setBacktest(prev => ({ ...prev, progress: msg })));
                const n = candles.length;
                assetCounts[sym] = n;
                
                if (n < 1000) continue;

                const dataIni = new Date(candles[0].epoch * 1000).toLocaleDateString();
                const dataFim = new Date(candles[n - 1].epoch * 1000).toLocaleDateString();
                let meta = { n, from: dataIni, to: dataFim };

                if (n >= 2000) { // Division threshold
                    const mid = Math.floor(n / 2);
                    const olderCandles = candles.slice(0, mid);
                    const recentCandles = candles.slice(mid);
                    
                    setBacktest(prev => ({ ...prev, progress: `Calculando ${sym} (período Recente)...` }));
                    const recentReport = await backtestCandlesAsync(recentCandles as any, { payoutPct });
                    
                    setBacktest(prev => ({ ...prev, progress: `Calculando ${sym} (período Anterior)...` }));
                    const olderReport = await backtestCandlesAsync(olderCandles as any, { payoutPct });
                    
                    perAsset[sym] = { recent: recentReport, older: olderReport };
                    assetMeta[sym] = { ...meta, mid: new Date(candles[mid].epoch * 1000).toLocaleDateString() };
                } else {
                    setBacktest(prev => ({ ...prev, progress: `Calculando ${sym} (${n} candles)...` }));
                    perAsset[sym] = { recent: await backtestCandlesAsync(candles as any, { payoutPct }) };
                    assetMeta[sym] = meta;
                }
            }

            const groups = ['SINTETICOS', 'REAIS'];
            const merged: Record<string, { recent: RuleReport[] | null, older: RuleReport[] | null }> = {};

            groups.forEach(g => {
                const assetsInGroup = Object.keys(perAsset).filter(sym => groupOf(sym) === g);
                if (assetsInGroup.length === 0) return;

                const recentReports = assetsInGroup.map(sym => perAsset[sym].recent);
                const olderReports = assetsInGroup.map(sym => perAsset[sym].older).filter(Boolean) as RuleReport[][];

                merged[g] = {
                    recent: mergeStats(recentReports, payoutPct),
                    older: olderReports.length > 0 ? mergeStats(olderReports, payoutPct) : null
                };
            });

            setBacktest(prev => ({ ...prev, merged, perAsset, assetCounts, assetMeta, ts: Date.now(), running: false, progress: '' }));

        } catch (e: any) {
            console.error("Backtest error:", e);
        } finally {
            runningRef.current = false;
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    const runLeadLagBacktest = async (targetCount = 40000) => {
        if (runningRef.current) return;
        runningRef.current = true;
        setBacktest(prev => ({ ...prev, running: true, progress: 'Baixando Cluster BTC/ETH...' }));
        
        try {
            const btc = await fetchCandlesPaged('cryBTCUSD', targetCount, (msg) => setBacktest(prev => ({ ...prev, progress: msg })));
            const eth = await fetchCandlesPaged('cryETHUSD', targetCount, (msg) => setBacktest(prev => ({ ...prev, progress: msg })));
            
            setBacktest(prev => ({ ...prev, progress: 'Calculando Lead-Lag Walk-Forward...' }));
            const report = await runLLLogic(btc, eth);
            
            setBacktest(prev => ({ ...prev, leadLagReport: report, running: false, progress: '' }));
        } catch (e) {
            console.error(e);
        } finally {
            runningRef.current = false;
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    return { backtest, runBacktest, runLeadLagBacktest };
}