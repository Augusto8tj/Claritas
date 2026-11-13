'use client';

/**
 * @fileOverview LABORATÓRIO FOREX — estado e ações: carregar arquivos (Dukascopy/HistData/MetaTrader/zip), baixar velas da Deriv,
 * sondar payout/Multiplier de um par e gerar o super relatório (referência = par ou índice sintético do USD; alvo = um par).
 * SOMENTE PESQUISA: este hook não executa ordens.
 */
import { useState, useCallback } from 'react';
import type { CandleData } from '@/lib/types';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { readCandlesFromFile, mergeCandles, assessQuality, buildQualityText, type QualityReport } from '../services/candle-csv-import';
import { parseForexCsv, detectPairFromFilename, derivForexSymbol, fillShortGaps, weekendFuseDiagnostics } from '../services/forex-import';
import { buildUsdBasket } from '../services/usd-basket';
import { fetchDerivCandlesPaged } from '../services/deriv-candle-fetch';
import { runSuperReport, type SidePayouts } from '../services/super-report';
import { probePayout, probeMultiplier, buildPayoutProbeText, buildMultiplierProbeText, sweepPayouts, buildSweepText, SWEEP_TYPES_DEFAULT, type PayoutProbeResult, type MultiplierProbeResult } from '../services/payout-probe';
import { runBankrollSimulation, DEFAULT_BANKROLL_CFG, type BankrollCfg } from '../services/bankroll-sim';
import { runConfirmation } from '../services/forex-confirmation';

export interface FxDataset { pair: string; candles: CandleData[]; quality: QualityReport; source: string; files: number; filled: number; }
export const USD_INDEX = 'USD_INDEX';

