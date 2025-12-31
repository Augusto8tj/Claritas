// /src/components/deriv-trader/trading-desk.tsx
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { RobotStrategy } from '@/lib/types';
import {
    BrainCircuit,
    Activity,
    Waves,
    CandlestickChart,
    Bot,
    LayoutGrid,
    BarChart,
    TrendingUp,
    Cloud,
    CheckCircle,
    XCircle,
    Trophy,
    AlertTriangle,
    HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { RobotPerformance, CouncilVotes } from '@/hooks/use-robot-council';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Separator } from '../ui/separator';
import { Badge } from '../ui/badge';

interface TradingDeskProps {
    isMeritocracyOn: boolean;
    setIsMeritocracyOn: (isOn: boolean) => void;
    isCouncilAutopilotOn: boolean;
    robotPerformance: RobotPerformance[];
    councilVotes: CouncilVotes; 
}

// ============================================================================
// ÍCONES DAS ESTRATÉGIAS
// ============================================================================
const indicatorIcons: { [key: string]: React.ReactNode } = {
    RSI: <BrainCircuit className="h-4 w-4" />,
    STOCHASTIC: <BrainCircuit className="h-4 w-4" />,
    MOVING_AVERAGE_CROSS: <Activity className="h-4 w-4" />,
    BOLLINGER_BANDS: <Waves className="h-4 w-4" />,
    MACD_CROSS: <Activity className="h-4 w-4" />,
    PRICE_ACTION_PATTERN: <CandlestickChart className="h-4 w-4" />,
    ADX_TREND: <TrendingUp className="h-4 w-4" />,
    ICHIMOKU_CLOUD: <Cloud className="h-4 w-4" />,
    AWESOME_OSCILLATOR: <BarChart className="h-4 w-4" />,
    VOLUME_PROFILE: <Activity className="h-4 w-4" />,
    KAMA: <Activity className="h-4 w-4" />,
    VWAP: <Activity className="h-4 w-4" />,
    Z_SCORE: <BrainCircuit className="h-4 w-4" />,
    STOCH_RSI: <BrainCircuit className="h-4 w-4" />,
    MFI: <BrainCircuit className="h-4 w-4" />,
    TRIX: <Activity className="h-4 w-4" />,
    ROC: <Activity className="h-4 w-4" />,
    DONCHIAN_CHANNELS: <Waves className="h-4 w-4" />,
    RVI: <BrainCircuit className="h-4 w-4" />,
    PARABOLIC_SAR: <TrendingUp className="h-4 w-4" />,
    CHANDELIER_EXIT: <TrendingUp className="h-4 w-4" />,
    OBV: <Activity className="h-4 w-4" />,
};

const voteIcons: { [key: string]: React.ReactNode } = {
    RISE: <CheckCircle className="h-4 w-4 text-green-500" />,
    FALL: <XCircle className="h-4 w-4 text-red-500" />,
    HOLD: <HelpCircle className="h-4 w-4 text-yellow-500" />,
}

