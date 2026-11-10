// src/features/trading/services/candle-csv-import.ts
/**
 * @fileOverview ETAPA 20 — IMPORTAÇÃO DE VELAS DE 1 MIN DE ARQUIVOS CSV (Binance Vision, Kaggle...), sem depender da Deriv.
 *
 * Formatos aceitos (detecção automática por linha):
 *  - Binance klines (12 colunas): openTime, open, high, low, close, volume, ... ; openTime em segundos, ms OU µs
 *    (desde 2025 o Binance Spot usa microssegundos: 1780272000000000 = 01/06/2026 00:00 UTC).
 *  - Kaggle/CSV simples: "YYYY-MM-DD HH:MM:SS,Open,High,Low,Close" (interpretado como UTC). Linhas com "—" são descartadas.
 * Cabeçalhos textuais e linhas inválidas são ignorados e contados.
 */
import type { CandleData } from '@/lib/types';

export interface ParseResult { candles: CandleData[]; rows: number; skipped: number; }

function toEpochSeconds(raw: string): number | null {
    const s = raw.trim().replace(/^"|"$/g, '');
    if (/^\d+(\.\d+)?$/.test(s)) {
        const t = Number(s);
        if (t >= 1e14) return Math.floor(t / 1e6);   // microssegundos
        if (t >= 1e11) return Math.floor(t / 1e3);   // milissegundos
        if (t >= 1e8) return Math.floor(t);          // segundos
        return null;
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0) / 1000);
}

export function parseKlinesCsv(text: string): ParseResult {
    const candles: CandleData[] = [];
    let rows = 0, skipped = 0;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const c = line.split(',');
        const epoch = c.length >= 5 ? toEpochSeconds(c[0]) : null;
        if (epoch === null) { skipped++; continue; }   // cabeçalho ou linha inválida
        rows++;
        const [o, h, l, cl] = [c[1], c[2], c[3], c[4]].map(x => Number(x));
        if (![o, h, l, cl].every(x => Number.isFinite(x) && x > 0)) { skipped++; continue; }
        const v = c.length > 5 ? Number(c[5]) : NaN;
        const candle: CandleData = { epoch, open: o, high: h, low: l, close: cl };
        if (Number.isFinite(v)) candle.volume = v;
        candles.push(candle);
    }
    return { candles, rows, skipped };
}

export interface MergeResult { candles: CandleData[]; duplicates: number; conflicts: number; }

/** Ordena, remove duplicatas por epoch (mantém a primeira) e conta duplicatas com valores diferentes. */
export function mergeCandles(list: CandleData[]): MergeResult {
    const sorted = [...list].sort((a, b) => a.epoch - b.epoch);
    const out: CandleData[] = [];
    let duplicates = 0, conflicts = 0;
    for (const c of sorted) {
        const last = out[out.length - 1];
        if (last && last.epoch === c.epoch) {
            duplicates++;
            if (last.open !== c.open || last.high !== c.high || last.low !== c.low || last.close !== c.close) conflicts++;
            continue;
        }
        out.push(c);
    }
    return { candles: out, duplicates, conflicts };
}

export interface QualityReport {
    label: string; n: number; from: number; to: number; expectedMinutes: number; missingMinutes: number;
    gaps: number; maxGapMinutes: number; zeroVolumeShare: number | null; flatShare: number;
    duplicates: number; conflicts: number; skipped: number;
}

export function assessQuality(label: string, m: MergeResult, skipped = 0): QualityReport {
    const c = m.candles;
    const n = c.length;
    if (n === 0) return { label, n: 0, from: 0, to: 0, expectedMinutes: 0, missingMinutes: 0, gaps: 0, maxGapMinutes: 0, zeroVolumeShare: null, flatShare: 0, duplicates: m.duplicates, conflicts: m.conflicts, skipped };
    let gaps = 0, missing = 0, maxGap = 0, zero = 0, vol = 0, flat = 0;
    for (let i = 0; i < n; i++) {
        if (i > 0) {
            const d = Math.round((c[i].epoch - c[i - 1].epoch) / 60);
            if (d !== 1) { gaps++; missing += Math.max(0, d - 1); maxGap = Math.max(maxGap, d - 1); }
        }
        if (typeof c[i].volume === 'number') { vol++; if (c[i].volume === 0) zero++; }
        if (c[i].open === c[i].high && c[i].high === c[i].low && c[i].low === c[i].close) flat++;
    }
    return {
        label, n, from: c[0].epoch, to: c[n - 1].epoch, expectedMinutes: Math.round((c[n - 1].epoch - c[0].epoch) / 60) + 1,
        missingMinutes: missing, gaps, maxGapMinutes: maxGap, zeroVolumeShare: vol > 0 ? zero / vol : null, flatShare: flat / n,
        duplicates: m.duplicates, conflicts: m.conflicts, skipped,
    };
}

export function buildQualityText(qs: QualityReport[]): string {
    const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
    const d = (e: number) => new Date(e * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const L = ['[QUALIDADE DOS DADOS IMPORTADOS V20]', '='.repeat(50)];
    for (const q of qs) {
        if (q.n === 0) { L.push(`${q.label}: nenhuma vela válida lida (linhas ignoradas: ${q.skipped}).`); continue; }
        L.push(`${q.label}: ${q.n} velas | ${d(q.from)} a ${d(q.to)} | esperadas ${q.expectedMinutes}, faltando ${q.missingMinutes} em ${q.gaps} buraco(s) (maior: ${q.maxGapMinutes} min)`);
        L.push(`   velas sem volume: ${q.zeroVolumeShare === null ? 'n/d' : pc(q.zeroVolumeShare)} | velas planas (O=H=L=C): ${pc(q.flatShare)} | duplicadas: ${q.duplicates} (conflitantes: ${q.conflicts}) | linhas ignoradas: ${q.skipped}`);
        if (q.flatShare > 0.2 || (q.zeroVolumeShare ?? 0) > 0.2) L.push('   ⚠️ Mercado ralo neste par: muitas velas planas/sem negócio. Saltos após trechos parados são artefato, não movimento de mercado. Prefira o par com mais liquidez (ex.: USDT).');
    }
    return L.join('\n');
}
