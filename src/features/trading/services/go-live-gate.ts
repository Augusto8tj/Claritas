// /src/features/trading/services/go-live-gate.ts
/**
 * Go-Live Gate V5.0
 * Trava institucional de segurança. Impede trading real sem evidências estatísticas.
 */

import { RuleEdgeStats } from '../types/council';

export interface GoLiveStatus {
    allowed: boolean;
    reason: string;
    metrics: {
        n: number;
        winRate: number;
        wilsonLower: number;
        breakeven: number;
        shadowPnL: number;
    };
}

/**
 * Avalia se o par (Ativo/Regra) atingiu maturidade para operar em modo REAL.
 * Critérios: N >= 200, Wilson Lower Bound > Breakeven, PnL Sombra > 0.
 */
export function evaluateGoLiveGate(stats: RuleEdgeStats, breakeven: number, minN: number = 200): GoLiveStatus {
    const isNSufficient = stats.n >= minN;
    const isEdgePositive = stats.lowerBound > breakeven;
    const isPnLPositive = stats.pnl > 0;

    let reason = "Aprovado: Vantagem estatística confirmada.";
    
    if (!isNSufficient) {
        reason = `Amostra insuficiente (${stats.n}/${minN}).`;
    } else if (!isEdgePositive) {
        reason = `Edge insuficiente: ${ (stats.lowerBound * 100).toFixed(1) }% < BE ${ (breakeven * 100).toFixed(1) }%.`;
    } else if (!isPnLPositive) {
        reason = `PnL Sombra negativo ($${stats.pnl.toFixed(2)}).`;
    }

    return {
        allowed: isNSufficient && isEdgePositive && isPnLPositive,
        reason,
        metrics: {
            n: stats.n,
            winRate: stats.posteriorMean,
            wilsonLower: stats.lowerBound,
            breakeven,
            shadowPnL: stats.pnl
        }
    };
}
