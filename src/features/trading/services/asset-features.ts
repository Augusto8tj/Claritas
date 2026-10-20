'use client';

/**
 * @fileOverview Serviço de Extração de Features de Ativos (Puro)
 * Centraliza a lógica técnica para garantir que Live e Replay vejam os mesmos dados.
 */

import type { CandleData } from '@/lib/types';
import { calculateAllIndicators } from './indicator-service';
import { computeSignalFeatures } from './signal-engine';

export function buildAssetFeatures(assetSym: string, assetCandles: CandleData[]) {
    // Validação de sanidade
    if (!assetCandles || assetCandles.length < 30) return null;

    const inds = calculateAllIndicators(assetCandles, [], '1m', { duration: 15, unit: 's' });
    const feats = computeSignalFeatures(assetCandles as any);
    
    if (!inds || !feats) return null;

    return {
        symbol: assetSym,
        currentPrice: assetCandles[assetCandles.length - 1].close,
        priceHistory: assetCandles.map((c: CandleData) => c.close),
        epochHistory: assetCandles.map((c: CandleData) => c.epoch),
        rsi: feats.rsi,
        adx: inds.adx || 30,
        atrNow: inds.atr || 0.001,
        bbw: inds.bbw || 1.0,
        volatilityRatio: feats.atrRatio || 1,
        momentumShort: feats.mom5,
        momentumMedium: feats.mom15,
        atrRatio: feats.atrRatio || 1,
        bbPos: feats.bbPos
    };
}
