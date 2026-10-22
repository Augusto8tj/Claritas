// src/features/trading/services/performance-report.ts
'use client';

import { CryptoShadowTrade, RuleCalibration } from '../types/council';

/**
 * buildPerformanceReport - Versão 5.8
 * Gera o relatório "Observado vs Esperado" para monitorar a degradação do sinal.
 */
export function buildPerformanceReport(
    shadowTrades: CryptoShadowTrade[],
    liveTrades: any[],
    calibration: RuleCalibration | null
): string {
    const all = [...shadowTrades, ...liveTrades].filter(t => t.rule === 'LEADLAG_SLINGSHOT');
    const n = all.length;
    const wins = all.filter(t => t.result === 'won').length;
    const rate = n > 0 ? wins / n : 0;
    
    let report = `[RELATÓRIO DE PERFORMANCE REAL V5.8]\n`;
    report += `==================================================\n`;
    report += `REGRA: LEADLAG_SLINGSHOT\n`;
    report += `AMOSTRA: ${n} trades | ACERTO: ${(rate * 100).toFixed(1)}%\n`;

    if (calibration && n >= 30) {
        const expected = calibration.testWinRate;
        const diff = rate - expected;
        const status = diff < -0.05 ? 'DEGRADAÇÃO' : (diff > 0.05 ? 'SUPERANDO' : 'CONSISTENTE');
        
        report += `EXPECTATIVA (BT): ${(expected * 100).toFixed(1)}%\n`;
        report += `DIVERGÊNCIA: ${(diff * 100).toFixed(1)}% [STATUS: ${status}]\n`;
        
        if (status === 'DEGRADAÇÃO') {
            report += `⚠️ ALERTA: O sinal está perdendo eficiência. Recalibração recomendada.\n`;
        }
    } else if (n < 30) {
        report += `STATUS: AMOSTRA INSUFICIENTE PARA COMPARAÇÃO (N<30).\n`;
    }

    return report;
}
