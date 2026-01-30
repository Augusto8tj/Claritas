'use client';

export interface BayesianModel {
  priorBelief: number; // Crença inicial (0.5 = neutro)
  successCount: number;
  failureCount: number;
  recentPerformance: number[]; // Últimos 10 resultados (1 ou 0)
}

export const updateBayesianConfidence = (
  model: BayesianModel,
  wasCorrect: boolean
): { updatedModel: BayesianModel; currentConfidence: number } => {
  
  // 1. ATUALIZAR CONTADORES
  const newSuccessCount = model.successCount + (wasCorrect ? 1 : 0);
  const newFailureCount = model.failureCount + (wasCorrect ? 0 : 1);
  
  // 2. BETA DISTRIBUTION (Bayesian update)
  const alpha = newSuccessCount + 1; // Prior pseudo-count
  const beta = newFailureCount + 1;
  
  // Posterior mean
  const posteriorMean = alpha / (alpha + beta);
  
  // 3. PESO RECENTE (últimos 10 trades contam 2x mais)
  const recentPerf = [...model.recentPerformance.slice(-9), wasCorrect ? 1 : 0];
  const recentWeight = recentPerf.reduce((a, b) => a + b, 0) / recentPerf.length;
  
  // 4. CONFIANÇA FINAL (70% posterior + 30% recente)
  const currentConfidence = posteriorMean * 0.7 + recentWeight * 0.3;
  
  // 5. VARIANCE (Bayesian uncertainty)
  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
  const uncertainty = Math.sqrt(variance);
  
  // 6. PENALIZAR CONFIANÇA SE ALTA INCERTEZA
  const adjustedConfidence = currentConfidence * (1 - uncertainty * 0.5);
  
  return {
    updatedModel: {
      priorBelief: model.priorBelief,
      successCount: newSuccessCount,
      failureCount: newFailureCount,
      recentPerformance: recentPerf
    },
    currentConfidence: adjustedConfidence * 100 // Converter para percentual
  };
};
