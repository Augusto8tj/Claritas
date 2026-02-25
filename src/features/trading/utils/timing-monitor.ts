// src/features/trading/utils/timing-monitor.ts
/**
 * Monitor de Performance e Latência
 * Rastreia timing crítico para HFT (High-Frequency Trading)
 */

export interface TimingMetrics {
    analysisTime: number;      // ms para calcular signal
    executionTime: number;     // ms para enviar trade
    totalLatency: number;      // ms total (análise + rede)
    tickAge: number;           // ms desde o último tick
    networkLatency?: number;   // ms apenas rede (estimado)
}

export interface TimingLog {
    timestamp: string;
    strategy: string;
    metrics: TimingMetrics;
    wasAborted: boolean;
    abortReason?: string;
}

class TimingMonitor {
    private logs: TimingLog[] = [];
    private readonly MAX_LOGS = 100;

    startMeasurement(): { end: () => number } {
        const startTime = performance.now();
        return {
            end: () => performance.now() - startTime,
        };
    }

    recordTiming(strategy: string, metrics: TimingMetrics, wasAborted: boolean = false, abortReason?: string) {
        const log: TimingLog = {
            timestamp: new Date().toISOString(),
            strategy,
            metrics,
            wasAborted,
            abortReason,
        };

        this.logs.push(log);
        if (this.logs.length > this.MAX_LOGS) {
            this.logs.shift();
        }

        // Log em console apenas se latência alta
        if (metrics.totalLatency > 200 || metrics.tickAge > 500) {
            console.warn(`⚠️ [${strategy}] Alta latência:`, {
                total: `${metrics.totalLatency.toFixed(0)}ms`,
                tickAge: `${metrics.tickAge.toFixed(0)}ms`,
                analysis: `${metrics.analysisTime.toFixed(0)}ms`,
            });
        } else {
            console.log(`⏱️ [${strategy}] Timing:`, {
                total: `${metrics.totalLatency.toFixed(0)}ms`,
                analysis: `${metrics.analysisTime.toFixed(0)}ms`,
            });
        }
    }

    getAverageMetrics(strategy?: string): TimingMetrics | null {
        const relevantLogs = strategy 
            ? this.logs.filter(log => log.strategy === strategy && !log.wasAborted)
            : this.logs.filter(log => !log.wasAborted);

        if (relevantLogs.length === 0) return null;

        const sum = relevantLogs.reduce((acc, log) => ({
            analysisTime: acc.analysisTime + log.metrics.analysisTime,
            executionTime: acc.executionTime + log.metrics.executionTime,
            totalLatency: acc.totalLatency + log.metrics.totalLatency,
            tickAge: acc.tickAge + log.metrics.tickAge,
        }), { analysisTime: 0, executionTime: 0, totalLatency: 0, tickAge: 0 });

        const count = relevantLogs.length;
        return {
            analysisTime: sum.analysisTime / count,
            executionTime: sum.executionTime / count,
            totalLatency: sum.totalLatency / count,
            tickAge: sum.tickAge / count,
        };
    }

    getRecentLogs(count: number = 10): TimingLog[] {
        return this.logs.slice(-count);
    }

    clearLogs() {
        this.logs = [];
    }
}

export const timingMonitor = new TimingMonitor();