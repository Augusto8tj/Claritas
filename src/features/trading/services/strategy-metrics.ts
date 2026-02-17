// src/features/trading/services/strategy-metrics.ts
interface StrategyMetrics {
  totalSignals: number;
  signalsLast24h: number;
  avgConfidence: number;
  lastSignalTime: number;
  vetoReasons: Record<string, number>;
}

type StrategyType =
  | 'HF_MEAN_REVERSION'
  | 'STD_TREND_FOLLOW'
  | 'BOLLINGER_SQUEEZE'
  | 'VOLUME_ABSORPTION'
  | 'MICROSTRUCTURE_SCALP';

const metricsStore: Record<StrategyType, StrategyMetrics> = {
  HF_MEAN_REVERSION: { totalSignals: 0, signalsLast24h: 0, avgConfidence: 0, lastSignalTime: 0, vetoReasons: {} },
  STD_TREND_FOLLOW: { totalSignals: 0, signalsLast24h: 0, avgConfidence: 0, lastSignalTime: 0, vetoReasons: {} },
  BOLLINGER_SQUEEZE: { totalSignals: 0, signalsLast24h: 0, avgConfidence: 0, lastSignalTime: 0, vetoReasons: {} },
  VOLUME_ABSORPTION: { totalSignals: 0, signalsLast24h: 0, avgConfidence: 0, lastSignalTime: 0, vetoReasons: {} },
  MICROSTRUCTURE_SCALP: { totalSignals: 0, signalsLast24h: 0, avgConfidence: 0, lastSignalTime: 0, vetoReasons: {} },
};

export function recordSignal(strategy: StrategyType, confidence: number) {
  const metrics = metricsStore[strategy];
  metrics.totalSignals++;
  metrics.signalsLast24h++;
  metrics.avgConfidence = (metrics.avgConfidence * (metrics.totalSignals - 1) + confidence) / metrics.totalSignals;
  metrics.lastSignalTime = Date.now();
}

export function recordVeto(strategy: StrategyType, reason: string) {
  const metrics = metricsStore[strategy];
  metrics.vetoReasons[reason] = (metrics.vetoReasons[reason] || 0) + 1;
}

export function getStrategyMetrics(strategy: StrategyType): StrategyMetrics {
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
