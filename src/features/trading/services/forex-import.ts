// src/features/trading/services/forex-import.ts
/**
 * @fileOverview LABORATÓRIO FOREX — importação de velas de 1 min de arquivos de Forex (Dukascopy, HistData, MetaTrader, genérico),
 * detecção do par pelo nome do arquivo, ajuste de fuso e preenchimento de buracos curtos.
 *
 * Formatos (detectados por linha; separador , ; ou tab):
 *  - HistData M1 ASCII:  "20260601 000000;1.08123;1.08130;1.08120;1.08125;0"  (horário EST fixo = UTC-5, SEM horário de verão => tzOffsetHours = +5)
 *  - Dukascopy:          "01.06.2026 00:00:00.000,1.08123,1.08130,1.08120,1.08125,123.4" (GMT)
 *  - MetaTrader (MT4/5): "2026.06.01,00:00,1.08123,1.08130,1.08120,1.08125,123"          (horário do servidor da corretora: informe o fuso)
 *  - Forex Strategy Builder (forexsb.com, CSV): "2026-05-01 20:55<TAB>O<TAB>H<TAB>L<TAB>C<TAB>V" (sem segundos, sem cabeçalho, linha inteira entre aspas; GMT/UTC => tzOffsetHours = 0)
 *  - Genérico:           "epoch|YYYY-MM-DD HH:MM[:SS],O,H,L,C[,V]"  (mesmo parser do laboratório cripto)
 * Velas sem O/H/L/C positivos são descartadas. O volume do Forex é volume de ticks (não é negócio real).
 */
import type { CandleData } from '@/lib/types';
import { toEpochSeconds, type ParseResult } from './candle-csv-import';

export type FxFormat = 'histdata' | 'dukascopy' | 'metatrader' | 'fsb' | 'generico';

export interface FxParseResult extends ParseResult { formats: Partial<Record<FxFormat, number>>; }

export function parseForexCsv(text: string, opts: { tzOffsetHours?: number } = {}): FxParseResult {
    const off = (opts.tzOffsetHours ?? 0) * 3600;
    const candles: CandleData[] = [];
    const formats: Partial<Record<FxFormat, number>> = {};
    let rows = 0, skipped = 0;
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        const c = t.split(/[;,\t]/).map(x => x.trim().replace(/^"|"$/g, ''));
        let epoch: number | null = null, ohlcAt = 1, fmt: FxFormat = 'generico';
        let m: RegExpMatchArray | null;
        if ((m = c[0].match(/^(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})$/))) { fmt = 'histdata'; epoch = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000; }
        else if ((m = c[0].match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/))) { fmt = 'dukascopy'; epoch = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) / 1000; }
        else if ((m = c[0].match(/^(\d{4})\.(\d{2})\.(\d{2})$/)) && /^\d{2}:\d{2}(:\d{2})?$/.test(c[1] ?? '')) {
            fmt = 'metatrader'; ohlcAt = 2;
            const hm = c[1].split(':').map(Number);
            epoch = Date.UTC(+m[1], +m[2] - 1, +m[3], hm[0], hm[1], hm[2] ?? 0) / 1000;
        } else if (c.length >= 5) { epoch = toEpochSeconds(c[0]); if (epoch !== null && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(c[0])) fmt = 'fsb'; }
        if (epoch === null || c.length < ohlcAt + 4) { skipped++; continue; }   // cabeçalho/linha inválida
        rows++;
        const [o, h, l, cl] = [c[ohlcAt], c[ohlcAt + 1], c[ohlcAt + 2], c[ohlcAt + 3]].map(Number);
        if (![o, h, l, cl].every(x => Number.isFinite(x) && x > 0)) { skipped++; continue; }
        const v = Number(c[ohlcAt + 4]);
        const candle: CandleData = { epoch: Math.floor((epoch + off) / 60) * 60, open: o, high: h, low: l, close: cl };
        if (Number.isFinite(v)) candle.volume = v;
        candles.push(candle);
        formats[fmt] = (formats[fmt] ?? 0) + 1;
    }
    return { candles, rows, skipped, formats };
}

const CCY = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'MXN', 'ZAR', 'SGD', 'HKD', 'TRY', 'CNH', 'CNY'];