export function useForexLab() {
    const { isConnected, getHistoricalData, getContractsFor, getProposal } = useDerivApi();
    const [datasets, setDatasets] = useState<Record<string, FxDataset>>({});
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [messages, setMessages] = useState<string[]>([]);
    const [reportText, setReportText] = useState('');
    const [payoutProbe, setPayoutProbe] = useState<PayoutProbeResult | null>(null);
    const [multiplierProbe, setMultiplierProbe] = useState<MultiplierProbeResult | null>(null);
    const [sweepText, setSweepText] = useState('');
    const [bankrollText, setBankrollText] = useState('');
    const [confirmText, setConfirmText] = useState('');
    const [rounds, setRounds] = useState(0); // rodadas de ~190 hipóteses nesta sessão (acúmulo de falso positivo)

    const addMsg = useCallback((m: string) => setMessages(prev => [...prev.slice(-30), m]), []);

    const ingest = useCallback((pair: string, incoming: CandleData[], source: string, files: number, skipped: number, fillGaps: boolean) => {
        setDatasets(prev => {
            const old = prev[pair];
            const merged = mergeCandles([...(old?.candles ?? []), ...incoming]);
            const f = fillGaps ? fillShortGaps(merged.candles, 5) : { candles: merged.candles, filled: 0 };
            const q = assessQuality(pair, { ...merged, candles: f.candles }, skipped);
            return { ...prev, [pair]: { pair, candles: f.candles, quality: q, source: old && old.source !== source ? `${old.source} + ${source}` : source, files: (old?.files ?? 0) + files, filled: f.filled } };
        });
    }, []);

    const loadFiles = useCallback(async (files: File[], opts: { tzOffsetHours: number; fillGaps: boolean }) => {
        if (busy || files.length === 0) return;
        setBusy(true);
        try {
            const acc = new Map<string, { candles: CandleData[]; skipped: number; files: number }>();
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                setProgress(`Lendo ${f.name} (${i + 1}/${files.length})...`);
                const pair = detectPairFromFilename(f.name);
                if (!pair) { addMsg(`Não reconheci o par no nome "${f.name}" (esperado algo como EURUSD, EUR_USD, frxEURUSD). Arquivo ignorado.`); continue; }
                try {
                    const r = await readCandlesFromFile(f, t => parseForexCsv(t, { tzOffsetHours: opts.tzOffsetHours }));
                    if (r.candles.length === 0) { addMsg(`${f.name}: nenhuma vela válida (formato não reconhecido?).`); continue; }
                    const g = acc.get(pair) ?? { candles: [], skipped: 0, files: 0 };
                    for (const c of r.candles) g.candles.push(c);
                    g.skipped += r.skipped; g.files += 1;
                    acc.set(pair, g);
                } catch (e) { addMsg(`${f.name}: ${(e as Error).message}`); }
            }
            acc.forEach((g, pair) => ingest(pair, g.candles, 'Arquivo', g.files, g.skipped, opts.fillGaps));
            addMsg(`Carregados: ${Array.from(acc.keys()).join(', ') || 'nenhum par'}.`);
        } finally { setBusy(false); setProgress(''); }
    }, [busy, ingest, addMsg]);

    const downloadFromDeriv = useCallback(async (pairs: string[], target: number, fillGaps: boolean) => {
        if (busy) return;
        if (!isConnected) { addMsg('Conecte-se à Deriv (indicador de status) para baixar velas.'); return; }
        setBusy(true);
        try {
            for (const pair of pairs) {
                const cs = await fetchDerivCandlesPaged(getHistoricalData as any, derivForexSymbol(pair), target, setProgress);
                if (cs.length === 0) { addMsg(`${pair}: a Deriv não devolveu velas (símbolo indisponível?).`); continue; }
                ingest(pair, cs, 'Deriv', 1, 0, fillGaps);
                addMsg(`${pair}: ${cs.length} velas da Deriv.`);
            }
        } catch (e) { addMsg(`Erro no download: ${(e as Error).message}`); }
        finally { setBusy(false); setProgress(''); }
    }, [busy, isConnected, getHistoricalData, ingest, addMsg]);

    const runProbes = useCallback(async (targetPair: string, durationMin: number) => {
        if (!isConnected) { addMsg('Conecte-se à Deriv para sondar payout e custo do Multiplier.'); return; }
        const sym = derivForexSymbol(targetPair);
        setProgress(`Sondando ${sym}...`);
        try {
            setPayoutProbe(await probePayout(getContractsFor, getProposal, sym, Math.round(durationMin * 60), 1));
            setMultiplierProbe(await probeMultiplier(getContractsFor, getProposal, sym, 10, 'MULTDOWN'));
        } finally { setProgress(''); }
    }, [isConnected, getContractsFor, getProposal, addMsg]);

    /** VARREDURA: pares x durações x lados (CALL/PUT/CALLE/PUTE) via proposal. NUNCA compra. Repita em horários diferentes. */
    const runSweep = useCallback(async (pairs: string[], durationsMin: number[], types: string[] = SWEEP_TYPES_DEFAULT) => {
        if (busy) return;
        if (!isConnected) { addMsg('Conecte-se à Deriv para varrer payouts.'); return; }
        setBusy(true);
        try {
            const r = await sweepPayouts(getContractsFor, getProposal, pairs.map(derivForexSymbol), durationsMin.map(m => Math.round(m * 60)), types, 1, { onProgress: setProgress });
            setSweepText(buildSweepText(r.rows, r.dumps));
        } catch (e) { setSweepText(`Erro na varredura: ${(e as Error).message}`); }
        finally { setBusy(false); setProgress(''); }
    }, [busy, isConnected, getContractsFor, getProposal, addMsg]);

    const runBankroll = useCallback((cfg: Partial<BankrollCfg>) => {
        setBankrollText(runBankrollSimulation({ ...DEFAULT_BANKROLL_CFG, ...cfg }).text);
    }, []);

    const sidePayouts = useCallback((): SidePayouts | undefined => (payoutProbe?.ok ? { call: payoutProbe.call?.payoutPct ?? null, put: payoutProbe.put?.payoutPct ?? null } : undefined), [payoutProbe]);
    const measuredCostBps = useCallback((): number | null => (multiplierProbe?.ok && multiplierProbe.quotes.length ? multiplierProbe.quotes.reduce((s, q) => s + q.costBps, 0) / multiplierProbe.quotes.length : null), [multiplierProbe]);

    /** TESTE CONFIRMATÓRIO PRÉ-REGISTRADO (m=1): regra C_SPREAD_z2_LIVRE_h60 em AUDUSD antes de 09/10/2026; demais pares = replicação exploratória. */
    const runPreregistered = useCallback(async () => {
        if (busy) return;
        setBusy(true); setProgress('Confirmação pré-registrada...');
        try {
            await new Promise(r => setTimeout(r, 20));
            const series: Record<string, CandleData[]> = {};
            Object.values(datasets).forEach(d => { series[d.pair] = d.candles; });
            setConfirmText(runConfirmation(series, { sidePayouts: sidePayouts(), costBps: measuredCostBps() }).text);
        } catch (e) { setConfirmText(`Erro: ${(e as Error).message}`); }
        finally { setBusy(false); setProgress(''); }
    }, [busy, datasets, sidePayouts, measuredCostBps]);

    const generateReport = useCallback(async (refKey: string, targetPair: string, excludeRollover = true) => {
        if (busy) return;
        const target = datasets[targetPair];
        if (!target) { setReportText('Carregue dados do par-alvo.'); return; }
        setBusy(true); setProgress('Montando a referência...');
        try {
            await new Promise(r => setTimeout(r, 20));
            let refCandles: CandleData[] | undefined, refName = refKey, basketNote = '';
            if (refKey === USD_INDEX) {
                const series: Record<string, CandleData[]> = {};
                Object.values(datasets).forEach(d => { series[d.pair] = d.candles; });
                const b = buildUsdBasket(series, targetPair);
                if (!b) { setReportText(`Índice do USD indisponível: carregue pelo menos 3 pares com USD do DXY (EURUSD, USDJPY, GBPUSD, USDCAD, USDCHF) além do alvo (${targetPair} e seu espelho são excluídos da cesta).`); return; }
                refCandles = b.candles; refName = 'USDX';
                basketNote = `Cesta do USD (leave-one-out, alvo e espelho excluídos): ${Object.entries(b.weights).map(([p, w]) => `${p} ${(w * 100).toFixed(0)}%`).join(', ')}`;
            } else {
                if (refKey === targetPair) { setReportText('A referência não pode ser o próprio alvo.'); return; }
                refCandles = datasets[refKey]?.candles;
                if (!refCandles) { setReportText('Carregue dados do par de referência.'); return; }
            }
            setProgress('Calculando o super relatório...');
            await new Promise(r => setTimeout(r, 20));
            const measuredCost = measuredCostBps();
            setRounds(r => r + 1);
            const payouts = payoutProbe?.ok && payoutProbe.put ? Array.from(new Set([Math.round(payoutProbe.put.payoutPct), 85, 90, 95])).sort((a, b) => a - b) : [85, 90, 95];
            const quality = buildQualityText([datasets[targetPair].quality, ...(refKey === USD_INDEX ? [] : [datasets[refKey].quality])]);
            const rep = runSuperReport(refCandles, target.candles, {
                names: { ref: refName, target: targetPair }, title: '[SUPER RELATÓRIO FOREX V27]', includeWindows: false, holdoutFraction: 0.4, extended: true, excludeRollover, sidePayouts: sidePayouts(),
                payouts, multipliers: [100, 200, 500], costScenarios: measuredCost !== null ? [Number(measuredCost.toFixed(2)), 0.5, 1, 2] : [0.5, 1, 2],
                assetNote: 'em Forex a Deriv oferece Rise/Fall: use a linha de payout MEDIDO pela sonda (se disponível); o Multiplier usa a comissão medida (bps do ativo).',
                source: `${target.source} (alvo ${targetPair}${refKey === USD_INDEX ? ', ref. índice USD' : `, ref. ${refKey}`})`,
                extraNotes: [`RODADA nº ${rounds + 1} desta sessão (cada rodada testa ~190 hipóteses: o risco de falso positivo acumula entre alvos).`, weekendFuseDiagnostics(target.candles).text, basketNote, payoutProbe ? buildPayoutProbeText(payoutProbe) : '', multiplierProbe ? buildMultiplierProbeText(multiplierProbe) : '', quality].filter(Boolean),
            });
            setReportText(rep.text);
        } catch (e) { setReportText(`Erro: ${(e as Error).message}`); }
        finally { setBusy(false); setProgress(''); }
    }, [busy, datasets, payoutProbe, multiplierProbe, rounds, sidePayouts, measuredCostBps]);

    return { isConnected, datasets, busy, progress, messages, reportText, payoutProbe, multiplierProbe, sweepText, bankrollText, confirmText, rounds, loadFiles, downloadFromDeriv, runProbes, runSweep, runBankroll, runPreregistered, generateReport, clear: () => { setDatasets({}); setReportText(''); setMessages([]); setSweepText(''); setBankrollText(''); setConfirmText(''); setRounds(0); } };
}
