import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Activity, Brain, TrendingUp, Zap, ShieldAlert } from 'lucide-react';
import type { DashboardData } from '@/features/trading/hooks/use-robot-council-v2';

interface CouncilDashboardProps {
  data: DashboardData;
}

export const CouncilDashboardV2: React.FC<CouncilDashboardProps> = ({ data }) => {
  const getRegimeColor = (regime: string) => {
    switch (regime) {
      case 'TREND_UP': return 'bg-green-500';
      case 'TREND_DOWN': return 'bg-red-500';
      case 'VOLATILE': return 'bg-yellow-500';
      case 'CRASH_BOOM_SPIKE': return 'bg-purple-600 animate-pulse';
      default: return 'bg-slate-500';
    }
  };

  const getPressureColor = (p: number) => {
    if (p > 0.7) return 'bg-green-500'; // Pressão de Compra
    if (p < 0.3) return 'bg-red-500';   // Pressão de Venda
    return 'bg-gray-400';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Regime de Mercado */}
      <Card className="bg-slate-900 border-slate-800 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-slate-400">Regime de Mercado</CardTitle>
          <Activity className="h-4 w-4 text-blue-400" />
        </CardHeader>
        <CardContent>
          <div className={`text-xl font-bold px-2 py-1 rounded inline-block ${getRegimeColor(data.regime)} text-white`}>
            {data.regime.replace('_', ' ')}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Filtro HMM Ativo
          </p>
        </CardContent>
      </Card>

      {/* 2. Cérebro Bayesiano */}
      <Card className="bg-slate-900 border-slate-800 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-slate-400">Consenso Bayesiano</CardTitle>
          <Brain className="h-4 w-4 text-purple-400" />
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-end mb-1">
            <span className="text-2xl font-bold">{(data.bayesianProbability * 100).toFixed(1)}%</span>
            <Badge variant={data.consensusDirection === 'HOLD' ? 'secondary' : data.consensusDirection === 'RISE' ? 'default' : 'destructive'}>
              {data.consensusDirection}
            </Badge>
          </div>
          <Progress value={data.bayesianProbability * 100} className="h-2" />
          <p className="text-xs text-slate-400 mt-2">
            {data.activeRobotsCount} Robôs Votando
          </p>
        </CardContent>
      </Card>

      {/* 3. Microestrutura (Pressão) */}
      <Card className="bg-slate-900 border-slate-800 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-slate-400">Microestrutura (10 Ticks)</CardTitle>
          <Zap className="h-4 w-4 text-yellow-400" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-2">
            <div className={`h-3 w-3 rounded-full ${getPressureColor(data.microstructure.pressure)}`} />
            <span className="font-bold text-lg">
                {(data.microstructure.pressure * 100).toFixed(0)}% Bulls
            </span>
          </div>
          <div className="text-xs text-slate-400">
            Velocidade: {data.microstructure.velocity.toFixed(4)} pts/s
            {data.microstructure.isSpike && <span className="text-red-400 font-bold ml-2">⚠️ SPIKE</span>}
          </div>
        </CardContent>
      </Card>

      {/* 4. Gestão de Risco Kelly */}
      <Card className="bg-slate-900 border-slate-800 text-white">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-slate-400">Kelly Stake</CardTitle>
          <ShieldAlert className="h-4 w-4 text-green-400" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-400">
            ${data.kellyStake.toFixed(2)}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Risco calculado dinamicamente
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
