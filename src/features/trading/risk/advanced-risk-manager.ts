// src/features/trading/risk/advanced-risk-manager.ts
import type { EnsembleSignal } from '../ensemble/strategy-ensemble';

export interface RiskParameters {
  maxDailyLoss: number;
  maxDrawdown: number;
  maxConcurrentTrades: number;
  maxExposurePerAsset: number;
  kellyFraction: number;
}

export interface PositionSizeRecommendation {
  recommendedStake: number;
  reasoning: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  maxLoss: number;
  expectedProfit: number;
  sharpeContribution: number;
}

interface TradeRecord {
  profit: number;
  balanceAfter: number;
}

export class AdvancedRiskManager {
  private params: RiskParameters;
  public currentCapital: number;
  private dailyStartCapital: number;
  private tradeHistory: TradeRecord[] = [];
  
  constructor(params: RiskParameters, capital: number) {
    this.params = params;
    this.currentCapital = capital;
    this.dailyStartCapital = capital;
  }
  
  calculatePositionSize(
    signal: EnsembleSignal,
    currentBalance: number
  ): PositionSizeRecommendation {
    const reasoning: string[] = [];
    
    // 1. Kelly Criterion básico
    const winRate = signal.expectedWinRate;
    const lossRate = 1 - winRate;
    const rr = 1.5; 
    
    if (winRate <= lossRate / rr) {
         return {
            recommendedStake: 0,
            reasoning: ['Sinal sem vantagem estatística (Kelly ≤ 0)'],
            riskLevel: 'LOW',
            maxLoss: 0,
            expectedProfit: 0,
            sharpeContribution: 0,
        };
    }

    const kellyFull = winRate - (lossRate / rr);
    const kellySafe = kellyFull * this.params.kellyFraction;
    
    let recommendedStake = currentBalance * kellySafe;
    reasoning.push(`Kelly Base: $${recommendedStake.toFixed(2)} (${(kellySafe * 100).toFixed(1)}% do capital)`);
    
    const confidenceMultiplier = signal.confidence / 100;
    recommendedStake *= confidenceMultiplier;
    reasoning.push(`Ajuste Confiança (${signal.confidence.toFixed(0)}%): ${(confidenceMultiplier * 100).toFixed(0)}%`);
    
    const dailyLoss = this.dailyStartCapital - currentBalance;
    const dailyLossPercent = this.dailyStartCapital > 0 ? (dailyLoss / this.dailyStartCapital) * 100 : 0;
    
    if (dailyLossPercent >= this.params.maxDailyLoss * 0.8) {
      recommendedStake *= 0.5;
      reasoning.push(`⚠️ Limite diário próximo (${dailyLossPercent.toFixed(1)}%), stake reduzido em 50%`);
    }
    
    if (dailyLossPercent >= this.params.maxDailyLoss) {
      return {
        recommendedStake: 0,
        reasoning: ['🛑 LIMITE DIÁRIO ATINGIDO - Trading pausado'],
        riskLevel: 'EXTREME',
        maxLoss: 0,
        expectedProfit: 0,
        sharpeContribution: 0,
      };
    }
    
    const currentDrawdown = this.calculateCurrentDrawdown();
    if (currentDrawdown >= this.params.maxDrawdown * 0.8) {
      recommendedStake *= 0.3;
      reasoning.push(`🔥 Drawdown elevado (${currentDrawdown.toFixed(1)}%), stake reduzido drasticamente`);
    }
    
    const minStake = 0.35;
    const maxStake = currentBalance * 0.05; // 5% do capital max
    recommendedStake = Math.max(minStake, Math.min(maxStake, recommendedStake));
    
    const stakePercent = (recommendedStake / currentBalance) * 100;
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
    
    if (stakePercent < 1) riskLevel = 'LOW';
    else if (stakePercent < 2) riskLevel = 'MEDIUM';
    else if (stakePercent < 5) riskLevel = 'HIGH';
    else riskLevel = 'EXTREME';
    
    return {
      recommendedStake: parseFloat(recommendedStake.toFixed(2)),
      reasoning,
      riskLevel,
      maxLoss: recommendedStake,
      expectedProfit: recommendedStake * rr * winRate,
      sharpeContribution: this.estimateSharpeContribution(recommendedStake, winRate, rr),
    };
  }
  
  private calculateCurrentDrawdown(): number {
    if (this.tradeHistory.length < 2) return 0;
    
    const equityCurve = [this.dailyStartCapital, ...this.tradeHistory.map(t => t.balanceAfter)];
    let peak = equityCurve[0];
    let maxDD = 0;
    
    equityCurve.forEach(value => {
      if (value > peak) peak = value;
      const drawdown = peak > 0 ? ((peak - value) / peak) * 100 : 0;
      if (drawdown > maxDD) maxDD = drawdown;
    });
    
    return maxDD;
  }
  
  private estimateSharpeContribution(stake: number, winRate: number, rr: number): number {
    const expectedReturn = stake * rr * winRate - stake * (1 - winRate);
    // Simplified variance calculation
    const variance = (Math.pow(stake * rr - expectedReturn, 2) * winRate) + (Math.pow(-stake - expectedReturn, 2) * (1-winRate));
    const stdDev = Math.sqrt(variance);
    
    return stdDev > 0 ? expectedReturn / stdDev : 0;
  }
  
  updateAfterTrade(trade: TradeRecord): void {
    this.tradeHistory.push(trade);
    this.currentCapital = trade.balanceAfter;
  }
  
  resetDaily(newCapital: number): void {
    this.dailyStartCapital = newCapital;
    this.currentCapital = newCapital;
  }
}
