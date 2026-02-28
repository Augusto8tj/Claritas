// src/features/trading/utils/latency-monitor.ts
'use client';

export interface LatencyMetrics {
  avgLatency: number;
  p95Latency: number;
  maxLatency: number;
  compensationSteps: number;
  lastTradeLatency: number;
  tradeCount: number;
}

interface TradeTimings {
  tickReceivedTime: number; // JS timestamp from epoch
}

class LatencyMonitor {
  private fullCycleLatencies: number[] = [];
  private pendingTrades: Map<number, TradeTimings> = new Map();
  private readonly MAX_SAMPLES = 50;

  public startTrade(contractId: number, tickEpoch: number) {
    this.pendingTrades.set(contractId, { tickReceivedTime: tickEpoch * 1000 });
  }
  
  public recordFullCycle(contractId: number, sellTimeEpoch: number) {
    const tradeTimings = this.pendingTrades.get(contractId);
    if (!tradeTimings) {
      return; 
    }

    const resultReceivedTime = sellTimeEpoch * 1000;
    const totalLatency = resultReceivedTime - tradeTimings.tickReceivedTime;

    if (totalLatency > 0 && totalLatency < 5000) {
        this.fullCycleLatencies.push(totalLatency);
        if (this.fullCycleLatencies.length > this.MAX_SAMPLES) {
            this.fullCycleLatencies.shift();
        }
        console.log(`⏱️ Latency for #${contractId}: ${totalLatency.toFixed(0)}ms`);
    }

    this.pendingTrades.delete(contractId);
  }

  public getMetrics(): LatencyMetrics {
    const latencies = this.fullCycleLatencies;
    if (latencies.length < 5) {
      return { 
          avgLatency: 150, p95Latency: 250, maxLatency: 300, 
          compensationSteps: 1, lastTradeLatency: latencies[latencies.length - 1] || 0,
          tradeCount: latencies.length,
      };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const max = Math.max(...sorted);
    
    // Assumindo 1 tick por segundo para a maioria dos índices de volatilidade.
    const tickIntervalMs = 1000; 
    const compensationSteps = Math.max(1, Math.ceil(avg / tickIntervalMs));

    console.log("⏱️ Latency Metrics:", { avgLatency: avg, compensationSteps: compensationSteps });


    return {
      avgLatency: avg,
      p95Latency: p95,
      maxLatency: max,
      compensationSteps,
      lastTradeLatency: latencies[latencies.length - 1] || 0,
      tradeCount: latencies.length,
    };
  }
}

export const globalLatencyMonitor = new LatencyMonitor();
