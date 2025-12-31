// /src/components/deriv-trader/council-autopilot-interface.tsx
'use client';

import { Fragment } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "../ui/button";
import { Loader2, Users, Bot, Info, BrainCircuit, CheckCircle, XCircle, HelpCircle, CandlestickChart, Activity, Waves, Cloud, BarChart, TrendingUp, Award, Wand, Trash2, ShieldCheck, ShieldX, Group, ArrowUpCircle, ArrowDownCircle, LayoutGrid, Power, PowerOff, Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import type { RobotStrategy } from "@/lib/types/trading.types";
import { cn } from "@/lib/utils";
import { Input } from "../ui/input";
import type { useRobotCouncil } from "@/hooks/use-robot-council";
import type { Indicators } from "@/services/indicator-service";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DurationUnit } from "@/lib/types";

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

const durationUnitLabels: Record<DurationUnit, string> = {
  t: "Ticks",
  s: "Segundos",
  m: "Minutos",
  h: "Horas",
  d: "Dias",
};

const robotCategories: Record<string, RobotStrategy['strategyType'][]> = {
    'Especialistas em Momentum': ['RSI', 'STOCHASTIC', 'MACD_CROSS', 'AWESOME_OSCILLATOR', 'TRIX', 'ROC', 'RVI'],
    'Especialistas em Tendência': ['MOVING_AVERAGE_CROSS', 'ADX_TREND', 'ICHIMOKU_CLOUD', 'PARABOLIC_SAR'],
    'Especialistas em Volatilidade e Estrutura': ['BOLLINGER_BANDS', 'DONCHIAN_CHANNELS', 'KAMA', 'CHANDELIER_EXIT'],
    'Especialistas em Padrões': ['PRICE_ACTION_PATTERN'],
    'Especialistas em Volume e Fluxo': ['VOLUME_PROFILE', 'VWAP', 'MFI', 'OBV'],
    'Especialistas Estatísticos': ['Z_SCORE', 'STOCH_RSI'],
};

// Hook's return type is used for props
interface CouncilAutopilotInterfaceProps extends ReturnType<typeof useRobotCouncil> {}

