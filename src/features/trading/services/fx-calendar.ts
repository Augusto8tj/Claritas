// src/features/trading/services/fx-calendar.ts
/**
 * @fileOverview ETAPA 27 — calendário do Forex: horário de verão dos EUA e janela da VIRADA DIÁRIA (17h de Nova York).
 * Na virada o spread explode (de ~1 bp para 7–20 bps em AUDUSD/NZDUSD/USDCHF) e o preço de fechamento (bid) cai e volta em minutos.
 * Esse movimento é de COTAÇÃO, não de preço, e se repete todo dia: gera "padrões" falsos (ex.: E_HORA20/E_HORA21 do V26).
 */

/** 2º domingo de março 07:00 UTC até o 1º domingo de novembro 06:00 UTC (regra dos EUA). */
export function isUsDst(epochSec: number): boolean {
    const y = new Date(epochSec * 1000).getUTCFullYear();
    const nthSunday = (mon: number, n: number) => { let k = 0; for (let d = 1; d <= 31; d++) { const x = new Date(Date.UTC(y, mon, d)); if (x.getUTCMonth() !== mon) break; if (x.getUTCDay() === 0 && ++k === n) return d; } return 1; };
    const start = Date.UTC(y, 2, nthSunday(2, 2), 7) / 1000, end = Date.UTC(y, 10, nthSunday(10, 1), 6) / 1000;
    return epochSec >= start && epochSec < end;
}

/** Hora UTC da virada do dia da vela: 21 no verão dos EUA, 22 no inverno. */
export function rolloverUtcHour(epochSec: number): number {
    const dayStart = Math.floor(epochSec / 86400) * 86400;
    return isUsDst(dayStart + 12 * 3600) ? 21 : 22;
}

export const ROLL_BEFORE_MIN = 15, ROLL_AFTER_MIN = 30;

/** 1 nas velas dentro de [virada - 15 min, virada + 30 min] (DST-aware), 0 nas demais. */
export function rolloverMask(epochs: ArrayLike<number>, before = ROLL_BEFORE_MIN, after = ROLL_AFTER_MIN): Uint8Array {
    const m = new Uint8Array(epochs.length);
    for (let i = 0; i < epochs.length; i++) {
        const e = epochs[i], dayStart = Math.floor(e / 86400) * 86400, mins = (e - dayStart) / 60 - rolloverUtcHour(e) * 60;
        if (mins >= -before && mins <= after) m[i] = 1;
    }
    return m;
}
