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
import { Bot, Power, PowerOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useFormContext } from "react-hook-form";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { MultipliersFormValues } from "./deriv-trader-interface-multipliers.types";
import type { useMultipliersCouncil } from "../../hooks/use-multipliers-council";


interface MultipliersAutopilotInterfaceProps extends ReturnType<typeof useMultipliersCouncil> {}

export function MultipliersAutopilotInterface({
    isAutopilotOn,
    toggleAutopilot,
}: MultipliersAutopilotInterfaceProps) {
  const form = useFormContext<MultipliersFormValues>();

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
            <CardTitle className="font-headline flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                Piloto Automático
            </CardTitle>
            <Badge variant={isAutopilotOn ? "default" : "secondary"}>
                {isAutopilotOn ? "Ativo" : "Inativo"}
            </Badge>
        </div>
        <CardDescription>
          Deixe a IA gerenciar suas posições de multiplicadores com base em uma estratégia de cruzamento de médias.
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

         <div className="space-y-4">
            <h4 className="font-semibold text-sm">Parâmetros de Execução</h4>
            <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="stake"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Valor por Trade (USD)</FormLabel>
                        <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} disabled={isAutopilotOn} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                 <FormField
                    control={form.control}
                    name="multiplier"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Multiplicador (x)</FormLabel>
                        <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value) || 0)} disabled={isAutopilotOn} />
                        </FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
             <div className="grid grid-cols-2 gap-4">
               <FormField
                  control={form.control}
                  name="takeProfit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Take Profit (Opcional)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Ex: 20" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} disabled={isAutopilotOn} />
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
                      <FormLabel>Stop Loss (Opcional)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Ex: 5" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} disabled={isAutopilotOn} />
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