/** Detecta o par pelo nome do arquivo: EURUSD, EUR_USD, EUR-USD, EUR/USD, DAT_ASCII_EURUSD_M1_2026..., frxEURUSD... */
export function detectPairFromFilename(name: string): string | null {
    const up = name.toUpperCase().replace(/^.*[\\/]/, '');
    const re = /([A-Z]{3})[_\-/ ]?([A-Z]{3})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(up))) {
        if (CCY.includes(m[1]) && CCY.includes(m[2]) && m[1] !== m[2]) return m[1] + m[2];
        re.lastIndex = m.index + 1; // permite achar "XEURUSD" dentro de palavras maiores
    }
    return null;
}

export const derivForexSymbol = (pair: string) => `frx${pair}`;

/** Preenche buracos de até `maxFillMin` minutos com velas planas no último fechamento (volume 0). Buracos maiores (fim de semana, feriado) ficam. */
export function fillShortGaps(candles: CandleData[], maxFillMin = 5): { candles: CandleData[]; filled: number } {
    if (candles.length < 2) return { candles, filled: 0 };
    const out: CandleData[] = [candles[0]];
    let filled = 0;
    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1], cur = candles[i];
        const d = Math.round((cur.epoch - prev.epoch) / 60);
        if (d > 1 && d - 1 <= maxFillMin) {
            for (let k = 1; k < d; k++) { out.push({ epoch: prev.epoch + k * 60, open: prev.close, high: prev.close, low: prev.close, close: prev.close, volume: 0 }); filled++; }
        }
        out.push(cur);
    }
    return { candles: out, filled };
}

// ---------------- DIAGNÓSTICO DE FUSO PELO FIM DE SEMANA (ETAPA 26) ----------------
export interface WeekendGap { lastBeforeEpoch: number; firstAfterEpoch: number; gapHours: number; }
export interface WeekendDiag {
    gaps: WeekendGap[]; closeHours: Record<string, number>; openHours: Record<string, number>; text: string; suspicious: boolean;
}

/**
 * O Forex fecha na sexta ~17h de Nova York e reabre no domingo ~17h NY: em UTC isso é 21h (horário de verão dos EUA) ou 22h (inverno).
 * Se as velas estão mesmo em UTC, a última vela de sexta cai em 20:59/21:59 e a primeira de domingo em 21:00/22:00 (variação de 1 h conforme o
 * horário de verão dos EUA). Se a distribuição for outra (ex.: 03h, 04h, 23h), o arquivo NÃO está em UTC e o fuso informado está errado.
 */
export function weekendFuseDiagnostics(candles: CandleData[], minGapHours = 24): WeekendDiag {
    const gaps: WeekendGap[] = [];
    for (let i = 1; i < candles.length; i++) {
        const a = candles[i - 1].epoch, b = candles[i].epoch, gh = (b - a) / 3600;
        if (gh >= minGapHours && gh <= 80) gaps.push({ lastBeforeEpoch: a, firstAfterEpoch: b, gapHours: gh });
    }
    const closeHours: Record<string, number> = {}, openHours: Record<string, number> = {};
    for (const g of gaps) {
        const ch = String(new Date(g.lastBeforeEpoch * 1000).getUTCHours()), oh = String(new Date(g.firstAfterEpoch * 1000).getUTCHours());
        closeHours[ch] = (closeHours[ch] ?? 0) + 1; openHours[oh] = (openHours[oh] ?? 0) + 1;
    }
    const plausible = (h: string) => h === '20' || h === '21' || h === '22';
    const okClose = Object.entries(closeHours).filter(([h]) => plausible(h)).reduce((s, [, n]) => s + n, 0);
    const okOpen = Object.entries(openHours).filter(([h]) => plausible(h)).reduce((s, [, n]) => s + n, 0);
    const suspicious = gaps.length >= 3 && (okClose / gaps.length < 0.7 || okOpen / gaps.length < 0.7);
    const fmt = (m: Record<string, number>) => Object.entries(m).sort((a, b) => Number(a[0]) - Number(b[0])).map(([h, n]) => `${h}h x${n}`).join(', ') || 'n/d';
    const L = [`Diagnóstico de fuso (fins de semana, ${gaps.length} buraco(s) de ${minGapHours}h a 80h): hora UTC da última vela antes do buraco: ${fmt(closeHours)} | da primeira vela depois: ${fmt(openHours)}`];
    L.push(gaps.length < 3 ? 'Poucos fins de semana para concluir.' : suspicious ? '⚠️ FUSO SUSPEITO: o esperado em UTC é fechar ~20h/21h e reabrir ~21h/22h (17h de Nova York). Revise o campo "horas para somar".' : 'Fuso COMPATÍVEL com UTC (fechamento e reabertura perto de 17h de Nova York).');
    return { gaps, closeHours, openHours, text: L.join('\n'), suspicious };
}
