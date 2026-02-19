// src/features/trading/services/strategy-metrics.ts
import type { StrategyType } from './hf-strike-logic';

interface StrategyMetrics {
  totalSignals: number;
  signalsLast24h: number;
  avgConfidence: number;
  lastSignalTime: number;
  vetoReasons: Record<string, number>;
}

const createInitialMetrics = (): StrategyMetrics => ({
  totalSignals: 0,
  signalsLast24h: 0,
  avgConfidence: 0,
  lastSignalTime: 0,
  vetoReasons: {},
});

const metricsStore: Record<string, StrategyMetrics> = {};

// Função para garantir que uma estratégia está inicializada no store
const ensureStrategyMetrics = (strategy: StrategyType) => {
  if (!metricsStore[strategy]) {
    metricsStore[strategy] = createInitialMetrics();
  }
};


export function recordSignal(strategy: StrategyType, confidence: number) {
  ensureStrategyMetrics(strategy);
  const metrics = metricsStore[strategy];
  metrics.totalSignals++;
  metrics.signalsLast24h++;
  metrics.avgConfidence = (metrics.avgConfidence * (metrics.totalSignals - 1) + confidence) / metrics.totalSignals;
  metrics.lastSignalTime = Date.now();
}

export function recordVeto(strategy: StrategyType, reason: string) {
  ensureStrategyMetrics(strategy);
  const metrics = metricsStore[strategy];
  metrics.vetoReasons[reason] = (metrics.vetoReasons[reason] || 0) + 1;
}

export function getStrategyMetrics(strategy: StrategyType): StrategyMetrics | undefined {
  return metricsStore[strategy];
}

export function logMetricsSummary() {
  console.log('=== STRATEGY METRICS SUMMARY ===');
  Object.entries(metricsStore).forEach(([strategy, metrics]) => {
    console.log(`\n[${strategy}]`);
    console.log(`  Total Signals: ${metrics.totalSignals}`);
    console.log(`  Avg Confidence: ${metrics.avgConfidence.toFixed(1)}%`);
    console.log(`  Last Signal: ${metrics.lastSignalTime ? new Date(metrics.lastSignalTime).toLocaleTimeString() : 'Never'}`);
    if (Object.keys(metrics.vetoReasons).length > 0) {
      console.log(`  Top Veto Reasons:`);
      Object.entries(metrics.vetoReasons)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .forEach(([reason, count]) => {
          console.log(`    - ${reason}: ${count}x`);
        });
    }
  });
}

// Limpa contadores a cada 24h
setInterval(() => {
  Object.values(metricsStore).forEach(m => m.signalsLast24h = 0);
}, 24 * 60 * 60 * 1000);
