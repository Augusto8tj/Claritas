// src/features/trading/hooks/use-skew-logger.ts
'use client';
/**
 * ETAPA 29 — coletor do experimento PREREG-SKEW-1. Só usa `proposal` (NUNCA compra). Roda enquanto a aba estiver aberta e conectada,
 * a cada 5 min, só em seg–sex 08:00–16:00 UTC. Persiste em localStorage (compacto) e permite baixar/importar CSV.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDerivApiV2 as useDerivApi } from './use-deriv-api-v2';
import { derivForexSymbol } from '../services/forex-import';
import { collectSkewOnce, inSkewWindow, mergeSkew, parseSkewCsv, serializeSkewCsv, buildSkewReport, type SkewSample } from '../services/payout-skew';

const KEY = 'claritas.skew.v1', TICK_MS = 5 * 60 * 1000;

export function useSkewLogger() {
    const { isConnected, getProposal } = useDerivApi();
    const [running, setRunning] = useState(false);
    const [samples, setSamples] = useState<SkewSample[]>([]);
    const [log, setLog] = useState<string[]>([]);
    const [report, setReport] = useState('');
    const connRef = useRef(isConnected), propRef = useRef(getProposal), samplesRef = useRef<SkewSample[]>([]), timer = useRef<ReturnType<typeof setInterval> | null>(null), busy = useRef(false);
    connRef.current = isConnected; propRef.current = getProposal;

    const addLog = useCallback((m: string) => setLog(l => [`${new Date().toISOString().slice(11, 19)}Z ${m}`, ...l].slice(0, 8)), []);
    const persist = useCallback((all: SkewSample[]) => {
        samplesRef.current = all; setSamples(all);
        try { localStorage.setItem(KEY, serializeSkewCsv(all)); } catch { addLog('Aviso: armazenamento local cheio/indisponível. Baixe o CSV agora.'); }
    }, [addLog]);

    useEffect(() => { try { const raw = localStorage.getItem(KEY); if (raw) { const s = parseSkewCsv(raw); samplesRef.current = s; setSamples(s); } } catch { /* ignora */ } }, []);

    const tick = useCallback(async (symbols: string[]) => {
        if (busy.current) return;
        if (!inSkewWindow(Date.now())) { addLog('Fora da janela (seg–sex 08–16 UTC): nada coletado.'); return; }
        if (!connRef.current) { addLog('Sem conexão com a Deriv: rodada pulada.'); return; }
        busy.current = true;
        try {
            const r = await collectSkewOnce(propRef.current, symbols.map(derivForexSymbol));
            if (r.samples.length) persist(mergeSkew(samplesRef.current, r.samples));
            addLog(`${r.samples.length} amostra(s)${r.errors.length ? `, ${r.errors.length} erro(s): ${r.errors[0]}` : ''}${r.down ? ' | CONEXÃO CAIU' : ''}`);
        } catch (e: any) { addLog(`Erro: ${e?.message || e}`); }
        finally { busy.current = false; }
    }, [addLog, persist]);

    const start = useCallback((symbols: string[]) => {
        if (timer.current) clearInterval(timer.current);
        setRunning(true); addLog(`Coletor iniciado (${symbols.join(', ')}; a cada 5 min).`);
        void tick(symbols); timer.current = setInterval(() => { void tick(symbols); }, TICK_MS);
    }, [tick, addLog]);
    const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); timer.current = null; setRunning(false); addLog('Coletor parado.'); }, [addLog]);
    useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

    return {
        isConnected, running, samples, log, report, start, stop,
        csv: () => serializeSkewCsv(samplesRef.current),
        importCsv: (text: string) => { const s = parseSkewCsv(text); persist(mergeSkew(samplesRef.current, s)); addLog(`Importadas ${s.length} linha(s).`); },
        clear: () => { persist([]); setReport(''); },
        analyze: () => setReport(buildSkewReport(samplesRef.current)),
    };
}
