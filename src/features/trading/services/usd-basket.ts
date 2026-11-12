// src/features/trading/services/usd-basket.ts
/**
 * @fileOverview LABORATÓRIO FOREX — índice sintético de força do dólar (USD) a partir dos pares carregados.
 * Pares XXXUSD entram com sinal -1 (dólar forte = par cai); pares USDXXX entram com sinal +1. Pesos aproximados do DXY
 * (EUR 57,6; JPY 13,6; GBP 11,9; CAD 9,1; SEK 4,2; CHF 3,6), renormalizados para os pares disponíveis; AUD e NZD não
 * fazem parte do DXY e entram com peso 0 (use-os como alvo). Índice = média geométrica ponderada; só o FECHAMENTO é significativo
 * (open/high/low = close), e as regras da biblioteca usam só o fechamento da referência.
 * Para evitar correlação mecânica, o par-alvo (e seu espelho) é EXCLUÍDO da cesta ("leave-one-out").
 */
import type { CandleData } from '@/lib/types';

export const DXY_WEIGHTS: Record<string, number> = { EUR: 0.576, JPY: 0.136, GBP: 0.119, CAD: 0.091, SEK: 0.042, CHF: 0.036 };

export function usdLeg(pair: string): { ccy: string; sign: 1 | -1 } | null {
    if (pair.length !== 6) return null;
    if (pair.endsWith('USD')) return { ccy: pair.slice(0, 3), sign: -1 };
    if (pair.startsWith('USD')) return { ccy: pair.slice(3), sign: 1 };
    return null;
}

export function buildUsdBasket(series: Record<string, CandleData[]>, excludePair?: string, minPairs = 3): { candles: CandleData[]; pairs: string[]; weights: Record<string, number> } | null {
    const usable: { pair: string; sign: number; w: number; map: Map<number, number> }[] = [];
    for (const [pair, cs] of Object.entries(series)) {
        if (excludePair && pair === excludePair) continue;
        const leg = usdLeg(pair);
        if (!leg || !(leg.ccy in DXY_WEIGHTS) || cs.length === 0) continue;
        if (excludePair) { const ex = usdLeg(excludePair); if (ex && ex.ccy === leg.ccy) continue; } // mesma moeda: espelho do alvo
        usable.push({ pair, sign: leg.sign, w: DXY_WEIGHTS[leg.ccy], map: new Map(cs.map(c => [c.epoch, c.close])) });
    }
    if (usable.length < minPairs) return null;
    const totalW = usable.reduce((s, u) => s + u.w, 0);
    const base = usable.reduce((a, b) => (a.map.size <= b.map.size ? a : b));
    const out: CandleData[] = [];
    for (const epoch of Array.from(base.map.keys()).sort((a, b) => a - b)) {
        let acc = 0, ok = true;
        for (const u of usable) { const px = u.map.get(epoch); if (!(px && px > 0)) { ok = false; break; } acc += (u.w / totalW) * u.sign * Math.log(px); }
        if (!ok) continue;
        const v = Math.exp(acc);
        out.push({ epoch, open: v, high: v, low: v, close: v });
    }
    if (out.length === 0) return null;
    const weights: Record<string, number> = {};
    usable.forEach(u => { weights[u.pair] = u.w / totalW; });
    return { candles: out, pairs: usable.map(u => u.pair), weights };
}
