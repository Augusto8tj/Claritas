// src/features/trading/components/deriv-trader/VagalumeAdvancedDashboard.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Activity, AlertTriangle, CheckCircle } from 'lucide-react';
import type { VagalumeSignal } from '@/features/trading/hooks/use-vagalume-alternante';
import { cn } from '@/lib/utils';

interface VagalumeAdvancedDashboardProps {
  signal: VagalumeSignal | null;
}

export function VagalumeAdvancedDashboard({ signal }: VagalumeAdvancedDashboardProps) {
  if (!signal || !signal.advancedScore) {
    return (
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Advanced Analytics</CardTitle>
          <CardDescription>Aguardando dados suficientes...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { advancedScore, adjustedConfidence, confidence } = signal;
  const { momentum, volatility, regime, recommendation, rawScore, adjustedScore: scoreValue } = advancedScore;

  // Cores por recomendação
  const recommendationColors = {
    STRONG_BUY: 'bg-green-500',
    BUY: 'bg-blue-500',
    NEUTRAL: 'bg-yellow-500',
    AVOID: 'bg-red-500',
  };

  // Cores por regime
  const regimeColors = {
    RANGING: 'text-green-600 bg-green-50 border-green-200',
    TRENDING: 'text-blue-600 bg-blue-50 border-blue-200',
    CHAOTIC: 'text-red-600 bg-red-50 border-red-200',
  };

  const regimeIcons = {
    RANGING: Activity,
    TRENDING: regime.isTrendingUp ? TrendingUp : TrendingDown,
    CHAOTIC: AlertTriangle,
  };

  const RegimeIcon = regimeIcons[regime.type];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* CARD 1: SIGNAL STRENGTH */}
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Signal Strength</CardTitle>
            <Badge className={recommendationColors[recommendation]}>
              {recommendation.replace('_', ' ')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Raw Score */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Base Confidence</span>
              <span className="font-medium">{(confidence * 100).toFixed(1)}%</span>
            </div>
            <Progress value={rawScore} className="h-2" />
          </div>

          {/* Adjusted Score */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Adjusted Score</span>
              <span className="font-medium text-primary">{scoreValue.toFixed(1)}/100</span>
            </div>
            <Progress value={scoreValue} className="h-2" />
          </div>

          {/* Improvement */}
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">Regime Adjustment</span>
            <span className={`text-xs font-medium ${scoreValue > rawScore ? 'text-green-600' : 'text-red-600'}`}>
              {scoreValue > rawScore ? '+' : ''}{((scoreValue - rawScore) / rawScore * 100).toFixed(1)}%
            </span>
          </div>
        </CardContent>
      </Card>

      {/* CARD 2: MARKET REGIME */}
      <Card className={`border-2 ${regimeColors[regime.type]}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <RegimeIcon className="w-4 h-4" />
              Market Regime
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {(regime.confidence * 100).toFixed(0)}% confidence
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold mb-3">{regime.type}</div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="space-y-1">
              <div className="text-muted-foreground">Momentum</div>
              <div className="font-medium">
                {momentum.digitMomentum > 0 ? '+' : ''}{momentum.digitMomentum.toFixed(3)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Trend Strength</div>
              <div className="font-medium">{(momentum.trendStrength * 100).toFixed(1)}%</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Volatility</div>
              <div className="font-medium">{volatility.digitVolatility.toFixed(2)}</div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">Regime</div>
              <div className="font-medium">{volatility.volatilityRegime}</div>
            </div>
          </div>

          {/* Trend Direction */}
          {regime.type === 'TRENDING' && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-2 text-xs">
                {regime.isTrendingUp && (
                  <span className="flex items-center gap-1 text-green-600">
                    <TrendingUp className="w-3 h-3" />
                    Uptrend
                  </span>
                )}
                {regime.isTrendingDown && (
                  <span className="flex items-center gap-1 text-red-600">
                    <TrendingDown className="w-3 h-3" />
                    Downtrend
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CARD 3: MOMENTUM DETAILS */}
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Momentum Indicators</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Moving Average</span>
            <span className="font-medium">{momentum.movingAverage.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Rate of Change</span>
            <span className="font-medium">
              {momentum.rateOfChange > 0 ? '+' : ''}{(momentum.rateOfChange * 100).toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Digit Momentum</span>
            <div className="flex items-center gap-2">
              <Progress 
                value={((momentum.digitMomentum + 1) / 2) * 100} 
                className="w-20 h-1.5"
              />
              <span className="font-medium w-12 text-right">
                {momentum.digitMomentum.toFixed(3)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CARD 4: VOLATILITY DETAILS */}
      <Card className="border-muted">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Volatility Indicators</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Standard Deviation</span>
            <span className="font-medium">{volatility.digitVolatility.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">ATR (Avg True Range)</span>
            <span className="font-medium">{volatility.atr.toFixed(3)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Volatility State</span>
            <Badge variant={volatility.isExpanding ? "destructive" : "secondary"} className="text-xs">
              {volatility.isExpanding ? 'Expanding' : 'Stable'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* CARD 5: TRADING RECOMMENDATION */}
      <Card className={`border-2 col-span-full ${signal.shouldTrade ? 'border-green-500 bg-green-50/50' : 'border-red-500 bg-red-50/50'}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {signal.shouldTrade ? (
                <CheckCircle className="w-6 h-6 text-green-600" />
              ) : (
                <AlertTriangle className="w-6 h-6 text-red-600" />
              )}
              <div>
                <div className="font-semibold text-lg">
                  {signal.shouldTrade ? 'TRADE APPROVED' : 'TRADE REJECTED'}
                </div>
                <div className="text-sm text-muted-foreground">
                  {signal.shouldTrade 
                    ? `${signal.suggestedContract} @ ${(adjustedConfidence * 100).toFixed(1)}% confidence`
                    : `Recommendation: ${recommendation} - Wait for better conditions`
                  }
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Analysis Time</div>
              <div className="text-sm font-medium">{advancedScore.analysisTime.toFixed(1)}ms</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
