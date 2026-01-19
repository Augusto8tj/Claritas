// src/features/trading/components/deriv-trader/multipliers-autopilot-interface.tsx
'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, Power, PowerOff, TrendingUp, TrendingDown, HelpCircle, Activity, BarChart3, Wallet } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useFormContext } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { MultipliersFormValues } from "./deriv-trader-interface-multipliers.types";
import type { useMultipliersCouncil } from "../../hooks/use-multipliers-council";
import { cn } from "@/lib/utils";


interface MultipliersAutopilotInterfaceProps extends ReturnType<typeof useMultipliersCouncil> {}

export function MultipliersAutopilotInterface({
    isAutopilotOn,
    toggleAutopilot,
    botStatus,
    trend,
    calculatedRisk,
}: MultipliersAutopilotInterfaceProps) {
  const form = useFormContext<MultipliersFormValues>();
  
  const statusInfo = {
    'PAUSED': { text: 'Pausado', color: 'bg-gray-500' },
    'IDLE': { text: 'Ocioso', color: 'bg-gray-500' },
    'MONITORING': { text: 'Monitorando Mercado...', color: 'bg-blue-500' },
    'TREND_FOUND': { text: 'Tendência Detectada', color: 'bg-yellow-500' },
    'EXECUTING_TRADE': { text: 'Executando Ordem!', color: 'bg-green-500 animate-pulse' },
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="font-headline flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Piloto Automático (Estratégia Padrão Ouro)
            </CardTitle>
            <Badge variant={isAutopilotOn ? "default" : "secondary"}>
                {isAutopilotOn ? "Ativo" : "Inativo"}
            </Badge>
        </div>
        <CardDescription>
          Deixe a IA gerenciar suas posições com base em cruzamento de EMAs e RSI para confirmação de momentum.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
                <Label htmlFor="autopilot-switch" className="font-semibold">
                    Ativar Piloto Automático
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                    O sistema irá abrir posições automaticamente.
                </p>
            </div>
          <Switch
            id="autopilot-switch"
            checked={isAutopilotOn}
            onCheckedChange={toggleAutopilot}
          />
        </div>

        {isAutopilotOn && (
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-xs">
                <div className="p-2 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><Activity className="h-4 w-4"/>Status</p>
                    <Badge variant="outline" className="flex items-center gap-1.5">
                        <div className={cn("h-2 w-2 rounded-full", statusInfo[botStatus].color)}></div>
                        {statusInfo[botStatus].text}
                    </Badge>
                </div>
                 <div className="p-2 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><BarChart3 className="h-4 w-4"/>Tendência</p>
                     <Badge variant="outline" className={cn(
                         trend === 'UP' && "border-green-500 text-green-600",
                         trend === 'DOWN' && "border-red-500 text-red-600"
                     )}>
                        {trend === 'UP' ? <TrendingUp className="h-4 w-4 mr-1.5"/> : trend === 'DOWN' ? <TrendingDown className="h-4 w-4 mr-1.5"/> : <HelpCircle className="h-4 w-4 mr-1.5"/>}
                        {trend}
                    </Badge>
                </div>
                <div className="p-2 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground font-semibold mb-1 flex items-center justify-center gap-1.5"><Wallet className="h-4 w-4"/>Risco (USD)</p>
                     <p className="font-bold text-sm text-foreground">${calculatedRisk.stake.toFixed(2)}</p>
                </div>
                 <div className="p-2 border rounded-lg bg-muted/50">
                    <p className="text-muted-foreground font-semibold mb-1">TP / SL (USD)</p>
                     <p className="font-bold text-sm text-foreground">${calculatedRisk.takeProfit.toFixed(2)} / ${calculatedRisk.stopLoss.toFixed(2)}</p>
                </div>
            </div>
        )}

         <div className="space-y-4">
            <h4 className="font-semibold text-sm">Parâmetros de Execução do Robô</h4>
             <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="takeProfit"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Take Profit (USD)</FormLabel>
                        <FormControl>
                            <Input type="number" placeholder="Ex: 2" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} disabled={isAutopilotOn} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="stopLoss"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Stop Loss (USD)</FormLabel>
                        <FormControl>
                            <Input type="number" placeholder="Ex: 1" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} disabled={isAutopilotOn} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
        </div>
      </CardContent>
    </Card>
  );
}
