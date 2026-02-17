// src/lib/debug-helpers.ts
import { logMetricsSummary } from '@/features/trading/services/strategy-metrics';

if (typeof window !== 'undefined') {
  (window as any).showStrategyMetrics = logMetricsSummary;
  
  console.log('📊 Debug: Use window.showStrategyMetrics() para ver métricas das estratégias');
}
