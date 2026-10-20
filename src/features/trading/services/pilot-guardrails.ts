'use client';

import { Operation } from '@/lib/types';

/**
 * @fileOverview PILOT GUARDRAILS V5.5 (SUPREME)
 * Funções puras de segurança para o modo DEMO_LIVE.
 */

export interface GuardrailConfig {
    maxDailyTrades: number;
    maxDailyLossMulti: number; 
    maxConsecutiveLosses: number;
    cooldownMinutes: number;
    minPayout: number;
}

export const DEFAULT_GUARDRAILS: GuardrailConfig = {
    maxDailyTrades: 20,
    maxDailyLossMulti: 10,
    maxConsecutiveLosses: 3,
    cooldownMinutes: 30,
    minPayout: 0.8,
};

export function checkGuardrails(
    symbol: string,
    accountType: string,
    stake: number,
    operations: Operation[],
    staleMin: number | null,
    config: GuardrailConfig = DEFAULT_GUARDRAILS
): { allowed: boolean; reason?: string } {
    // 1. Filtro de Ativo Institucional
    if (symbol !== 'cryETHUSD') {
        return { allowed: false, reason: "BLOQUEIO: Apenas cryETHUSD autorizado p/ execução demo nesta etapa." };
    }

    // 2. Trava de Segurança de Conta
    if (accountType !== 'demo') {
        return { allowed: false, reason: "ERRO CRÍTICO: Execução em conta REAL bloqueada. Troque para DEMO." };
    }

    // 3. Verificação de Dados (Anti-Stale)
    if (staleMin === null || staleMin > 2.5) {
        return { allowed: false, reason: "DADOS_VELHOS: Mercado offline ou latência de rede excessiva." };
    }

    const today = new Date().toDateString();
    const todayTrades = operations.filter(op => 
        new Date(op.timestamp).toDateString() === today && 
        op.initiator.startsWith('Conselho')
    );

    // 4. Limite de Exposição Simultânea
    const hasOpen = operations.some(op => op.status === 'pending' && op.asset === symbol);
    if (hasOpen) {
        return { allowed: false, reason: "ORDEM_ATIVA: Já existe uma posição em aberto para este ativo." };
    }

    // 5. Cota Diária de Trades
    if (todayTrades.length >= config.maxDailyTrades) {
        return { allowed: false, reason: `LIMITE_DIARIO: Cota de ${config.maxDailyTrades} trades esgotada.` };
    }

    // 6. Stop Loss Diário (Proteção de Banca)
    const dailyPnL = todayTrades.reduce((sum, op) => sum + (op.result || 0), 0);
    if (dailyPnL <= -(stake * config.maxDailyLossMulti)) {
        return { allowed: false, reason: "STOP_LOSS_DIARIO: Limite de perda acumulada atingido." };
    }

    // 7. Pausa por Perdas Consecutivas
    let consLosses = 0;
    const sortedTrades = [...todayTrades].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    for (const t of sortedTrades) {
        if (t.status === 'lost') consLosses++;
        else if (t.status === 'won') break;
    }

    if (consLosses >= config.maxConsecutiveLosses) {
        const lastLoss = sortedTrades[0];
        const minsSince = (Date.now() - new Date(lastLoss.timestamp).getTime()) / 60000;
        if (minsSince < config.cooldownMinutes) {
            return { 
                allowed: false, 
                reason: `COOLDOWN: ${consLosses} perdas seguidas. Aguardando ${Math.round(config.cooldownMinutes - minsSince)} min.` 
            };
        }
    }

    return { allowed: true };
}
