// src/components/deriv-trader/trade-legend.tsx
'use client';

import React, { useMemo } from 'react';
import type { TradeAnnotation } from '@/lib/types';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, CheckCircle, XCircle, Timer, Award } from 'lucide-react';

interface TradeLegendProps {
  annotations: TradeAnnotation[];
  currentSymbol: string;
  className?: string;
  bgColor: string;
  textColor: string;
  lineColor: string;
  bullColor: string;
  bearColor: string;
}

export const TradeLegend: React.FC<TradeLegendProps> = ({
  annotations,
  currentSymbol,
  className,
  bgColor,
  textColor,
  lineColor,
  bullColor,
  bearColor
}) => {
  const summary = useMemo(() => {
    const symbolAnnotations = annotations.filter(ann => ann.symbol === currentSymbol);
    const active = symbolAnnotations.filter(ann => ann.status === 'pending').length;
    const wins = symbolAnnotations.filter(ann => ann.status === 'won').length;
    const losses = symbolAnnotations.filter(ann => ann.status === 'lost').length;
    
    const totalProfit = symbolAnnotations
        .filter(ann => ann.status === 'won')
        .reduce((sum, ann) => sum + (ann.profit || 0), 0);
        
    const totalLoss = symbolAnnotations
        .filter(ann => ann.status === 'lost')
        .reduce((sum, ann) => sum + (ann.profit || 0), 0);

    const totalNet = totalProfit + totalLoss;
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    
    return { active, wins, losses, totalProfit, totalLoss, totalNet, winRate, totalTrades };
  }, [annotations, currentSymbol]);

  if (summary.active === 0 && summary.totalTrades === 0) {
      return null;
  }

  return (
    <div 
        className={cn(
            "absolute top-4 left-4 z-20 w-64 rounded-lg border p-3 text-xs shadow-lg backdrop-blur-sm",
            className
        )}
        style={{ 
            backgroundColor: `${bgColor}CC`, // Add transparency
            borderColor: lineColor,
            color: textColor
        }}
    >
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div>
                <p className="font-bold text-lg" style={{ color: lineColor }}>{summary.active}</p>
                <p className="text-xs" style={{ color: textColor }}>Ativas</p>
            </div>
            <div>
                <p className="font-bold text-lg" style={{ color: bullColor }}>{summary.wins}</p>
                <p className="text-xs" style={{ color: textColor }}>Vitórias</p>
            </div>
            <div>
                <p className="font-bold text-lg" style={{ color: bearColor }}>{summary.losses}</p>
                <p className="text-xs" style={{ color: textColor }}>Derrotas</p>
            </div>
        </div>

        <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between items-center">
                <span>Ganhos Totais:</span>
                <span className="font-semibold" style={{ color: bullColor }}>
                    ${summary.totalProfit.toFixed(2)}
                </span>
            </div>
            <div className="flex justify-between items-center">
                <span>Perdas Totais:</span>
                <span className="font-semibold" style={{ color: bearColor }}>
                    ${Math.abs(summary.totalLoss).toFixed(2)}
                </span>
            </div>
            <div className="flex justify-between items-center font-bold border-t pt-1" style={{ borderColor: lineColor }}>
                <span>Resultado Líquido:</span>
                <span style={{ color: summary.totalNet >= 0 ? bullColor : bearColor }}>
                    {summary.totalNet >= 0 ? '+' : '-'}${Math.abs(summary.totalNet).toFixed(2)}
                </span>
            </div>
        </div>
        
        {summary.totalTrades > 0 && (
            <div className="mt-3 space-y-1">
                <div className="flex justify-between items-center text-[11px]">
                    <span className="font-semibold">Taxa de Acerto:</span>
                    <span>{summary.winRate.toFixed(1)}%</span>
                </div>
                <Progress value={summary.winRate} className="h-1.5" 
                    indicatorClassName={cn(
                        summary.winRate >= 50 ? 'bg-green-500' : 'bg-red-500'
                    )}
                />
            </div>
        )}

        <div className='border-t my-3' style={{ borderColor: lineColor }}></div>
        
        <div className="space-y-2 text-xs">
            <p className="font-bold mb-1">Legenda:</p>
            <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-blue-500"></div>
                <span>Entrada (CALL/RISE)</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-orange-500"></div>
                <span>Entrada (PUT/FALL)</span>
            </div>
             <div className="flex items-center gap-2">
                <CheckCircle className="h-3 w-3" style={{ color: bullColor }}/>
                <span>Resultado de Vitória</span>
            </div>
             <div className="flex items-center gap-2">
                <XCircle className="h-3 w-3" style={{ color: bearColor }}/>
                <span>Resultado de Derrota</span>
            </div>
        </div>
    </div>
  );
};