export function CouncilAutopilotInterface(props: CouncilAutopilotInterfaceProps) {
  const { 
    isCouncilAutopilotOn,
    strategyCouncil,
    isFetchingCouncil,
    councilVotes,
    dailyBalance,
    setDailyBalance,
    dailyTarget,
    setDailyTarget,
    consensusThreshold,
    setConsensusThreshold,
    isDynamicConsensusOn,
    setIsDynamicConsensusOn,
    isDynamicRiskOn,
    setIsDynamicRiskOn,
    isMeritocracyOn,
    setIsMeritocracyOn,
    indicators,
    activeCommittee,
    supervisionStatus,
    consensusSum,
    fetchStrategyCouncil,
    dissolveCouncil,
 } = props;
  const { toast } = useToast();
  
  const renderStrategyParams = (robot: RobotStrategy) => {
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
            return `Período: ${robot.period}, Desvio Padrão: ${robot.stdDev}`;
        case 'MACD_CROSS':
            return `Parâmetros: ${robot.fastPeriod}/${robot.slowPeriod}/${robot.signalPeriod}`;
        case 'PRICE_ACTION_PATTERN':
            const pattern = robot.pattern === 'hammer' ? 'Martelo' : 'Estrela Cadente';
            return `Padrão: ${pattern}`;
        case 'ADX_TREND':
            return `Limiar de Tendência > ${robot.trendStrengthThreshold}`;
        case 'VOLUME_PROFILE':
            return `POC de ${robot.profileBars} barras`;
        case 'Z_SCORE':
            return `Limiar Z-Score: ${robot.zScoreThreshold}`;
        case 'PARABOLIC_SAR':
            return `AF: ${robot.acceleration}, MAX: ${robot.maxAcceleration}`;
        case 'CHANDELIER_EXIT':
            return `Multiplicador ATR: ${robot.multiplier}`;
        case 'TRIX':
        case 'ROC':
        case 'KAMA':
        case 'DONCHIAN_CHANNELS':
            return `Período: ${robot.period}`;
        case 'AWESOME_OSCILLATOR':
        case 'ICHIMOKU_CLOUD':
        case 'VWAP':
        case 'OBV':
             return 'Parâmetros Internos';
        default:
            return "N/A";
    }
}

    const renderIndicatorValue = (robot: RobotStrategy) => {
        if (!indicators) return <p>...</p>;
        const format = (val: number | null | undefined, prec = 4) => val?.toFixed(prec) ?? "...";

        switch (robot.strategyType) {
            case 'RSI':
                return <p>RSI Atual: <strong>{format(indicators.rsi)}</strong></p>;
            case 'STOCHASTIC':
                return <p>Estocástico Atual: <strong>{format(indicators.stoch)}</strong></p>;
            case 'MACD_CROSS':
                const { macd, signal } = indicators.macd;
                return <p>MACD/Sinal: <strong>{format(macd, 4)} / {format(signal, 4)}</strong></p>;
            case 'MOVING_AVERAGE_CROSS':
                const { short, long } = indicators.ma;
                return <p>Médias Atuais: <strong>{format(short)} / {format(long)}</strong></p>;
            case 'BOLLINGER_BANDS':
                if (!indicators.bollingerBands || indicators.bollingerBands.length === 0) return <p>Bandas: <strong>...</strong></p>;
                const lastBand = indicators.bollingerBands[indicators.bollingerBands.length - 1];
                if (!lastBand) return <p>Bandas: <strong>...</strong></p>;
                return <p>Bandas: <strong>{format(lastBand.lower)} / {format(lastBand.upper)}</strong></p>;
            case 'ADX_TREND':
                return <p>Força da Tendência (ADX): <strong>{format(indicators.adx)}</strong></p>;
            case 'Z_SCORE':
                return <p>Z-Score Atual: <strong>{format(indicators.zScore)}</strong></p>;
            case 'KAMA':
                return <p>KAMA Atual: <strong>{format(indicators.kama)}</strong></p>;
            case 'STOCH_RSI':
                return <p>StochRSI Atual: <strong>{format(indicators.stochRSI, 2)}</strong></p>;
            case 'AWESOME_OSCILLATOR':
                return <p>Awesome Osc: <strong>{format(indicators.awesomeOscillator, 2)}</strong></p>;
            case 'TRIX':
                return <p>TRIX Atual: <strong>{format(indicators.trix)}%</strong></p>;
            case 'ROC':
                return <p>ROC Atual: <strong>{format(indicators.roc)}%</strong></p>;
            case 'MFI':
                 return <p>MFI Atual: <strong>{format(indicators.mfi)}</strong></p>;
            case 'OBV':
                 return <p>OBV Atual: <strong>{format(indicators.obv, 0)}</strong></p>;
            case 'PARABOLIC_SAR':
                return <p>SAR Atual: <strong>{format(indicators.parabolicSAR)}</strong></p>;
            case 'RVI':
                 return <p>RVI Atual: <strong>{format(indicators.rvi)}</strong></p>;
            case 'VWAP':
                const lastVWAP = indicators.vwap && indicators.vwap.length > 0 ? indicators.vwap[indicators.vwap.length - 1] : null;
                return <p>VWAP Atual: <strong>{format(lastVWAP)}</strong></p>;
            case 'DONCHIAN_CHANNELS':
                if (!indicators.donchianChannels || indicators.donchianChannels.length === 0) return <p>Canais: <strong>...</strong></p>;
                const lastChannel = indicators.donchianChannels[indicators.donchianChannels.length - 1];
                if (!lastChannel) return <p>Canais: <strong>...</strong></p>;
                return <p>Canais: <strong>{format(lastChannel.lower)} / {format(lastChannel.upper)}</strong></p>;
            case 'CHANDELIER_EXIT':
                 if (!indicators.chandelierExit) return <p>Saída: <strong>...</strong></p>;
                 return <p>Saída Chandelier: <strong>{format(indicators.chandelierExit)}</strong></p>;
            case 'ICHIMOKU_CLOUD':
                if (!indicators.ichimoku) return <p>Nuvem: <strong>...</strong></p>;
                return <p>Nuvem A/B: <strong>{format(indicators.ichimoku.senkouA)} / {format(indicators.ichimoku.senkouB)}</strong></p>;
            default:
                return null;
        }
  }

  const groupedRobots = Array.isArray(strategyCouncil)
    ? strategyCouncil.reduce((acc, robot) => {
        for (const category in robotCategories) {
          if (robotCategories[category].includes(robot.strategyType)) {
            if (!acc[category]) {
              acc[category] = [];
            }
            acc[category].push(robot);
            break;
          }
        }
        return acc;
      }, {} as Record<string, RobotStrategy[]>)
    : {};


  const supervisionIcon = supervisionStatus ? {
      'inactive': <HelpCircle className="h-4 w-4 text-muted-foreground" />,
      'veto': <ShieldX className="h-4 w-4 text-destructive" />,
      'approved': <ShieldCheck className="h-4 w-4 text-green-600" />,
  }[supervisionStatus.status] : <HelpCircle className="h-4 w-4 text-muted-foreground" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="font-headline flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-primary" />
                Mesa Operacional
            </CardTitle>
            <Badge variant={isCouncilAutopilotOn ? "default" : "secondary"}>
                {isCouncilAutopilotOn ? "Ativada" : "Desativada"}
            </Badge>
        </div>
        <CardDescription>
          Controle a orquestra de robôs-analistas e a execução automática de operações.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCouncilAutopilotOn && supervisionStatus && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="rounded-lg border bg-card p-3">
                    <p className="font-semibold flex items-center gap-1.5"><Group className="h-4 w-4" /> Gestor de Turno</p>
                    <p className="text-muted-foreground mt-1">{activeCommittee || 'Aguardando...'}</p>
                </div>
                 <div className="rounded-lg border bg-card p-3">
                    <p className="font-semibold flex items-center gap-1.5">{supervisionIcon} Direção de Risco</p>
                    <p className="text-muted-foreground mt-1">{supervisionStatus.message}</p>
                    {supervisionStatus.analysis && <p className="text-muted-foreground mt-1 italic">Análise: {supervisionStatus.analysis}</p>}
                </div>
            </div>
        )}
        <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <Label htmlFor="council-daily-balance">Banca do Dia (USD)</Label>
                <Input 
                    id="council-daily-balance"
                    type="number"
                    value={dailyBalance}
                    onChange={(e) => setDailyBalance(Number(e.target.value))}
                    placeholder="Ex: 100"
                    disabled={isCouncilAutopilotOn}
                />
                <p className="text-xs text-muted-foreground">Sua perda máxima no dia.</p>
            </div>
            <div className="space-y-2">
                <Label htmlFor="council-daily-target">Alvo de Lucro (USD)</Label>
                <Input 
                    id="council-daily-target"
                    type="number"
                    value={dailyTarget}
                    onChange={(e) => setDailyTarget(Number(e.target.value))}
                    placeholder="Ex: 50"
                    disabled={isCouncilAutopilotOn}
                />
                <p className="text-xs text-muted-foreground">Sua meta de lucro no dia.</p>
            </div>
        </div>

        <Separator />
        
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <Label htmlFor="dynamic-consensus-switch" className="flex-1">Consenso Dinâmico</Label>
                <Switch id="dynamic-consensus-switch" checked={isDynamicConsensusOn} onCheckedChange={setIsDynamicConsensusOn} disabled={isCouncilAutopilotOn} />
            </div>
             <div className="flex items-center justify-between">
                <Label htmlFor="dynamic-risk-switch" className="flex-1">Gestão de Risco Dinâmica</Label>
                <Switch id="dynamic-risk-switch" checked={isDynamicRiskOn} onCheckedChange={setIsDynamicRiskOn} disabled={isCouncilAutopilotOn} />
            </div>
        </div>


         <div className="space-y-2">
            <Label htmlFor="council-consensus">
                Limiar de Consenso
                {isDynamicConsensusOn && <span className="text-muted-foreground text-xs"> (Automático: {consensusThreshold})</span>}
            </Label>
            <Input 
                id="council-consensus"
                type="number"
                min={100}
                max={1000}
                value={consensusThreshold}
                onChange={(e) => {
                    const val = Math.max(100, Math.min(1000, Number(e.target.value)));
                    setConsensusThreshold(val);
                }}
                placeholder="Ex: 300"
                disabled={isCouncilAutopilotOn || isDynamicConsensusOn}
            />
            {isCouncilAutopilotOn && consensusSum && (
                <div className="flex items-center justify-center gap-4 text-sm font-semibold rounded-md border p-2 bg-muted/50">
                    <div className="flex items-center gap-1.5 text-green-600">
                        <ArrowUpCircle className="h-4 w-4" />
                        <span>RISE: {Math.round(consensusSum.rise)}</span>
                    </div>
                    <Separator orientation="vertical" className="h-5" />
                    <div className="flex items-center gap-1.5 text-red-600">
                        <ArrowDownCircle className="h-4 w-4" />
                        <span>FALL: {Math.round(consensusSum.fall)}</span>
                    </div>
                </div>
            )}
        </div>

        <Separator />

        {isCouncilAutopilotOn ? (
            <Button variant="destructive" className="w-full" onClick={dissolveCouncil} disabled={isFetchingCouncil}>
                <PowerOff className="mr-2 h-4 w-4" />
                Dispensar e Desativar
            </Button>
        ) : (
             <Button className="w-full" onClick={fetchStrategyCouncil} disabled={isFetchingCouncil}>
                {isFetchingCouncil ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                {isFetchingCouncil ? 'Convocando...' : 'Convocar e Ativar Mesa'}
            </Button>
        )}


         <div className="flex justify-between items-center text-xs text-muted-foreground pt-2">
            <span>Analistas em Posição</span>
            <Badge variant="outline">{Array.isArray(strategyCouncil) ? strategyCouncil.length : 0}</Badge>
        </div>
        
        {isCouncilAutopilotOn && (
            isFetchingCouncil ? (
                <div className="flex items-center justify-center text-muted-foreground p-4">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    <span>Convocando o conselho de analistas...</span>
                </div>
            ) : Array.isArray(strategyCouncil) && strategyCouncil.length > 0 && groupedRobots ? (
                <Alert className="bg-primary/5 border-primary/20 max-h-96 overflow-y-auto">
                    <AlertTitle className="text-primary flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        Conselho em Sessão
                    </AlertTitle>
                    <AlertDescription className="text-primary/90 space-y-3 mt-2">
                        {Object.entries(groupedRobots).map(([category, robots]) => (
                            <div key={category}>
                                <h4 className="font-semibold text-sm text-primary/100 mb-2">{category}</h4>
                                {robots.map((robot, index) => {
                                    const voteData = councilVotes ? councilVotes[robot.id] : null;
                                    const vote = voteData?.vote || 'HOLD';
                                    const weight = voteData?.weight || 1.0;
                                    const confidence = voteData?.confidence || 0;
                                    const optimalDuration = voteData?.optimalDuration || robot.optimalDuration;
                                    const optimalDurationUnit = voteData?.optimalDurationUnit || robot.optimalDurationUnit;

                                    return (
                                        <div key={robot.id}>
                                            <div className="text-xs space-y-1">
                                                <div className="flex justify-between items-center">
                                                    <p className="font-bold flex items-center gap-1.5">{indicatorIcons[robot.strategyType] || <Bot />} Analista de {robot.strategyType}</p>
                                                    {isMeritocracyOn && weight > 1.0 && (
                                                        <Badge variant="secondary" className="flex items-center gap-1 text-amber-600 border-amber-500/50">
                                                            <Award className="h-3 w-3" />
                                                            x{weight.toFixed(1)}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="italic pl-5">{robot.justification}</p>
                                                <div className="pl-5 text-xs">{renderStrategyParams(robot)}</div>
                                                <div className="pl-5 text-xs">{renderIndicatorValue(robot)}</div>
                                                <div className={cn("pl-5 font-bold flex items-center gap-2",
                                                    vote === 'RISE' && 'text-green-600',
                                                    vote === 'FALL' && 'text-red-600',
                                                    vote === 'HOLD' && 'text-yellow-600',
                                                )}>
                                                    <span className="flex items-center gap-1">Voto: {vote} {voteIcons[vote]}</span>
                                                    {confidence > 0 && <span className="font-normal">(Conf: {confidence})</span>}
                                                    {vote !== 'HOLD' && (
                                                        <Badge variant="outline" className="flex items-center gap-1">
                                                            <Clock className="h-3 w-3"/>
                                                            {optimalDuration} {durationUnitLabels[optimalDurationUnit].slice(0, -1)}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                            {index < robots.length - 1 && <Separator className="bg-primary/10 my-2" />}
                                        </div>
                                    )
                                })}
                                <Separator className="bg-primary/20 mt-3" />
                            </div>
                        ))}
                    </AlertDescription>
                </Alert>
            ) : (
                 <div className="text-center text-muted-foreground p-4 border rounded-md bg-muted/50">
                    <Info className="h-5 w-5 mx-auto mb-2" />
                    <p className="text-sm">Clique em "Convocar Conselho" para começar.</p>
                </div>
            )
        )}
        {!isCouncilAutopilotOn && Array.isArray(strategyCouncil) && strategyCouncil.length < 1 && (
            <div className="text-center text-muted-foreground p-4 border rounded-md bg-muted/50">
                <Info className="h-5 w-5 mx-auto mb-2" />
                <p className="text-sm">A Mesa Operacional está aguardando a convocação.</p>
                <p className="text-xs">Use o botão acima para iniciar.</p>
            </div>
        )}
        {!isCouncilAutopilotOn && Array.isArray(strategyCouncil) && strategyCouncil.length > 0 && (
             <div className="text-center text-muted-foreground p-4 border rounded-md bg-muted/50">
                <Info className="h-5 w-5 mx-auto mb-2" />
                <p className="text-sm">A Mesa Operacional está pronta. Ative-a para começar.</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