// ============================================================================
// RENDERIZAR PARÂMETROS DA ESTRATÉGIA
// ============================================================================
function renderStrategyParams(robot: RobotStrategy): string {
    switch (robot.strategyType) {
        case 'RSI':
        case 'STOCHASTIC':
        case 'MFI':
        case 'RVI':
            return `Forte < ${robot.strongBuyThreshold}, Fraco < ${robot.weakBuyThreshold}`;
        case 'STOCH_RSI':
            return `Forte < ${robot.strongBuyThreshold?.toFixed(2)}, Fraco < ${robot.weakBuyThreshold?.toFixed(2)}`;
        case 'MOVING_AVERAGE_CROSS':
            return `Cruzamento ${robot.shortPeriod}/${robot.longPeriod}`;
        case 'BOLLINGER_BANDS':
            return `Período: ${robot.period}, Desvio: ${robot.stdDev}`;
        case 'MACD_CROSS':
            return `${robot.fastPeriod}/${robot.slowPeriod}/${robot.signalPeriod}`;
        case 'PRICE_ACTION_PATTERN':
            const pattern = robot.pattern === 'hammer' ? 'Martelo' : 'Estrela Cadente';
            return `Padrão: ${pattern}`;
        case 'ADX_TREND':
            return `Tendência > ${robot.trendStrengthThreshold}`;
        case 'VOLUME_PROFILE':
            return `POC ${robot.profileBars} barras`;
        case 'Z_SCORE':
            return `Z-Score: ${robot.zScoreThreshold}`;
        case 'PARABOLIC_SAR':
            return `AF: ${robot.acceleration}, MAX: ${robot.maxAcceleration}`;
        case 'CHANDELIER_EXIT':
            return `Mult. ATR: ${robot.multiplier}`;
        case 'TRIX':
        case 'ROC':
        case 'KAMA':
        case 'DONCHIAN_CHANNELS':
            return `Período: ${robot.period}`;
        case 'AWESOME_OSCILLATOR':
        case 'ICHIMOKU_CLOUD':
        case 'VWAP':
        case 'OBV':
            return 'Parâmetros Padrão';
        default:
            return 'N/A';
    }
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export function TradingDesk({
    isMeritocracyOn,
    setIsMeritocracyOn,
    isCouncilAutopilotOn,
    robotPerformance,
    councilVotes,
}: TradingDeskProps) {
    const { toast } = useToast();

    // Ordenar por vitórias (depois por lucro)
    const sortedPerformance = [...robotPerformance].sort((a, b) => {
        const winsCompare = (b.wins || 0) - (a.wins || 0);
        if (winsCompare !== 0) return winsCompare;
        return (b.totalProfit || 0) - (a.totalProfit || 0);
    });

    // Estatísticas gerais
    const totalTrades = sortedPerformance.reduce(
        (sum, r) => sum + (r.wins || 0) + (r.losses || 0),
        0
    );
    const totalWins = sortedPerformance.reduce((sum, r) => sum + (r.wins || 0), 0);
    const totalProfit = sortedPerformance.reduce((sum, r) => sum + (r.totalProfit || 0), 0);
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    // Top 3 performers
    const topPerformers = sortedPerformance.slice(0, 3);

    const resetPerformance = () => {
        localStorage.removeItem('robotPerformance');
        toast({
            title: 'Desempenho Resetado',
            description:
                'O histórico da Arena foi limpo. A interface irá atualizar em breve.',
        });
        // A atualização será refletida no próximo ciclo do `useRobotCouncil`
        window.location.reload();
    };

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div>
                        <CardTitle className="font-headline flex items-center gap-2">
                            <LayoutGrid className="w-5 h-5" />
                            Arena Virtual: Painel de Desempenho
                        </CardTitle>
                        <CardDescription>
                            Simulação em tempo real. Cada robô compete continuamente com trades
                            virtuais de $1.
                        </CardDescription>
                    </div>
                    <div className="flex items-center space-x-2 rounded-lg border p-3 shadow-sm shrink-0">
                        <div className="space-y-0.5">
                            <Label htmlFor="meritocracy-switch-desk" className="font-semibold">
                                Modo Meritocracia
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Pondera votos pelo desempenho.
                            </p>
                        </div>
                        <Switch
                            id="meritocracy-switch-desk"
                            checked={isMeritocracyOn}
                            onCheckedChange={setIsMeritocracyOn}
                            disabled={!isCouncilAutopilotOn}
                        />
                    </div>
                </div>

                <Separator className="my-4" />

                {/* Estatísticas Gerais */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="rounded-lg border p-3 bg-muted/50">
                        <p className="text-xs text-muted-foreground">Total de Trades</p>
                        <p className="text-2xl font-bold">{totalTrades}</p>
                    </div>
                    <div className="rounded-lg border p-3 bg-muted/50">
                        <p className="text-xs text-muted-foreground">Taxa de Acerto Global</p>
                        <p className="text-2xl font-bold">{overallWinRate.toFixed(1)}%</p>
                    </div>
                    <div className="rounded-lg border p-3 bg-muted/50">
                        <p className="text-xs text-muted-foreground">Resultado Total</p>
                        <p
                            className={cn(
                                'text-2xl font-bold',
                                totalProfit > 0
                                    ? 'text-green-600'
                                    : totalProfit < 0
                                      ? 'text-red-600'
                                      : ''
                            )}
                        >
                            ${totalProfit.toFixed(2)}
                        </p>
                    </div>
                    <div className="rounded-lg border p-3 bg-muted/50">
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Trophy className="h-3 w-3" /> Top Performer
                        </p>
                        <p className="text-sm font-semibold truncate">
                            {topPerformers[0]?.strategyType || 'N/A'}
                        </p>
                    </div>
                </div>

                {/* Top 3 Badge */}
                {topPerformers.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {topPerformers.map((robot, index) => {
                            const totalTrades = (robot.wins || 0) + (robot.losses || 0);
                            const winRate =
                                totalTrades > 0 ? ((robot.wins || 0) / totalTrades) * 100 : 0;
                            return (
                                <Badge
                                    key={robot.id}
                                    variant={
                                        index === 0
                                            ? 'default'
                                            : index === 1
                                              ? 'secondary'
                                              : 'outline'
                                    }
                                    className={cn("flex items-center gap-1.5 py-1 px-2.5", index === 0 && "bg-yellow-400 text-yellow-900 border-yellow-500")}
                                >
                                    {index === 0 && <Trophy className="h-3 w-3" />}
                                    {index === 1 && <div className="h-3 w-3 rounded-full bg-slate-400"></div>}
                                    {index === 2 && <div className="h-3 w-3 rounded-full bg-amber-700"></div>}
                                    <span className="font-bold">{robot.strategyType}:</span> {winRate.toFixed(0)}% (${robot.totalProfit?.toFixed(2)})
                                </Badge>
                            );
                        })}
                    </div>
                )}

                <Button
                    onClick={resetPerformance}
                    variant="destructive"
                    size="sm"
                    className="w-full sm:w-auto"
                >
                    Resetar Desempenho da Sessão
                </Button>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Estratégia</TableHead>
                            <TableHead>Parâmetros</TableHead>
                            <TableHead className="text-center">Voto Atual</TableHead>
                            <TableHead className="text-center">Trades (V/D)</TableHead>
                            <TableHead className="text-center">Taxa de Acerto</TableHead>
                            <TableHead className="text-right">P&amp;L (USD)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sortedPerformance.length > 0 ? (
                            sortedPerformance.map((robot, index) => {
                                const totalTrades = (robot.wins || 0) + (robot.losses || 0);
                                const winRate =
                                    totalTrades > 0 ? ((robot.wins || 0) / totalTrades) * 100 : 0;
                                const isTopPerformer = index < 3;
                                const voteData = councilVotes ? councilVotes[robot.id] : null;
                                const currentVote = voteData?.vote || 'HOLD';
                                const confidence = voteData?.confidence || 0;

                                return (
                                    <TableRow
                                        key={robot.id}
                                        className={cn(isTopPerformer && 'bg-muted/30')}
                                    >
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                {isTopPerformer && index === 0 && (
                                                    <Trophy className="h-4 w-4 text-yellow-500" />
                                                )}
                                                {indicatorIcons[robot.strategyType] || <Bot />}
                                                <span className="text-sm">
                                                    {robot.strategyType}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
                                            {renderStrategyParams(robot.strategy)}
                                        </TableCell>
                                        <TableCell className="text-center font-semibold">
                                            {councilVotes && (
                                                <div className={cn("flex items-center justify-center gap-1.5",
                                                    currentVote === 'RISE' && 'text-green-600',
                                                    currentVote === 'FALL' && 'text-red-600',
                                                    currentVote === 'HOLD' && 'text-yellow-600',
                                                )}>
                                                    {voteIcons[currentVote]}
                                                    <span>{currentVote}</span>
                                                    {confidence > 0 && <span className="text-xs text-muted-foreground">({confidence})</span>}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="flex items-center gap-1 text-green-600">
                                                    <CheckCircle className="h-4 w-4" />
                                                    {robot.wins || 0}
                                                </span>
                                                <span>/</span>
                                                <span className="flex items-center gap-1 text-red-600">
                                                    {robot.losses || 0}
                                                    <XCircle className="h-4 w-4" />
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {totalTrades > 0 ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="text-sm font-medium">
                                                        {winRate.toFixed(1)}%
                                                    </span>
                                                    <Progress
                                                        value={winRate}
                                                        className="w-20 h-2"
                                                        indicatorClassName={
                                                            winRate >= 60
                                                                ? 'bg-green-500'
                                                                : winRate >= 50
                                                                  ? 'bg-yellow-500'
                                                                  : 'bg-red-500'
                                                        }
                                                    />
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell
                                            className={cn(
                                                'text-right font-bold',
                                                (robot.totalProfit || 0) > 0
                                                    ? 'text-green-600'
                                                    : (robot.totalProfit || 0) < 0
                                                      ? 'text-red-600'
                                                      : 'text-muted-foreground'
                                            )}
                                        >
                                            {(robot.totalProfit || 0).toLocaleString('en-US', {
                                                style: 'currency',
                                                currency: 'USD',
                                                minimumFractionDigits: 2,
                                            })}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center h-24">
                                    <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                                        <AlertTriangle className="h-8 w-8" />
                                        <p>
                                            Nenhum desempenho registrado. Ative a Mesa Operacional
                                            para iniciar a simulação.
                                        </p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
