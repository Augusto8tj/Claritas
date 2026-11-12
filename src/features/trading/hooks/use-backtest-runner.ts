// src/features/trading/hooks/use-backtest-runner.ts
'use client';

import { useState, useRef, useCallback } from 'react';
import type { CandleData } from '@/lib/types';
import { backtestCandlesAsync, mergeStats, type RuleReport } from '../services/backtest';
import { groupOf } from '../services/report-builders';
import { runLeadLagBacktest as runLLLogic } from '../services/leadlag-backtest';
import { fetchTicksPaged, runTickStudy, type TickStudyReport } from '../services/leadlag-tick-study';
import { runHorizonHypotheses, type HypReport } from '../services/horizon-hypotheses';
import { runOosConfirmation, type OosReport } from '../services/oos-confirmation';
import { readCandlesFromFile, mergeCandles, assessQuality, buildQualityText } from '../services/candle-csv-import';
import { compareWindows, buildWindowComparisonReport } from '../services/window-comparison';

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
        tickStudyReport?: TickStudyReport;
        horizonReport?: HypReport;
        oosReport?: OosReport;
        importQuality?: string;
        windowComparisonText?: string;
        windowReports?: { pre: OosReport; desc: OosReport };
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

    // ETAPA 17: event study com ticks (BTC -> ETH), grade de 1 s
    const runLeadLagTickStudy = async (days = 3, latencySec = 4) => {
        if (runningRef.current) return;
        runningRef.current = true;
        setBacktest(prev => ({ ...prev, running: true, progress: 'Baixando ticks BTC/ETH...' }));
        try {
            const to = Math.floor(Date.now() / 1000) - 5;
            const from = to - Math.round(days * 86400);
            const onProgress = (msg: string) => setBacktest(prev => ({ ...prev, progress: msg }));
            const btc = await fetchTicksPaged(getHistoricalData, 'cryBTCUSD', from, to, onProgress);
            const eth = await fetchTicksPaged(getHistoricalData, 'cryETHUSD', from, to, onProgress);
            setBacktest(prev => ({ ...prev, progress: 'Calculando event study com ticks...' }));
            await new Promise(r => setTimeout(r, 20)); // deixa a UI atualizar antes do cálculo síncrono
            const report = runTickStudy(btc, eth, { latencySec });
            setBacktest(prev => ({ ...prev, tickStudyReport: report }));
        } catch (e) {
            console.error('Tick study error:', e);
        } finally {
            runningRef.current = false;
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    // ETAPA 18: hipóteses pré-registradas de 15/30 min (determinístico, sem LLM)
    const runHorizonStudy = async (targetCount = 40000, payoutPct = 80) => {
        if (runningRef.current) return;
        runningRef.current = true;
        setBacktest(prev => ({ ...prev, running: true, progress: 'Baixando velas BTC/ETH...' }));
        try {
            const onProgress = (msg: string) => setBacktest(prev => ({ ...prev, progress: msg }));
            const btc = await fetchCandlesPaged('cryBTCUSD', targetCount, onProgress);
            const eth = await fetchCandlesPaged('cryETHUSD', targetCount, onProgress);
            setBacktest(prev => ({ ...prev, progress: 'Calculando hipóteses 15/30 min...' }));
            await new Promise(r => setTimeout(r, 20));
            const report = runHorizonHypotheses(btc, eth, { payoutPct });
            setBacktest(prev => ({ ...prev, horizonReport: report }));
        } catch (e) {
            console.error('Horizon study error:', e);
        } finally {
            runningRef.current = false;
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    // ETAPA 19: confirmação fora da amostra da regra congelada H3_ALTA@15m (dados anteriores à janela de descoberta)
    const runOosStudy = async (targetCount = 120000, payoutPct = 80) => {
        if (runningRef.current) return;
        runningRef.current = true;
        setBacktest(prev => ({ ...prev, running: true, progress: 'Baixando histórico longo BTC/ETH...' }));
        try {
            const onProgress = (msg: string) => setBacktest(prev => ({ ...prev, progress: msg }));
            const btc = await fetchCandlesPaged('cryBTCUSD', targetCount, onProgress);
            const eth = await fetchCandlesPaged('cryETHUSD', targetCount, onProgress);
            setBacktest(prev => ({ ...prev, progress: 'Calculando confirmação fora da amostra...' }));
            await new Promise(r => setTimeout(r, 20));
            const report = runOosConfirmation(btc, eth, { payoutPct });
            setBacktest(prev => ({ ...prev, oosReport: report }));
        } catch (e) {
            console.error('OOS study error:', e);
        } finally {
            runningRef.current = false;
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    // ETAPA 20: confirmação fora da amostra com velas importadas de CSV (Binance Vision, Kaggle...), sem Deriv
    const runOosFromFiles = async (btcFiles: File[], ethFiles: File[], payoutPct = 80) => {
        if (runningRef.current) return;
        if (btcFiles.length === 0 || ethFiles.length === 0) {
            setBacktest(prev => ({ ...prev, importQuality: 'Selecione os arquivos CSV de BTC e de ETH.' }));
            return;
        }
        runningRef.current = true;
        setBacktest(prev => ({ ...prev, running: true, progress: 'Lendo arquivos CSV...' }));
        try {
            const read = async (files: File[]) => {
                const all: any[] = [];
                let skipped = 0;
                for (let i = 0; i < files.length; i++) {
                    setBacktest(prev => ({ ...prev, progress: `Lendo ${files[i].name} (${i + 1}/${files.length})...` }));
                    const r = await readCandlesFromFile(files[i]);
                    for (const c of r.candles) all.push(c);
                    skipped += r.skipped;
                }
                return { merged: mergeCandles(all), skipped };
            };
            const b = await read(btcFiles);
            const e = await read(ethFiles);
            const qualityText = buildQualityText([assessQuality('BTC', b.merged, b.skipped), assessQuality('ETH', e.merged, e.skipped)]);
            setBacktest(prev => ({ ...prev, importQuality: qualityText, progress: 'Calculando confirmação fora da amostra...' }));
            await new Promise(r => setTimeout(r, 20));
            const report = runOosConfirmation(b.merged.candles, e.merged.candles, { payoutPct, source: `CSV importado (${btcFiles.length} arquivo(s) BTC, ${ethFiles.length} arquivo(s) ETH)` });
            setBacktest(prev => ({ ...prev, oosReport: report }));
        } catch (err) {
            console.error('OOS CSV error:', err);
            setBacktest(prev => ({ ...prev, importQuality: `Erro ao ler os arquivos: ${(err as Error)?.message ?? err}` }));
        } finally {
            runningRef.current = false;
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    // ETAPA 22: mesma regra congelada em duas janelas (pré-descoberta x janela de descoberta), fonte CSV
    const runWindowComparisonFromFiles = async (btcFiles: File[], ethFiles: File[], payoutPct = 80) => {
        if (runningRef.current) return;
        if (btcFiles.length === 0 || ethFiles.length === 0) {
            setBacktest(prev => ({ ...prev, windowComparisonText: 'Selecione os arquivos CSV de BTC e de ETH.' }));
            return;
        }
        runningRef.current = true;
        setBacktest(prev => ({ ...prev, running: true, progress: 'Lendo arquivos CSV...' }));
        try {
            const readAll = async (files: File[]) => {
                const all: any[] = [];
                for (let i = 0; i < files.length; i++) {
                    setBacktest(prev => ({ ...prev, progress: `Lendo ${files[i].name} (${i + 1}/${files.length})...` }));
                    for (const c of (await readCandlesFromFile(files[i])).candles) all.push(c);
                }
                return mergeCandles(all);
            };
            const b = await readAll(btcFiles);
            const e = await readAll(ethFiles);
            const quality = buildQualityText([assessQuality('BTC', b), assessQuality('ETH', e)]);
            setBacktest(prev => ({ ...prev, importQuality: quality, progress: 'Comparando janelas...' }));
            await new Promise(r => setTimeout(r, 20));
            const cmp = compareWindows(b.candles, e.candles, { payoutPct, source: `CSV importado (${btcFiles.length} arquivo(s) BTC, ${ethFiles.length} arquivo(s) ETH)` });
            setBacktest(prev => ({ ...prev, windowComparisonText: buildWindowComparisonReport(cmp), windowReports: { pre: cmp.pre, desc: cmp.desc } }));
        } catch (err) {
            console.error('Window comparison error:', err);
            setBacktest(prev => ({ ...prev, windowComparisonText: `Erro: ${(err as Error)?.message ?? err}` }));
        } finally {
            runningRef.current = false;
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    return { backtest, runBacktest, runLeadLagBacktest, runLeadLagTickStudy, runHorizonStudy, runOosStudy, runOosFromFiles, runWindowComparisonFromFiles };
}