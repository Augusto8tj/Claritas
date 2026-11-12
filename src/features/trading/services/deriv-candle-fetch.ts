// src/features/trading/services/deriv-candle-fetch.ts
/** Baixa velas de 1 min da Deriv paginando para trás (a Deriv entrega só ~28 dias de 1 min, ~40k velas por símbolo). */
import type { CandleData } from '@/lib/types';

export type HistoricalFetcher = (symbol: string, style: 'candles', count: number, granularity?: string, endEpoch?: number) => Promise<any[]>;

export async function fetchDerivCandlesPaged(fetchPage: HistoricalFetcher, symbol: string, target: number, onProgress?: (msg: string) => void, pauseMs = 150): Promise<CandleData[]> {
    const byEpoch = new Map<number, CandleData>();
    let endEpoch: number | undefined;
    for (let page = 0; page < 40; page++) {
        const count = Math.min(5000, target - byEpoch.size);
        if (count <= 0) break;
        const got = await fetchPage(symbol, 'candles', count, '1m', endEpoch);
        const valid = (got ?? []).filter((h: any) => [h.open, h.high, h.low, h.close].every((x: any) => typeof x === 'number' && Number.isFinite(x))) as CandleData[];
        if (valid.length === 0) break;
        const minEpoch = Math.min(...valid.map(v => v.epoch));
        const before = byEpoch.size;
        valid.forEach(c => byEpoch.set(c.epoch, c));
        onProgress?.(`Baixando ${symbol}: ${byEpoch.size}/${target}`);
        if (byEpoch.size === before) break; // sem progresso
        endEpoch = minEpoch - 1;
        if (byEpoch.size >= target) break;
        if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
    }
    return Array.from(byEpoch.values()).sort((a, b) => a.epoch - b.epoch);
}
